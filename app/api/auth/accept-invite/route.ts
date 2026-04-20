import type { NextRequest } from "next/server";
import { z } from "zod";
import { redeemInvite } from "@/lib/auth/invites";
import { sessionCookieHeader, signSession } from "@/lib/auth/session";

const bodySchema = z.object({
  token: z.string().min(8),
  password: z.string().min(8),
  displayName: z.string().max(80).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await redeemInvite(parsed.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }

  const jwt = await signSession({
    userId: result.userId,
    email: result.email,
  });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookieHeader(jwt),
    },
  });
}
