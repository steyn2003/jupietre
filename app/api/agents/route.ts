import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  createAgentConfig,
  listAgentConfigs,
} from "@/lib/db/agent-configs";

const createSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(2)
    .max(40),
  name: z.string().min(1).max(80),
  systemPrompt: z.string().min(1).max(10_000),
  model: z.string().min(1),
  fallbackModel: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).optional(),
  includeProjectSkills: z.boolean().default(true),
  selectedSkills: z.array(z.string()).nullable().optional(),
  maxTurns: z.number().int().min(1).max(1000).default(100),
  effort: z.enum(["low", "medium", "high", "max"]).default("high"),
  maxBudgetUsd: z.number().int().positive().nullable().optional(),
  dailyBudgetUsd: z.number().int().positive().nullable().optional(),
  monthlyBudgetUsd: z.number().int().positive().nullable().optional(),
  enableLinearTools: z.boolean().default(false),
  enableGithubTools: z.boolean().default(false),
  enableAgentTools: z.boolean().default(false),
  approvalMode: z.enum(["none", "list", "all"]).default("none"),
  approvalTools: z.array(z.string()).default([]),
  approvalTimeoutSeconds: z.number().int().min(5).max(3600).default(300),
});

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await listAgentConfigs(session.userId);
  return Response.json({ agents: rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  try {
    const row = await createAgentConfig({
      userId: session.userId,
      slug: d.slug,
      name: d.name,
      systemPrompt: d.systemPrompt,
      model: d.model,
      fallbackModel: d.fallbackModel ?? null,
      allowedTools: d.allowedTools ?? null,
      disallowedTools: d.disallowedTools ?? [],
      includeProjectSkills: d.includeProjectSkills ? 1 : 0,
      selectedSkills: d.selectedSkills ?? null,
      maxTurns: d.maxTurns,
      effort: d.effort,
      maxBudgetUsd: d.maxBudgetUsd ?? null,
      dailyBudgetUsd: d.dailyBudgetUsd ?? null,
      monthlyBudgetUsd: d.monthlyBudgetUsd ?? null,
      enableLinearTools: d.enableLinearTools ? 1 : 0,
      enableGithubTools: d.enableGithubTools ? 1 : 0,
      enableAgentTools: d.enableAgentTools ? 1 : 0,
      approvalMode: d.approvalMode,
      approvalTools: d.approvalTools,
      approvalTimeoutSeconds: d.approvalTimeoutSeconds,
    });
    return Response.json({ agent: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      return Response.json(
        { error: `Slug "${d.slug}" already in use` },
        { status: 409 },
      );
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
