import { tool } from "@anthropic-ai/claude-agent-sdk";
import { LinearClient } from "@linear/sdk";
import { z } from "zod";

function getClient(): LinearClient {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("LINEAR_API_KEY not set");
  return new LinearClient({ apiKey });
}

export const linearGetIssue = tool(
  "linear_get_issue",
  "Get details of a Linear issue by ID or identifier (e.g. 'ENG-123').",
  {
    issueId: z.string().describe("Issue ID (UUID) or identifier (e.g. ENG-123)"),
  },
  async ({ issueId }) => {
    const client = getClient();
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
);

export const linearUpdateIssueState = tool(
  "linear_update_issue_state",
  "Update the workflow state of a Linear issue.",
  {
    issueId: z.string().describe("Issue ID (UUID) or identifier (e.g. ENG-123)"),
    stateName: z.string().describe("Target state name, e.g. 'In Progress', 'Done', 'Ready for Review'"),
  },
  async ({ issueId, stateName }) => {
    const client = getClient();
    const issue = await client.issue(issueId);
    const team = await issue.team;
    if (!team) throw new Error("Issue has no team");

    const states = await team.states();
    const target = states.nodes.find(
      (s) => s.name.toLowerCase() === stateName.toLowerCase(),
    );
    if (!target) {
      const available = states.nodes.map((s) => s.name).join(", ");
      throw new Error(`State '${stateName}' not found. Available: ${available}`);
    }

    await client.updateIssue(issue.id, { stateId: target.id });
    return {
      content: [{ type: "text" as const, text: `Issue ${issue.identifier} moved to '${target.name}'` }],
    };
  },
);

export const linearAddComment = tool(
  "linear_add_comment",
  "Add a comment to a Linear issue.",
  {
    issueId: z.string().describe("Issue ID (UUID) or identifier (e.g. ENG-123)"),
    body: z.string().describe("Comment body in markdown"),
  },
  async ({ issueId, body }) => {
    const client = getClient();
    const issue = await client.issue(issueId);
    await client.createComment({ issueId: issue.id, body });
    return {
      content: [{ type: "text" as const, text: `Comment added to ${issue.identifier}` }],
    };
  },
);

/** Query Linear for issues matching a filter. Used by the poller. */
export async function queryIssues(filter: {
  label?: string;
  stateName: string;
}): Promise<Array<{ id: string; identifier: string; title: string }>> {
  const client = getClient();

  const issues = await client.issues({
    filter: {
      state: { name: { eqIgnoreCase: filter.stateName } },
      ...(filter.label
        ? { labels: { some: { name: { eqIgnoreCase: filter.label } } } }
        : {}),
    },
  });

  return issues.nodes.map((i) => ({
    id: i.id,
    identifier: i.identifier,
    title: i.title,
  }));
}

/** Move an issue to a new state by name. Used by the poller. */
export async function moveIssue(
  issueId: string,
  stateName: string,
): Promise<void> {
  const client = getClient();
  const issue = await client.issue(issueId);
  const team = await issue.team;
  if (!team) throw new Error("Issue has no team");

  const states = await team.states();
  const target = states.nodes.find(
    (s) => s.name.toLowerCase() === stateName.toLowerCase(),
  );
  if (!target) throw new Error(`State '${stateName}' not found`);

  await client.updateIssue(issue.id, { stateId: target.id });
}
