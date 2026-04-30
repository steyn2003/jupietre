import "server-only";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { LinearClient } from "@linear/sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { recordArtifact } from "@/lib/db/artifacts";
import {
  firstEnabledPollerApiKey,
  getPollerById,
} from "@/lib/db/linear-pollers";

/**
 * Resolve which Linear API key this session should call with.
 *
 * Order of precedence:
 *   1. The poller that originated this session (sessions.linearPollerId).
 *      Critical: prevents cross-workspace mixups when more than one poller
 *      is configured — the agent must talk to the workspace the issue came
 *      from, not "whichever poller was enabled first".
 *   2. The first enabled poller (for manual UI sessions where the agent has
 *      `enableLinearTools=1` but isn't bound to any specific workspace).
 *   3. The LINEAR_API_KEY env var (legacy / pre-migration fallback).
 */
async function getClient(sessionId: string): Promise<LinearClient> {
  const sessionRow = (
    await db
      .select({ linearPollerId: sessions.linearPollerId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
  )[0];

  if (sessionRow?.linearPollerId) {
    const poller = await getPollerById(sessionRow.linearPollerId);
    if (poller?.enabled) {
      return new LinearClient({ apiKey: poller.apiKey });
    }
    // Poller was deleted or disabled after the session was created. Fall
    // through to the broader fallback rather than failing — the operator
    // probably meant for the session to keep working.
  }

  const fallback =
    (await firstEnabledPollerApiKey()) ?? process.env.LINEAR_API_KEY;
  if (!fallback) {
    throw new Error(
      "No Linear API key configured. Add a poller in /pollers or set LINEAR_API_KEY.",
    );
  }
  return new LinearClient({ apiKey: fallback });
}

export function buildLinearTools(sessionId: string) {
  return [
    tool(
      "linear_get_issue",
      "Get details of a Linear issue by ID or identifier (e.g. 'ENG-123').",
      {
        issueId: z
          .string()
          .describe("Issue ID (UUID) or identifier (e.g. ENG-123)"),
      },
      async ({ issueId }) => {
        const client = await getClient(sessionId);
        const issue = await client.issue(issueId);
        const state = await issue.state;
        const labels = await issue.labels();
        const comments = await issue.comments();
        const assignee = await issue.assignee;

        const commentTexts = comments.nodes
          .map((c) => `[${c.createdAt.toISOString()}] ${c.body}`)
          .join("\n\n");

        const text = [
          `**${issue.identifier}: ${issue.title}**`,
          `State: ${state?.name ?? "Unknown"}`,
          `Labels: ${labels.nodes.map((l) => l.name).join(", ") || "none"}`,
          `Assignee: ${assignee?.name ?? "unassigned"}`,
          `Priority: ${issue.priority}`,
          `URL: ${issue.url}`,
          "",
          "## Description",
          issue.description ?? "(no description)",
          "",
          comments.nodes.length > 0 ? `## Comments\n${commentTexts}` : "",
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      },
    ),

    tool(
      "linear_update_issue_state",
      "Update the workflow state of a Linear issue.",
      {
        issueId: z.string(),
        stateName: z
          .string()
          .describe(
            "Target state name, e.g. 'In Progress', 'Done', 'Ready for Review'",
          ),
      },
      async ({ issueId, stateName }) => {
        const client = await getClient(sessionId);
        const issue = await client.issue(issueId);
        const team = await issue.team;
        if (!team) throw new Error("Issue has no team");

        const states = await team.states();
        const target = states.nodes.find(
          (s) => s.name.toLowerCase() === stateName.toLowerCase(),
        );
        if (!target) {
          const available = states.nodes.map((s) => s.name).join(", ");
          throw new Error(
            `State '${stateName}' not found. Available: ${available}`,
          );
        }

        await client.updateIssue(issue.id, { stateId: target.id });
        return {
          content: [
            {
              type: "text" as const,
              text: `Issue ${issue.identifier} moved to '${target.name}'`,
            },
          ],
        };
      },
    ),

    tool(
      "linear_add_comment",
      "Add a comment to a Linear issue.",
      {
        issueId: z.string(),
        body: z.string().describe("Comment body in markdown"),
      },
      async ({ issueId, body }) => {
        const client = await getClient(sessionId);
        const issue = await client.issue(issueId);
        const result = await client.createComment({
          issueId: issue.id,
          body,
        });
        const comment = await result.comment;
        await recordArtifact({
          sessionId,
          kind: "linear_comment",
          title: `Comment on ${issue.identifier}`,
          url: issue.url,
          summary: body.slice(0, 280),
          externalId: comment?.id ?? `${issue.identifier}:${Date.now()}`,
          raw: { issueId: issue.identifier, body },
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Comment added to ${issue.identifier}`,
            },
          ],
        };
      },
    ),

    tool(
      "linear_update_issue",
      "Update a Linear issue's title, description, priority, or labels.",
      {
        issueId: z.string(),
        title: z.string().optional(),
        description: z
          .string()
          .optional()
          .describe(
            "New description (replaces existing). Use linear_get_issue first to read current description and append to it.",
          ),
        priority: z
          .number()
          .optional()
          .describe("0=none, 1=urgent, 2=high, 3=medium, 4=low"),
        labelNames: z.array(z.string()).optional(),
      },
      async ({ issueId, title, description, priority, labelNames }) => {
        const client = await getClient(sessionId);
        const issue = await client.issue(issueId);

        const update: Record<string, unknown> = {};
        if (title !== undefined) update.title = title;
        if (description !== undefined) update.description = description;
        if (priority !== undefined) update.priority = priority;

        if (labelNames?.length) {
          const team = await issue.team;
          if (team) {
            const labels = await team.labels();
            update.labelIds = labels.nodes
              .filter((l) =>
                labelNames.some(
                  (n) => n.toLowerCase() === l.name.toLowerCase(),
                ),
              )
              .map((l) => l.id);
          }
        }

        await client.updateIssue(issue.id, update);
        const fields = Object.keys(update).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated ${issue.identifier}: ${fields}`,
            },
          ],
        };
      },
    ),

    tool(
      "linear_create_issue",
      "Create a new Linear issue, optionally as a sub-issue of a parent.",
      {
        title: z.string(),
        description: z.string(),
        teamKey: z.string().describe("Team key, e.g. 'ENG'"),
        parentId: z.string().optional(),
        labelNames: z.array(z.string()).optional(),
      },
      async ({ title, description, teamKey, parentId, labelNames }) => {
        const client = await getClient(sessionId);
        const teams = await client.teams({
          filter: { key: { eq: teamKey } },
        });
        const team = teams.nodes[0];
        if (!team) throw new Error(`Team '${teamKey}' not found`);

        let labelIds: string[] | undefined;
        if (labelNames?.length) {
          const labels = await team.labels();
          labelIds = labels.nodes
            .filter((l) =>
              labelNames.some((n) => n.toLowerCase() === l.name.toLowerCase()),
            )
            .map((l) => l.id);
        }

        const result = await client.createIssue({
          title,
          description,
          teamId: team.id,
          parentId,
          labelIds,
        });
        const issue = await result.issue;
        if (issue) {
          await recordArtifact({
            sessionId,
            kind: "linear_issue",
            title: `${issue.identifier}: ${issue.title}`,
            url: issue.url,
            summary: description.slice(0, 280),
            externalId: issue.id,
            raw: { identifier: issue.identifier, teamKey },
          });
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Created ${issue?.identifier}: ${issue?.title}`,
            },
          ],
        };
      },
    ),
  ];
}
