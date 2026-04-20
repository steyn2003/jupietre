"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CopyIcon, CheckIcon } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";

/**
 * Agent markdown renderer. GFM (tables, task lists, strikethrough) + syntax
 * highlighting via highlight.js (themed in globals.css under `.prose-msg`).
 * Block code gets a language label + copy button; inline code renders as a
 * tight tinted chip. All typography is scoped under `.prose-msg` so it can't
 * leak into the rest of the UI.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("prose-msg", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
          a: ({ children, href, ...rest }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:text-accent-strong underline-offset-2 hover:underline"
              {...rest}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement>) {
  const text = React.Children.toArray(children).join("");
  // hljs decorates block code with `language-xxx hljs` — inline code has neither.
  const match = /language-([\w-]+)/.exec(className ?? "");
  const isBlock = Boolean(match) || (className ?? "").includes("hljs");

  if (!isBlock) {
    return (
      <code
        className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[0.9em] font-mono text-fg ring-1 ring-hairline"
        {...rest}
      >
        {children}
      </code>
    );
  }

  const lang = match?.[1] ?? "text";
  return (
    <div className="relative my-3 rounded-xl ring-1 ring-hairline bg-bg overflow-hidden group/code">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-hairline">
        <span className="text-[10px] uppercase tracking-[0.12em] text-fg-subtle font-mono">
          {lang}
        </span>
        <CopyCodeButton text={text} />
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed">
        <code className={cn("font-mono", className)}>{children}</code>
      </pre>
    </div>
  );
}

function CopyCodeButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-fg-muted",
        "opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100",
        "hover:bg-surface-2 hover:text-fg transition-all duration-150",
      )}
    >
      {copied ? (
        <>
          <CheckIcon weight="bold" className="h-3 w-3" /> Copied
        </>
      ) : (
        <>
          <CopyIcon weight="regular" className="h-3 w-3" /> Copy
        </>
      )}
    </button>
  );
}
