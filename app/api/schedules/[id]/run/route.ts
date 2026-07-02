import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getSchedule } from "@/lib/db/schedules";
import { runSchedule } from "@/lib/schedules/runner";

/** Manual "Run now" — fires the schedule immediately without touching
 *  lastRunDay, so tonight's automatic run still happens. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const schedule = await getSchedule(session.userId, id);
  if (!schedule) return Response.json({ error: "Not found" }, { status: 404 });

  void runSchedule(schedule).catch((err) => {
    console.error(`[schedules] manual run of "${schedule.name}" failed:`, err);
  });
  return Response.json({ ok: true });
}
