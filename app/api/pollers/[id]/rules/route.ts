import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  canEditPoller,
  createRule,
  getPollerById,
  listRulesForPoller,
} from "@/lib/db/linear-pollers";

const createSchema = z
  .object({
    mode: z.enum(["pickup", "triage"]).default("pickup"),
    pickupState: z.string().min(1).max(80),
    // Pickup needs an in-progress state. Triage does not — the agent
    // decides where to move the ticket. We refine below.
    inProgressState: z.string().min(1).max(80).nullable().optional(),
    agentConfigId: z.string().min(1),
    labelOverride: z.string().max(80).nullable().optional(),
    workflowTemplate: z.string().max(20_000).nullable().optional(),
  })
  .refine(
    (d) =>
      d.mode === "triage" ||
      (typeof d.inProgressState === "string" &&
        d.inProgressState.length > 0),
    {
      path: ["inProgressState"],
      message: "inProgressState is required for pickup-mode rules",
    },
  );

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const poller = await getPollerById(id);
  if (!poller) return Response.json({ error: "Not found" }, { status: 404 });
  const rules = await listRulesForPoller(id);
  return Response.json({ rules });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const poller = await getPollerById(id);
  if (!poller) return Response.json({ error: "Not found" }, { status: 404 });
  if (!canEditPoller(session.userId, poller)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  try {
    const row = await createRule({
      pollerId: id,
      mode: d.mode,
      pickupState: d.pickupState,
      inProgressState: d.mode === "triage" ? null : d.inProgressState ?? null,
      agentConfigId: d.agentConfigId,
      labelOverride: d.labelOverride ?? null,
      workflowTemplate: d.workflowTemplate ?? null,
    });
    return Response.json({ rule: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Insert failed";
    // The unique index on (poller_id, pickup_state, agent_config_id) surfaces
    // here when the operator tries to add a duplicate rule.
    if (msg.includes("dedupe_idx") || msg.includes("duplicate")) {
      return Response.json(
        {
          error:
            "A rule for this pickup state + agent already exists on this poller.",
        },
        { status: 409 },
      );
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
