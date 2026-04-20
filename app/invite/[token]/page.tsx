import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { getInviteByToken } from "@/lib/auth/invites";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Badge";
import { AcceptInviteForm } from "./accept-form";

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-[100dvh] flex items-center justify-center px-4 py-12 overflow-hidden">
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
        {children}
      </div>
    </main>
  );
}

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await getInviteByToken(token);

  if (!invite) {
    return (
      <PublicShell>
        <Card elevated>
          <div className="space-y-3">
            <Eyebrow>Invite</Eyebrow>
            <h1 className="text-[22px] font-medium text-fg tracking-tight">
              Invite not found
            </h1>
            <p className="text-[13px] text-fg-muted leading-relaxed">
              The link is invalid or has been revoked. Ask the person who
              invited you for a fresh link.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:text-accent-strong transition-colors"
            >
              Sign in instead
              <ArrowRightIcon weight="bold" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Card>
      </PublicShell>
    );
  }

  if (invite.consumedAt) {
    return (
      <PublicShell>
        <Card elevated>
          <div className="space-y-3">
            <Eyebrow>Invite</Eyebrow>
            <h1 className="text-[22px] font-medium text-fg tracking-tight">
              Invite already used
            </h1>
            <p className="text-[13px] text-fg-muted leading-relaxed">
              This invite was redeemed on{" "}
              {invite.consumedAt.toLocaleString()}. Sign in if it&apos;s your
              account.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:text-accent-strong transition-colors"
            >
              Go to login
              <ArrowRightIcon weight="bold" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Card>
      </PublicShell>
    );
  }

  if (invite.expiresAt < new Date()) {
    return (
      <PublicShell>
        <Card elevated>
          <div className="space-y-3">
            <Eyebrow>Invite</Eyebrow>
            <h1 className="text-[22px] font-medium text-fg tracking-tight">
              Invite expired
            </h1>
            <p className="text-[13px] text-fg-muted leading-relaxed">
              Ask for a new invite — links are good for 7 days.
            </p>
          </div>
        </Card>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <Card elevated>
        <div className="space-y-2 mb-2">
          <Eyebrow>You&apos;re invited</Eyebrow>
          <h1 className="text-[24px] font-medium text-fg tracking-tight leading-tight">
            Welcome to Jupietre
          </h1>
          <p className="text-[13px] text-fg-muted leading-relaxed">
            Setting up{" "}
            <code className="font-mono text-fg">{invite.email}</code>
            {invite.teamId ? " — joining a team." : "."}
          </p>
        </div>
        <AcceptInviteForm token={token} />
      </Card>
    </PublicShell>
  );
}
