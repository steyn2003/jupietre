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
  LightbulbIcon,
  CaretDownIcon,
  ClockIcon,
} from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Match prefix — `/sessions/[id]` should still highlight Sessions. */
  matchPrefix?: string;
};

type NavGroup = { label: string; items: NavItem[] };

// Primary items stay inline; everything else folds into the "More" menu so the
// bar never overflows. Grouped by domain inside the menu for scannability.
const PRIMARY: NavItem[] = [
  {
    href: "/",
    label: "Sessions",
    icon: <ChatCircleDotsIcon weight="regular" />,
    matchPrefix: "/sessions",
  },
  {
    href: "/improvements",
    label: "Improvements",
    icon: <LightbulbIcon weight="regular" />,
    matchPrefix: "/improvements",
  },
  {
    href: "/agents",
    label: "Agents",
    icon: <RobotIcon weight="regular" />,
    matchPrefix: "/agents",
  },
];

const MORE: NavGroup[] = [
  {
    label: "Build",
    items: [
      { href: "/skills", label: "Skills", icon: <BookOpenIcon weight="regular" />, matchPrefix: "/skills" },
      { href: "/repos", label: "Repos", icon: <GitBranchIcon weight="regular" />, matchPrefix: "/repos" },
    ],
  },
  {
    label: "Automate",
    items: [
      { href: "/workflows", label: "Workflows", icon: <FlowArrowIcon weight="regular" />, matchPrefix: "/workflows" },
      { href: "/workflow-runs", label: "Runs", icon: <PlayIcon weight="regular" />, matchPrefix: "/workflow-runs" },
      { href: "/pollers", label: "Pollers", icon: <KanbanIcon weight="regular" />, matchPrefix: "/pollers" },
      { href: "/schedules", label: "Schedules", icon: <ClockIcon weight="regular" />, matchPrefix: "/schedules" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/usage", label: "Usage", icon: <ChartLineUpIcon weight="regular" />, matchPrefix: "/usage" },
      { href: "/settings/team", label: "Team", icon: <UsersThreeIcon weight="regular" />, matchPrefix: "/settings" },
    ],
  },
];

export function TopNav({ email }: { email?: string }) {
  const pathname = usePathname() ?? "/";

  function isActive(item: NavItem) {
    if (item.href === "/") return pathname === "/" || pathname.startsWith("/sessions");
    return pathname === item.href || (item.matchPrefix && pathname.startsWith(item.matchPrefix));
  }

  const moreActive = MORE.some((g) => g.items.some(isActive));

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

        <nav className="flex flex-1 items-center gap-0.5">
          {PRIMARY.map((item) => {
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

          {/* "More" overflow. Native <details> = zero JS state. Clicking a link
              inside closes it by stripping the open attr on the closest details.
              ponytail: native popover; swap for a real menu if a11y review demands. */}
          <details className="group relative ml-0.5">
            <summary
              className={cn(
                "relative inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 h-9 text-[13px] font-medium",
                "[&::-webkit-details-marker]:hidden transition-colors",
                moreActive ? "text-fg bg-surface-2 ring-1 ring-hairline" : "text-fg-muted hover:text-fg",
              )}
            >
              More
              <CaretDownIcon weight="bold" className="h-3 w-3 transition-transform group-open:rotate-180" />
            </summary>
            <div
              onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
              className={cn(
                "absolute right-0 mt-2 w-52 rounded-2xl p-2",
                "bg-surface-1/95 backdrop-blur-xl ring-1 ring-hairline",
                "shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)]",
              )}
            >
              {MORE.map((group) => (
                <div key={group.label} className="py-1 first:pt-0 last:pb-0">
                  <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    {group.label}
                  </p>
                  {group.items.map((item) => {
                    const active = isActive(item);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl px-2.5 h-8 text-[13px] font-medium",
                          active ? "text-fg bg-surface-2" : "text-fg-muted hover:text-fg hover:bg-surface-2",
                        )}
                      >
                        <span className="inline-flex h-4 w-4 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
                          {item.icon}
                        </span>
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </details>
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
