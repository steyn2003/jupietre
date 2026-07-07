import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { ConstellationBackground } from "@/components/visual/ConstellationBackground";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in — Jupietre" };

export default async function LoginPage() {
  const session = await getServerSession();
  if (session) redirect("/");

  return (
    <main className="relative min-h-[100dvh] flex items-center justify-center px-4 py-12 overflow-hidden">
      {/* Ambient agent constellation — a live 3D network drifting behind the
          card. Pointer-events-none so it never intercepts the form. */}
      <ConstellationBackground className="pointer-events-none absolute inset-0" />

      {/* Vignette scrim — darkens the centre so the card stays perfectly
          legible while the constellation still breathes at the edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_center,rgba(11,11,12,0.86)_0%,rgba(11,11,12,0.55)_38%,rgba(11,11,12,0.15)_70%,transparent_100%)]"
      />

      <div className="relative z-10 w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-fg text-bg font-mono text-[16px] font-semibold ring-1 ring-strong shadow-[var(--shadow-soft)]">
            J
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[14px] font-medium tracking-tight text-fg">
              Jupietre
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle font-medium">
              Agent Management OS
            </span>
          </div>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
