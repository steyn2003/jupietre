import * as React from "react";
import { cn } from "./cn";

const baseInput = cn(
  "w-full rounded-xl bg-surface-1 border border-hairline",
  "px-3.5 h-11 text-sm text-fg placeholder:text-fg-subtle",
  "transition-colors duration-150",
  "hover:border-strong",
  "focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-accent-soft",
  "disabled:opacity-50 disabled:cursor-not-allowed",
);

export type FieldProps = {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
};

export function Field({
  label,
  description,
  error,
  required,
  htmlFor,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-[13px] font-medium text-fg flex items-center gap-1"
        >
          {label}
          {required ? <span className="text-danger">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[12px] text-danger">{error}</p>
      ) : description ? (
        <p className="text-[12px] text-fg-muted">{description}</p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        baseInput,
        invalid && "border-danger focus:border-danger focus:ring-danger-soft",
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        baseInput,
        "h-auto py-3 leading-relaxed resize-y min-h-[80px]",
        invalid && "border-danger focus:border-danger focus:ring-danger-soft",
        className,
      )}
      {...rest}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        baseInput,
        "appearance-none pr-9 bg-[length:14px] bg-no-repeat bg-[right_0.875rem_center] cursor-pointer",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22%23a1a1a8%22%3E%3Cpath%20d%3D%22M4.5%206.5L8%2010l3.5-3.5%22%20stroke%3D%22%23a1a1a8%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')]",
        invalid && "border-danger focus:border-danger focus:ring-danger-soft",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
