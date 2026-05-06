"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChatCircleDotsIcon,
  RobotIcon,
  ChartLineUpIcon,
  UsersThreeIcon,
  SignOutIcon,
  GitBranchIcon,
  FlowArrowIcon,
  PlayIcon,
  KanbanIcon,
  BookOpenIcon,
} from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Match prefix — `/sessions/[id]` should still highlight Sessions. */
  matchPrefix?: string;
};

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Sessions",
    icon: <ChatCircleDotsIcon weight="regular" />,
    matchPrefix: "/sessions",
  },
  {
    href: "/agents",
    label: "Agents",
    icon: <RobotIcon weight="regular" />,
    matchPrefix: "/agents",
  },
  {
    href: "/skills",
    label: "Skills",
    icon: <BookOpenIcon weight="regular" />,
    matchPrefix: "/skills",
  },
  {
    href: "/repos",
    label: "Repos",
    icon: <GitBranchIcon weight="regular" />,
    matchPrefix: "/repos",
  },
  {
    href: "/workflows",
    label: "Workflows",
    icon: <FlowArrowIcon weight="regular" />,
    matchPrefix: "/workflows",
  },
  {
    href: "/workflow-runs",
    label: "Runs",
    icon: <PlayIcon weight="regular" />,
    matchPrefix: "/workflow-runs",
  },
  {
    href: "/pollers",
    label: "Pollers",
    icon: <KanbanIcon weight="regular" />,
    matchPrefix: "/pollers",
  },
  {
    href: "/usage",
    label: "Usage",
    icon: <ChartLineUpIcon weight="regular" />,
    matchPrefix: "/usage",
  },
  {
    href: "/settings/team",
    label: "Team",
    icon: <UsersThreeIcon weight="regular" />,
    matchPrefix: "/settings",
  },
];

export function TopNav({ email }: { email?: string }) {
  const pathname = usePathname() ?? "/";

  function isActive(item: NavItem) {
    if (item.href === "/") return pathname === "/" || pathname.startsWith("/sessions");
    return pathname === item.href || (item.matchPrefix && pathname.startsWith(item.matchPrefix));
  }

  return (
    <header className="sticky top-3 z-40 mx-auto w-full max-w-[1180px] px-3 sm:px-4">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full p-1.5",
          "bg-surface-1/70 backdrop-blur-xl ring-1 ring-hairline",
          "shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)]",
        )}
      >
        {/* brand mark */}
        <Link
          href="/"
          aria-label="Jupietre — Sessions"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg text-bg font-mono text-[13px] font-semibold"
        >
          J
        </Link>

        <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {NAV.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative inline-flex items-center gap-2 rounded-full px-3.5 h-9 text-[13px] font-medium",
                  "transition-colors duration-200 ease-[var(--ease-spring)]",
                  active ? "text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-surface-2 ring-1 ring-hairline"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                ) : null}
                <span className="relative z-10 inline-flex h-4 w-4 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
                  {item.icon}
                </span>
                <span className="relative z-10 hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {email ? (
          <span className="hidden md:inline truncate max-w-[160px] px-2 text-[12px] text-fg-subtle">
            {email}
          </span>
        ) : null}

        <form action="/api/auth/logout" method="post" className="shrink-0">
          <button
            type="submit"
            aria-label="Sign out"
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-full",
              "text-fg-muted hover:text-fg hover:bg-surface-2",
              "transition-colors duration-150",
            )}
          >
            <SignOutIcon weight="regular" className="h-4 w-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
