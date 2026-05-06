import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { listVisibleSkills, type Skill } from "@/lib/db/skills";
import { getMyTeamIds } from "@/lib/auth/authz";

/**
 * Compose a SKILL.md from a DB row's frontmatter fields + body.
 * Matches the format the Claude Agent SDK expects.
 */
function renderSkillFile(s: Skill): string {
  const fm = [
    "---",
    `name: ${s.name}`,
    `description: ${JSON.stringify(s.description)}`,
    "---",
    "",
  ].join("\n");
  return fm + s.body.replace(/\r\n/g, "\n");
}

/**
 * Best-effort recursive copy. Skips on missing source. Doesn't overwrite
 * existing destination files — the DB overlay step writes its own SKILL.md
 * after, and we don't want to clobber sub-files we just copied.
 */
async function copyDirIfExists(src: string, dst: string): Promise<void> {
  try {
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) return;
  } catch {
    return; // source missing — fine
  }
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirIfExists(s, d);
    } else if (entry.isFile()) {
      // Don't overwrite — if the worktree already has the file (unlikely on a
      // fresh worktree, but possible), respect what's there. The DB overlay
      // is applied after this and explicitly overwrites SKILL.md.
      try {
        await fs.access(d);
        continue;
      } catch {
        await fs.copyFile(s, d);
      }
    }
  }
}

/**
 * Build the per-session .claude/skills/ tree under the worktree.
 *
 *   1. Copy <repoRoot>/skills/* into <worktreePath>/.claude/skills/* so any
 *      auxiliary files (scripts, helper markdown) referenced by SKILL.md
 *      from the file-based skills are present.
 *   2. Overlay each visible DB skill as <slug>/SKILL.md, overwriting the
 *      folder copy on collision. DB rows are the editable source of truth;
 *      the folder is just the seed + sub-file provider.
 *
 *  `allowedSkillIds` (the agent's per-agent allowlist):
 *   - undefined / null  → no filtering, every visible DB skill is materialized
 *     (current default behaviour).
 *   - empty array       → no DB skills are materialized; the file-based
 *     skills/ folder still flows in untouched.
 *   - non-empty array   → only the listed skill IDs are materialized; the
 *     folder copy of any non-allowlisted slug is also pruned so the agent
 *     doesn't load it from the project source. This keeps the per-agent
 *     selection actually scoped, not just additive over the folder.
 *
 * Failures are logged but never throw — a session should still start even
 * if one skill is malformed. The agent runs without that skill rather than
 * the operator losing access to the whole feature.
 */
export async function materializeSkillsToWorktree(
  worktreePath: string,
  ownerId: string,
  allowedSkillIds: string[] | null = null,
): Promise<void> {
  const skillsRoot = path.join(worktreePath, ".claude", "skills");
  await fs.mkdir(skillsRoot, { recursive: true });

  // (1) Copy folder-based skills (preserves sub-files).
  const folderSrc = path.join(process.cwd(), "skills");
  await copyDirIfExists(folderSrc, skillsRoot).catch((err) => {
    console.warn(`[skills] folder copy failed: ${err}`);
  });

  // (2) Overlay DB skills, scoped to the agent's allowlist when set.
  const teamIds = await getMyTeamIds(ownerId);
  const allVisible = await listVisibleSkills(ownerId, teamIds);
  let dbSkills: Skill[];
  if (allowedSkillIds === null) {
    dbSkills = allVisible;
  } else {
    const allow = new Set(allowedSkillIds);
    dbSkills = allVisible.filter((s) => allow.has(s.id));
  }

  for (const s of dbSkills) {
    const dir = path.join(skillsRoot, s.slug);
    const file = path.join(dir, "SKILL.md");
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, renderSkillFile(s), "utf8");
    } catch (err) {
      console.warn(`[skills] failed to write ${s.slug}: ${err}`);
    }
  }

  // (3) When the agent has an explicit allowlist, prune folder-based slugs
  //     that aren't in it AND aren't a DB skill we just wrote. Otherwise
  //     the per-agent restriction would leak in via the file-based copy.
  if (allowedSkillIds !== null) {
    const allowedSlugs = new Set(dbSkills.map((s) => s.slug));
    let pruned = 0;
    try {
      const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (allowedSlugs.has(e.name)) continue;
        try {
          await fs.rm(path.join(skillsRoot, e.name), {
            recursive: true,
            force: true,
          });
          pruned++;
        } catch (err) {
          console.warn(`[skills] failed to prune ${e.name}: ${err}`);
        }
      }
    } catch (err) {
      console.warn(`[skills] prune scan failed: ${err}`);
    }
    if (pruned > 0) {
      console.log(
        `[skills] pruned ${pruned} folder-based skill(s) not in agent allowlist`,
      );
    }
  }

  if (dbSkills.length > 0) {
    const scope =
      allowedSkillIds === null ? "all visible" : `${allowedSkillIds.length} allowed`;
    console.log(
      `[skills] materialized ${dbSkills.length} DB skill(s) (${scope}) into ${skillsRoot}`,
    );
  }
}
