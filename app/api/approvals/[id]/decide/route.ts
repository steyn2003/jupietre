import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { loadReadableSession } from "@/lib/auth/authz";
import {
  decideApprovalRequest,
  getApprovalRequest,
} from "@/lib/db/approvals";
import { publishDecision } from "@/lib/approvals/pubsub";

const decideSchema = z.object({
  decision: z.enum(["approve", "deny"]),
  reason: z.string().max(500).optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = decideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const approval = await getApprovalRequest(id);
  if (!approval)
    return Response.json({ error: "Not found" }, { status: 404 });

  // ensure the approval belongs to a session this user can read (own or team-shared)
  const readable = await loadReadableSession(
    approval.sessionId,
    session.userId,
  );
  if (!readable)
    return Response.json({ error: "Forbidden" }, { status: 403 });

  if (approval.status !== "pending") {
    return Response.json(
      { error: `Already ${approval.status}` },
      { status: 409 },
    );
  }

  const status = parsed.data.decision === "approve" ? "approved" : "denied";
  const reason = parsed.data.decision === "deny" ? parsed.data.reason : null;
  const updated = await decideApprovalRequest(id, status, reason);
  if (!updated) {
    return Response.json({ error: "Already decided" }, { status: 409 });
  }

  const woke = publishDecision(
    id,
    status === "approved"
      ? { status: "approved" }
      : { status: "denied", reason: reason ?? undefined },
  );

  return Response.json({ ok: true, woke, approval: updated });
}
