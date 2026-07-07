"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { SignOutIcon } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import { SHEET_GROUPS, isNavActive } from "./nav";

/**
 * Bottom sheet opened by the "Menu" tab. Docks flush above the tab bar so
 * the bar stays visible and interactive: tapping Menu again (or the
 * backdrop, or Escape) closes it, tapping any other tab navigates away —
 * MobileTabBar also closes it on every pathname change.
 *
 * z-order contract: backdrop + panel sit at z-[60], above the floating
 * voice widget (z-50) so the menu takes focus, and below the tab bar
 * (z-[70]) so the toggle stays reachable.
 */
export function MobileMenuSheet({
  open,
  onClose,
  email,
}: {
  open: boolean;
  onClose: () => void;
  email?: string;
}) {
  const pathname = usePathname() ?? "/";
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; page scroll locks while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.button
          key="menu-backdrop"
          type="button"
          aria-label="Close menu"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="lg:hidden fixed inset-0 z-[60] cursor-default bg-bg/60 backdrop-blur-[2px]"
        />
      ) : null}
      {open ? (
        <motion.div
          key="menu-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          tabIndex={-1}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
          className={cn(
            "lg:hidden fixed inset-x-0 z-[60]",
            "bottom-[calc(4rem+env(safe-area-inset-bottom))]",
            "max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain",
            "rounded-t-2xl bg-surface-1/95 backdrop-blur-xl ring-1 ring-hairline",
            "shadow-[var(--shadow-pop)]",
            "px-4 pt-3 pb-4 outline-none",
          )}
        >
          <div
            aria-hidden
            className="mx-auto mb-2 h-1 w-9 rounded-full bg-surface-3"
          />

          {SHEET_GROUPS.map((group) => (
            <div key={group.label} className="pb-2">
              <p className="px-3 pb-1.5 pt-2 text-[11px] uppercase tracking-[0.14em] text-fg-subtle">
                {group.label}
              </p>
              <div className="grid grid-cols-2 gap-1">
                {group.items.map((item) => {
                  const active = isNavActive(item, pathname);
                  const ItemIcon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-11 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium",
                        "transition-colors duration-150",
                        active
                          ? "text-fg bg-surface-2 ring-1 ring-hairline"
                          : "text-fg-muted hover:text-fg hover:bg-surface-2 active:bg-surface-2",
                      )}
                    >
                      <ItemIcon
                        weight="regular"
                        className="h-[18px] w-[18px] shrink-0"
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mt-1 flex items-center gap-2 border-t border-hairline pt-3">
            {email ? (
              <span className="min-w-0 flex-1 truncate px-1 text-[12px] text-fg-subtle">
                {email}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <form action="/api/auth/logout" method="post" className="shrink-0">
              <button
                type="submit"
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium",
                  "text-fg-muted hover:text-fg hover:bg-surface-2",
                  "transition-colors duration-150",
                )}
              >
                <SignOutIcon weight="regular" className="h-4 w-4" />
                Sign out
              </button>
            </form>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
