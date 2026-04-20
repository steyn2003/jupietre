import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { sessionArtifacts } from "./schema";

export type SessionArtifact = typeof sessionArtifacts.$inferSelect;
export type ArtifactKind = SessionArtifact["kind"];

interface RecordArtifactInput {
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  url?: string | null;
  summary?: string | null;
  externalId?: string | null;
  raw?: unknown;
}

/**
 * Insert an artifact, deduped on (sessionId, kind, externalId).
 * Returns the new or existing row.
 */
export async function recordArtifact(
  input: RecordArtifactInput,
): Promise<SessionArtifact> {
  const values = {
    id: nanoid(),
    sessionId: input.sessionId,
    kind: input.kind,
    title: input.title,
    url: input.url ?? null,
    summary: input.summary ?? null,
    externalId: input.externalId ?? nanoid(),
    raw: (input.raw ?? null) as unknown as object | null,
  };

  const [row] = await db
    .insert(sessionArtifacts)
    .values(values)
    .onConflictDoUpdate({
      target: [
        sessionArtifacts.sessionId,
        sessionArtifacts.kind,
        sessionArtifacts.externalId,
      ],
      set: {
        title: values.title,
        url: values.url,
        summary: values.summary,
        raw: values.raw,
      },
    })
    .returning();

  if (!row) throw new Error("recordArtifact returned no row");
  return row;
}

export async function listArtifactsForSession(
  sessionId: string,
): Promise<SessionArtifact[]> {
  return db
    .select()
    .from(sessionArtifacts)
    .where(eq(sessionArtifacts.sessionId, sessionId))
    .orderBy(asc(sessionArtifacts.createdAt));
}

export async function hasArtifact(
  sessionId: string,
  kind: ArtifactKind,
  externalId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: sessionArtifacts.id })
    .from(sessionArtifacts)
    .where(
      and(
        eq(sessionArtifacts.sessionId, sessionId),
        eq(sessionArtifacts.kind, kind),
        eq(sessionArtifacts.externalId, externalId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
