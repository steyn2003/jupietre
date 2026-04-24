import "server-only";
import { z } from "zod";

// ────────────────────────────────────────────────────────────────────
// Slug shape — reused for workflow slugs and node slugs within a definition.
// Lowercase alphanumerics plus hyphen/underscore, 1–40 chars.
// ────────────────────────────────────────────────────────────────────

const slugSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase letters, digits, _ or - only");

// ────────────────────────────────────────────────────────────────────
// Message kinds live here — kept in sync with the workflow_messages.kind
// enum in schema.ts. `trigger` is dispatcher-internal, not used in
// definition.transitions.
// ────────────────────────────────────────────────────────────────────

export const MESSAGE_KINDS = [
  "trigger",
  "handoff",
  "ask",
  "answer",
  "reject",
  "complete",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const TRANSITION_KINDS = [
  "handoff",
  "ask",
  "reject",
  "complete",
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export const RECEIVABLE_KINDS = [
  "trigger",
  "handoff",
  "ask",
  "answer",
  "reject",
] as const;
export type ReceivableKind = (typeof RECEIVABLE_KINDS)[number];

// ────────────────────────────────────────────────────────────────────
// Handoff payload — the note one agent sends to the next. Every field
// except `message` is optional. Refs are pointers (PR URL, SHA, branch
// name), never content — the receiver looks up detail through their
// own tools if they need it.
// ────────────────────────────────────────────────────────────────────

export const handoffRefSchema = z.object({
  kind: z.enum(["pr", "commit", "issue", "branch"]),
  value: z.string().min(1).max(500),
});

export const handoffPayloadSchema = z.object({
  message: z.string().min(1).max(8000),
  files: z.array(z.string().min(1).max(500)).max(50).optional(),
  dod: z.array(z.string().min(1).max(500)).max(30).optional(),
  outOfScope: z.array(z.string().min(1).max(500)).max(30).optional(),
  refs: z.array(handoffRefSchema).max(20).optional(),
});

export type HandoffPayload = z.infer<typeof handoffPayloadSchema>;

// ────────────────────────────────────────────────────────────────────
// Workflow definition — the DAG. Stored as JSONB in the workflows table.
// ────────────────────────────────────────────────────────────────────

const nodeSchema = z.object({
  agentConfigId: z.string().min(1).max(50),
  canReceive: z.array(z.enum(RECEIVABLE_KINDS)).min(1),
});

const transitionSchema = z
  .object({
    from: slugSchema,
    kind: z.enum(TRANSITION_KINDS),
    to: slugSchema.optional(),
  })
  .refine(
    (t) => (t.kind === "complete" ? t.to === undefined : t.to !== undefined),
    { message: "`to` is required unless kind=complete; forbidden when kind=complete" },
  );

const limitsSchema = z.object({
  maxRejects: z.number().int().min(0).max(20).optional(),
  maxAsks: z.number().int().min(0).max(50).optional(),
  maxBudgetUsd: z.number().min(0).max(1000).optional(),
});

export const workflowDefinitionSchema = z
  .object({
    nodes: z.record(slugSchema, nodeSchema),
    transitions: z.array(transitionSchema).min(1),
    limits: limitsSchema.default({}),
  })
  .superRefine((def, ctx) => {
    const nodeSlugs = Object.keys(def.nodes);
    if (nodeSlugs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one node is required",
        path: ["nodes"],
      });
      return;
    }

    // Every transition's from/to must reference a declared node.
    for (const [i, t] of def.transitions.entries()) {
      if (!def.nodes[t.from]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `transition ${i}: from "${t.from}" is not a declared node`,
          path: ["transitions", i, "from"],
        });
      }
      if (t.to !== undefined && !def.nodes[t.to]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `transition ${i}: to "${t.to}" is not a declared node`,
          path: ["transitions", i, "to"],
        });
      }
    }

    // No duplicate (from, kind, to) transitions — a node can't have two
    // different destinations for the same message kind (would be ambiguous).
    const seen = new Set<string>();
    for (const [i, t] of def.transitions.entries()) {
      const key = `${t.from}::${t.kind}::${t.to ?? "-"}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate transition: ${t.from} --${t.kind}--> ${t.to ?? "(end)"}`,
          path: ["transitions", i],
        });
      }
      seen.add(key);
    }

    // At least one node must accept "trigger" — that's the entry point.
    const triggerNodes = nodeSlugs.filter((s) =>
      def.nodes[s]!.canReceive.includes("trigger"),
    );
    if (triggerNodes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "no entry point: at least one node must include \"trigger\" in canReceive",
        path: ["nodes"],
      });
    }

    // At least one `complete` transition must be reachable from a trigger
    // node, otherwise the run can never end cleanly.
    const reachable = new Set<string>(triggerNodes);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of def.transitions) {
        if (reachable.has(t.from) && t.to && !reachable.has(t.to)) {
          reachable.add(t.to);
          grew = true;
        }
      }
    }
    const hasReachableComplete = def.transitions.some(
      (t) => t.kind === "complete" && reachable.has(t.from),
    );
    if (!hasReachableComplete) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "no reachable `complete` transition — runs would never terminate",
        path: ["transitions"],
      });
    }

    // Each node's canReceive must be consistent with how agents actually
    // receive messages. Trigger can only land on trigger-receiving nodes.
    // Every other receivable kind (handoff/ask/answer/reject) must have at
    // least one inbound transition targeting a node that lists it.
    for (const [slug, node] of Object.entries(def.nodes)) {
      for (const kind of node.canReceive) {
        if (kind === "trigger") continue; // entry points don't need transitions
        const inbound = def.transitions.some(
          (t) => t.to === slug && t.kind === kind,
        );
        if (!inbound) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `node "${slug}" declares canReceive="${kind}" but no transition targets it with that kind`,
            path: ["nodes", slug, "canReceive"],
          });
        }
      }
    }
  });

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/**
 * Collect every agentConfigId referenced by the definition. Used by the
 * dispatcher to detect "broken" workflows (agent deleted after workflow saved).
 */
export function referencedAgentIds(def: WorkflowDefinition): string[] {
  return Array.from(
    new Set(Object.values(def.nodes).map((n) => n.agentConfigId)),
  );
}

/**
 * Validate a raw JSON blob (e.g. a POST body or a row's `definition` column)
 * against the workflow schema. Throws on failure with a readable message.
 */
export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(raw);
}

// ────────────────────────────────────────────────────────────────────
// renderHandoff — converts a HandoffPayload into the first-message text
// that the receiving session will see. No prior context, no transcripts
// — just the note, the pointers, and the DoD.
// ────────────────────────────────────────────────────────────────────

export function renderHandoff(
  payload: HandoffPayload,
  opts: { fromNode?: string; toNode: string },
): string {
  const parts: string[] = [];
  if (opts.fromNode) {
    parts.push(
      `## ➡️ Handoff from \`${opts.fromNode}\` → \`${opts.toNode}\``,
    );
  } else {
    parts.push(`## ➡️ Handoff to \`${opts.toNode}\``);
  }
  parts.push("");
  parts.push(payload.message.trim());

  if (payload.files && payload.files.length > 0) {
    parts.push("");
    parts.push("**Files to touch:**");
    for (const f of payload.files) parts.push(`- \`${f}\``);
  }
  if (payload.dod && payload.dod.length > 0) {
    parts.push("");
    parts.push("**Definition of Done:**");
    for (const d of payload.dod) parts.push(`- ${d}`);
  }
  if (payload.outOfScope && payload.outOfScope.length > 0) {
    parts.push("");
    parts.push("**Out of scope:**");
    for (const o of payload.outOfScope) parts.push(`- ${o}`);
  }
  if (payload.refs && payload.refs.length > 0) {
    parts.push("");
    parts.push("**References:**");
    for (const r of payload.refs) parts.push(`- ${r.kind}: ${r.value}`);
  }
  return parts.join("\n");
}

// ────────────────────────────────────────────────────────────────────
// PM → Eng → QA triangle — the built-in workflow seeded per user. Node
// agent references are filled in at seed time from the user's actual
// agent_configs (pm / engineer / tester slugs).
// ────────────────────────────────────────────────────────────────────

export const PM_ENG_QA_SLUG = "pm-eng-qa";
export const PM_ENG_QA_NAME = "PM → Engineer → QA";

export function buildPmEngQaDefinition(agentIdBySlug: {
  pm: string;
  engineer: string;
  tester: string;
}): WorkflowDefinition {
  const def: WorkflowDefinition = {
    nodes: {
      pm: {
        agentConfigId: agentIdBySlug.pm,
        canReceive: ["trigger", "ask"],
      },
      eng: {
        agentConfigId: agentIdBySlug.engineer,
        canReceive: ["handoff", "reject", "answer"],
      },
      qa: {
        agentConfigId: agentIdBySlug.tester,
        canReceive: ["handoff", "answer"],
      },
    },
    transitions: [
      { from: "pm", kind: "handoff", to: "eng" },
      { from: "eng", kind: "handoff", to: "qa" },
      { from: "eng", kind: "ask", to: "pm" },
      { from: "qa", kind: "ask", to: "eng" },
      { from: "qa", kind: "reject", to: "eng" },
      { from: "qa", kind: "complete" },
    ],
    limits: { maxRejects: 3, maxAsks: 5, maxBudgetUsd: 25 },
  };
  // Parse through the schema so invariants run — if we ever edit this
  // function in a way that breaks the DAG, boot fails loudly instead of
  // silently seeding a broken workflow.
  return workflowDefinitionSchema.parse(def);
}
