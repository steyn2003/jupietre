import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in — Jupietre" };

export default async function LoginPage() {
  const session = await getServerSession();
  if (session) redirect("/");

  return (
    <main className="relative min-h-[100dvh] flex items-center justify-center px-4 py-12 overflow-hidden">
      {/* Soft ambient glow — fixed, pointer-events-none, subtle */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]"
      >
        <div className="absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-fg text-bg font-mono text-[16px] font-semibold ring-1 ring-strong shadow-[var(--shadow-soft)]">
            J
          </div>
          <span className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle font-medium">
            Jupietre
          </span>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
