import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { installFromMarket } from "@/lib/market/install";

const bodySchema = z.object({
  kind: z.enum(["agent", "team"]),
  slug: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  try {
    const result = await installFromMarket(
      session.userId,
      parsed.data.kind,
      parsed.data.slug,
    );
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
