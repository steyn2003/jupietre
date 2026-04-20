import { base64url, EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";

export const SESSION_COOKIE = "jup_session";
const ONE_YEAR = 365 * 24 * 60 * 60;

export interface SessionPayload {
  userId: string;
  email: string;
}

function getKey(): Uint8Array {
  const secret = process.env.JWE_SECRET;
  if (!secret) throw new Error("JWE_SECRET not set");
  return base64url.decode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime("1y")
    .encrypt(getKey());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtDecrypt(token, getKey());
    if (
      typeof payload.userId === "string" &&
      typeof payload.email === "string"
    ) {
      return { userId: payload.userId, email: payload.email };
    }
  } catch {
    return null;
  }
  return null;
}

export function sessionCookieHeader(token: string): string {
  const securePart = process.env.NODE_ENV === "production" ? "Secure; " : "";
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; ${securePart}SameSite=Lax`;
}

export const getServerSession = cache(
  async (): Promise<SessionPayload | null> => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return verifySession(token);
  },
);
