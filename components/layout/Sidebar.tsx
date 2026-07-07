"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { SignOutIcon } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import { GROUPS, TOP_LEVEL, isNavActive, type NavItem } from "./nav";

/**
 * Desktop navigation rail (lg and up). Fixed to the left edge, full height —
 * every destination is always visible, grouped under small section labels.
 * The content well in AppShell reserves 240px on the left for it.
 *
 * The rail is `fixed`, so the body's safe-area padding doesn't reach it; it
 * carries its own env() insets (all zero on a normal desktop display).
 */
export function Sidebar({ email }: { email?: string }) {
  const pathname = usePathname() ?? "/";

  return (
    <aside
      className={cn(
        "hidden lg:flex fixed inset-y-0 left-0 z-40 flex-col",
        "w-[calc(240px+env(safe-area-inset-left))] pl-[env(safe-area-inset-left)]",
        "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        "bg-surface-1/70 backdrop-blur-xl border-r border-hairline",
      )}
    >
      <Link
        href="/"
        aria-label="Jupietre — Agent Management OS"
        className="flex items-center gap-2.5 px-5 pt-5 pb-2"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fg text-bg font-mono text-[13px] font-semibold">
          J
        </span>
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-[14px] font-medium tracking-tight text-fg">
            Jupietre
          </span>
          <span className="mt-1 text-[9.5px] uppercase tracking-[0.16em] text-fg-subtle">
            Agent Management OS
          </span>
        </span>
      </Link>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
        <div className="flex flex-col gap-0.5">
          {TOP_LEVEL.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isNavActive(item, pathname)}
            />
          ))}
        </div>

        {GROUPS.map((group) => (
          <div key={group.label} className="mt-6">
            <p className="px-3 pb-1.5 text-[11px] uppercase tracking-[0.14em] text-fg-subtle">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={isNavActive(item, pathname)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-1 border-t border-hairline px-4 py-3">
        {email ? (
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg-subtle">
            {email}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <form action="/api/auth/logout" method="post" className="shrink-0">
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full",
              "text-fg-muted hover:text-fg hover:bg-surface-2",
              "transition-colors duration-150",
            )}
          >
            <SignOutIcon weight="regular" className="h-4 w-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const ItemIcon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-9 items-center gap-2.5 rounded-full px-3 text-[13px] font-medium",
        "transition-colors duration-200 ease-[var(--ease-spring)]",
        active ? "text-fg" : "text-fg-muted hover:text-fg",
      )}
    >
      {active ? (
        <motion.span
          layoutId="sidebar-pill"
          className="absolute inset-0 rounded-full bg-surface-2 ring-1 ring-hairline"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      ) : null}
      <ItemIcon
        weight="regular"
        className="relative z-10 h-4 w-4 shrink-0"
      />
      <span className="relative z-10 truncate">{item.label}</span>
    </Link>
  );
}
