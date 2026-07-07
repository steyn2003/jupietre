"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { SquaresFourIcon } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import { MOBILE_TABS, SHEET_GROUPS, isNavActive } from "./nav";
import { MobileMenuSheet } from "./MobileMenuSheet";

/**
 * Mobile navigation (below lg): a fixed bottom tab bar with the four
 * primary destinations plus a Menu tab that opens the grouped sheet with
 * everything else. Sized 64px tall with safe-area padding underneath so
 * the iPhone home indicator never overlaps the tabs (the bar is `fixed`,
 * so the body's own safe-area padding doesn't apply to it).
 */
export function MobileTabBar({ email }: { email?: string }) {
  const pathname = usePathname() ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);

  // Any navigation — tab tap, sheet link, in-page link — closes the sheet.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const tabActive = MOBILE_TABS.map((tab) => isNavActive(tab, pathname));
  // Menu lights up when the current page is only reachable through the sheet.
  const menuActive =
    !tabActive.some(Boolean) &&
    SHEET_GROUPS.some((group) =>
      group.items.some((item) => isNavActive(item, pathname)),
    );
  const menuHighlighted = menuOpen || menuActive;

  return (
    <>
      <MobileMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        email={email}
      />

      <nav
        aria-label="Primary"
        className={cn(
          "lg:hidden fixed inset-x-0 bottom-0 z-[70]",
          "bg-surface-1/85 backdrop-blur-xl border-t border-hairline",
          "pb-[env(safe-area-inset-bottom)]",
          "pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
        )}
      >
        <div className="flex h-16 items-stretch px-1">
          {MOBILE_TABS.map((tab, i) => {
            const active = tabActive[i];
            const TabIcon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-1",
                  "transition-colors duration-200",
                  active && !menuOpen ? "text-fg" : "text-fg-muted",
                )}
              >
                {active && !menuHighlighted ? <TabIndicator /> : null}
                <TabIcon
                  weight={active && !menuOpen ? "fill" : "regular"}
                  className="h-[22px] w-[22px]"
                />
                <span className="text-[10px] font-medium tracking-wide">
                  {tab.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1",
              "transition-colors duration-200",
              menuHighlighted ? "text-fg" : "text-fg-muted",
            )}
          >
            {menuHighlighted ? <TabIndicator /> : null}
            <SquaresFourIcon
              weight={menuHighlighted ? "fill" : "regular"}
              className="h-[22px] w-[22px]"
            />
            <span className="text-[10px] font-medium tracking-wide">Menu</span>
          </button>
        </div>
      </nav>
    </>
  );
}

/** Accent notch above the active tab — slides between tabs on navigation. */
function TabIndicator() {
  return (
    <motion.span
      layoutId="tab-indicator"
      className="absolute top-0 left-1/2 -ml-[18px] h-0.5 w-9 rounded-full bg-accent"
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    />
  );
}
