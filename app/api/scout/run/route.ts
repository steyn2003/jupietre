import { getServerSession } from "@/lib/auth/session";
import { runScout } from "@/lib/scout/nightly";

/**
 * Manual kick of the nightly scout. Same work the daily tick does — one
 * Scout session per registered repo. Fire-and-forget: spawning sessions can
 * take a moment per repo, so we don't await the whole sweep before replying.
 */
export async function POST(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  void runScout().catch((err) => {
    console.error("[scout] manual run failed:", err);
  });

  return Response.json({ ok: true });
}
