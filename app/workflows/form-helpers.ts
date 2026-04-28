// Pure helpers shared between the server pages (which build the initial
// form state) and the client form component (which renders + edits it).
// Importantly: NO `"use client"` here, NO React imports — this lets server
// components call `emptyWorkflowInitial()` / `initialFromDefinition()`
// without tripping the client-from-server boundary check.

import {
  type ReceivableKind,
  type TransitionKind,
  type WorkflowDefinition,
} from "@/lib/workflows/definitions";

export interface FormNode {
  slug: string;
  agentConfigId: string;
  canReceive: ReceivableKind[];
}
export interface FormTransition {
  from: string;
  kind: TransitionKind;
  to: string;
}
export interface FormLimits {
  maxRejects: string;
  maxAsks: string;
  maxBudgetUsd: string;
}

export interface WorkflowFormInitial {
  id?: string; // set ⇒ edit mode
  name: string;
  slug: string;
  nodes: FormNode[];
  transitions: FormTransition[];
  limits: FormLimits;
}

export function emptyWorkflowInitial(): WorkflowFormInitial {
  return {
    name: "",
    slug: "",
    nodes: [{ slug: "pm", agentConfigId: "", canReceive: ["trigger"] }],
    transitions: [],
    limits: { maxRejects: "", maxAsks: "", maxBudgetUsd: "" },
  };
}

export function initialFromDefinition(
  workflow: { id: string; name: string; slug: string },
  def: WorkflowDefinition,
): WorkflowFormInitial {
  return {
    id: workflow.id,
    name: workflow.name,
    slug: workflow.slug,
    nodes: Object.entries(def.nodes).map(([slug, n]) => ({
      slug,
      agentConfigId: n.agentConfigId,
      canReceive: [...n.canReceive],
    })),
    transitions: def.transitions.map((t) => ({
      from: t.from,
      kind: t.kind,
      to: t.to ?? "",
    })),
    limits: {
      maxRejects: def.limits.maxRejects?.toString() ?? "",
      maxAsks: def.limits.maxAsks?.toString() ?? "",
      maxBudgetUsd: def.limits.maxBudgetUsd?.toString() ?? "",
    },
  };
}
