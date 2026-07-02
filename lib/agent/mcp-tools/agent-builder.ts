import "server-only";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sessions, agentConfigs as agentConfigsTable } from "@/lib/db/schema";
import {
  createAgentConfig,
  listAgentConfigs,
} from "@/lib/db/agent-configs";
import { listMyOwnSkills } from "@/lib/db/skills";

/**
 * Look up the (running agent slug, owner user) for a session. Used as a
 * runtime guard on the create tool so a misrouted invocation can't escalate
 * privileges. Returns null when the session doesn't exist or has no agent
 * (which shouldn't happen — sessions FK to agent_configs).
 */
async function sessionContext(
  sessionId: string,
): Promise<{ ownerId: string; agentSlug: string } | null> {
  const rows = await db
    .select({
      ownerId: sessions.ownerId,
      userId: sessions.userId,
      agentSlug: agentConfigsTable.slug,
    })
    .from(sessions)
    .innerJoin(
      agentConfigsTable,
      eq(agentConfigsTable.id, sessions.agentConfigId),
    )
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ownerId: row.ownerId ?? row.userId,
    agentSlug: row.agentSlug,
  };
}

export function buildAgentBuilderTools(sessionId: string) {
  return [
    tool(
      "agent_skill_list",
      "List skills owned by the current user. Returns id, slug, name, description. Use this when interviewing the user to suggest skill bundles for the new agent.",
      {},
      async () => {
        const ctx = await sessionContext(sessionId);
        if (!ctx) {
          throw new Error("Session not found");
        }
        const skills = await listMyOwnSkills(ctx.ownerId);
        const lines = skills.length
          ? skills.map(
              (s) => `- ${s.id}  \`${s.slug}\`  ${s.name}\n    ${s.description}`,
            )
          : ["(no skills configured — encourage the user to create some under /skills)"];
        return {
          content: [
            { type: "text" as const, text: lines.join("\n") },
          ],
        };
      },
    ),

    tool(
      "agent_config_list",
      "List agent configurations owned by the current user. Returns slug, name, model, and current skill scope. Use this so the user can reference an existing agent's setup as a template.",
      {},
      async () => {
        const ctx = await sessionContext(sessionId);
        if (!ctx) {
          throw new Error("Session not found");
        }
        const agents = await listAgentConfigs(ctx.ownerId);
        const lines = agents.map((a) => {
          const skillScope =
            a.selectedSkills === null
              ? "all skills"
              : a.selectedSkills.length === 0
                ? "no skills"
                : `${a.selectedSkills.length} selected skill(s)`;
          return `- \`${a.slug}\`  ${a.name}  [${a.model}, ${skillScope}, max ${a.maxTurns} turns]`;
        });
        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n") || "(no agents yet)",
            },
          ],
        };
      },
    ),

    tool(
      "agent_config_create",
      "Create a new agent configuration. ALWAYS confirm every parameter with the user before calling — this is a write that the user will see immediately under /agents. Pass selectedSkills as a JSON array of skill IDs (use agent_skill_list first), or omit to use every visible skill.",
      {
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .min(2)
          .max(40)
          .describe("kebab-case unique slug, e.g. 'security-reviewer'"),
        name: z.string().min(1).max(80),
        systemPrompt: z.string().min(20).max(10_000),
        model: z
          .string()
          .min(1)
          .describe("e.g. 'claude-opus-4-7' or 'claude-sonnet-4-6'"),
        fallbackModel: z.string().nullable().optional(),
        maxTurns: z.number().int().min(1).max(1000).default(60),
        effort: z
          .enum(["low", "medium", "high", "max"])
          .default("high"),
        maxBudgetUsd: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Per-session USD cap. Omit for no cap."),
        enableLinearTools: z.boolean().default(false),
        enableGithubTools: z.boolean().default(false),
        enableAgentTools: z
          .boolean()
          .default(false)
          .describe(
            "Expose agent_* delegation tools (spawn/wait/message sub-agents) — makes this agent an orchestrator.",
          ),
        includeProjectSkills: z.boolean().default(true),
        selectedSkills: z
          .array(z.string())
          .nullable()
          .optional()
          .describe(
            "Skill ID array. Pass null/omit for 'all visible'; pass [] for 'no skills'.",
          ),
      },
      async (args) => {
        const ctx = await sessionContext(sessionId);
        if (!ctx) throw new Error("Session not found");
        // Defence in depth — only the agent-builder agent should ever land
        // here, but the SDK's tool routing is dynamic so re-check at call.
        if (ctx.agentSlug !== "agent-builder") {
          throw new Error(
            "agent_config_create is only callable from the agent-builder agent",
          );
        }

        try {
          const row = await createAgentConfig({
            userId: ctx.ownerId,
            teamId: null,
            slug: args.slug,
            name: args.name,
            systemPrompt: args.systemPrompt,
            model: args.model,
            fallbackModel: args.fallbackModel ?? null,
            allowedTools: null,
            disallowedTools: [],
            includeProjectSkills: args.includeProjectSkills ? 1 : 0,
            selectedSkills:
              args.selectedSkills === undefined ? null : args.selectedSkills,
            maxTurns: args.maxTurns,
            effort: args.effort,
            maxBudgetUsd: args.maxBudgetUsd ?? null,
            dailyBudgetUsd: null,
            monthlyBudgetUsd: null,
            enableLinearTools: args.enableLinearTools ? 1 : 0,
            enableGithubTools: args.enableGithubTools ? 1 : 0,
            enableAgentTools: args.enableAgentTools ? 1 : 0,
            approvalMode: "none",
            approvalTools: [],
            approvalTimeoutSeconds: 300,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Created agent \`${row.slug}\` (id: ${row.id}). The user can now start sessions with it under /agents.`,
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/unique|duplicate/i.test(message)) {
            throw new Error(
              `Slug "${args.slug}" is already taken — pick a different one`,
            );
          }
          throw err;
        }
      },
    ),
  ];
}
