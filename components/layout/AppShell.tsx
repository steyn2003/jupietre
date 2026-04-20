import * as React from "react";
import { TopNav } from "./TopNav";
import { Eyebrow } from "@/components/ui";
import { cn } from "@/components/ui/cn";

/**
 * Outer page chrome for authenticated routes. Renders the floating TopNav,
 * an optional page header (eyebrow + title + description + action), and a
 * width-constrained content well. Pass `fluid` to fill the viewport (used
 * by /sessions/[id] which manages its own column scroll).
 */
export function AppShell({
  email,
  eyebrow,
  title,
  description,
  action,
  back,
  fluid = false,
  className,
  children,
}: {
  email?: string;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Optional back-link rendered above the title. */
  back?: { href: string; label: string };
  fluid?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const hasHeader = Boolean(title || eyebrow || description || action || back);

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <TopNav email={email} />
      <main
        className={cn(
          "flex-1 mx-auto w-full px-4 sm:px-6",
          fluid ? "max-w-[1180px]" : "max-w-[920px]",
          "pt-6 pb-16",
          className,
        )}
      >
        {hasHeader ? (
          <header className="mb-8 flex flex-col gap-2">
            {back ? (
              <a
                href={back.href}
                className="text-[12px] text-fg-subtle hover:text-fg-muted transition-colors w-fit"
              >
                ← {back.label}
              </a>
            ) : null}
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="space-y-2 min-w-0">
                {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
                {title ? (
                  <h1 className="text-[28px] sm:text-[32px] font-medium text-fg tracking-tight leading-[1.1]">
                    {title}
                  </h1>
                ) : null}
                {description ? (
                  <p className="text-[14px] text-fg-muted leading-relaxed max-w-[60ch]">
                    {description}
                  </p>
                ) : null}
              </div>
              {action ? <div className="shrink-0">{action}</div> : null}
            </div>
          </header>
        ) : null}
        {children}
      </main>
    </div>
  );
}
