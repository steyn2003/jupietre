import { getServerSession } from "@/lib/auth/session";
import { runScout } from "@/lib/scout/nightly";

/**
 * Manual kick of the scout. Same work the daily tick does — one Scout
 * session per registered repo — with an optional `focus` directive from the
 * request body ("check for N+1 queries"). Fire-and-forget: spawning sessions
 * takes a moment per repo, so we don't await the whole sweep before replying.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { focus?: unknown };
  const focus =
    typeof body.focus === "string" && body.focus.trim()
      ? body.focus.trim()
      : undefined;

  void runScout(focus).catch((err) => {
    console.error("[scout] manual run failed:", err);
  });

  return Response.json({ ok: true });
}
