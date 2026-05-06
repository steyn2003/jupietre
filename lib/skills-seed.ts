import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createSkill, skillsTableHasRows } from "@/lib/db/skills";

interface ParsedSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
}

/**
 * Parse a SKILL.md file. The frontmatter is a YAML-ish block delimited by
 * `---` on its own lines. We only need `name` and `description` from it —
 * everything else is preserved in the body verbatim.
 *
 * Tolerates: missing frontmatter, missing fields, quoted/unquoted values,
 * Windows line endings.
 */
function parseSkillFile(slug: string, raw: string): ParsedSkill {
  const text = raw.replace(/\r\n/g, "\n");
  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  let name = slug;
  let description = "";
  let body = text;

  if (fmMatch) {
    const fm = fmMatch[1];
    body = text.slice(fmMatch[0].length);
    const lines = fm.split("\n");
    for (const line of lines) {
      const m = /^(\w+):\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1].toLowerCase();
      let value = m[2].trim();
      // Strip a single layer of surrounding quotes (single or double).
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key === "name") name = value || slug;
      else if (key === "description") description = value;
    }
  }

  return { slug, name, description, body };
}

async function findAdminUserId(): Promise<string | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(users.createdAt)
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Seed the DB skills table from each `<repoRoot>/skills/<slug>/SKILL.md` on
 * first boot. Idempotent: skips when any rows already exist (we don't want
 * to re-seed after the operator deletes a row in the UI — the empty table
 * is a deliberate state, not a bug to fix).
 *
 * Sub-files in skills/<slug>/ are NOT seeded — only SKILL.md is brought into
 * the DB. The materialization step at session start copies the folder again
 * (preserving those sub-files) and overlays the DB body on top.
 */
export async function seedSkillsFromFolderIfEmpty(): Promise<void> {
  if (await skillsTableHasRows()) return;

  const folderRoot = path.join(process.cwd(), "skills");
  let entries: string[];
  try {
    entries = await fs.readdir(folderRoot);
  } catch {
    console.log("[skills] no skills/ folder — nothing to seed");
    return;
  }

  const adminId = await findAdminUserId();
  if (!adminId) {
    console.warn(
      "[skills] no admin user yet — skipping seed (will retry on next boot)",
    );
    return;
  }

  let seeded = 0;
  for (const slug of entries) {
    const skillFile = path.join(folderRoot, slug, "SKILL.md");
    let raw: string;
    try {
      raw = await fs.readFile(skillFile, "utf8");
    } catch {
      continue; // not a skill dir — skip silently
    }
    const parsed = parseSkillFile(slug, raw);
    if (!parsed.description) {
      console.warn(
        `[skills] ${slug} has no description in frontmatter — seeding with empty description; edit it in /skills before relying on agent discovery`,
      );
    }
    try {
      await createSkill({
        ownerId: adminId,
        teamId: null,
        slug: parsed.slug,
        name: parsed.name,
        description: parsed.description,
        body: parsed.body,
      });
      seeded++;
    } catch (err) {
      console.warn(`[skills] seed failed for ${slug}:`, err);
    }
  }

  console.log(
    `[skills] seeded ${seeded} skill(s) from ${folderRoot} into the DB. Edit them in /skills.`,
  );
}
