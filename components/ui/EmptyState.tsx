import * as React from "react";
import { cn } from "./cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl ring-1 ring-hairline bg-surface-1/40 p-10",
        "flex flex-col items-center text-center gap-3",
        className,
      )}
    >
      {icon ? (
        <div className="h-11 w-11 rounded-2xl bg-surface-2 ring-1 ring-hairline flex items-center justify-center text-fg-muted shadow-[var(--shadow-inset-hi)]">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1 max-w-[42ch]">
        <h3 className="text-[15px] font-medium text-fg tracking-tight">
          {title}
        </h3>
        {description ? (
          <p className="text-[13px] text-fg-muted leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
