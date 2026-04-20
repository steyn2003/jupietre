import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { loadReadableSession } from "@/lib/auth/authz";
import { startTurn, queueFollowUp } from "@/lib/agent/runner";

const bodySchema = z.object({ text: z.string().min(1).max(20_000) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await loadReadableSession(id, session.userId);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // /btw mode: agent is mid-turn. Queue the follow-up; the runner will
  // drain it as the next turn the moment the current one ends.
  if (row.status === "running") {
    await queueFollowUp({ sessionId: id, userText: parsed.data.text });
    return Response.json({ ok: true, queued: true });
  }

  void startTurn({ sessionId: id, userText: parsed.data.text });
  return Response.json({ ok: true, queued: false });
}
