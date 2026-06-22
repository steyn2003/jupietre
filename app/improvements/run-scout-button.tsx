"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlayIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";

export function RunScoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState("");

  async function handleClick() {
    setBusy(true);
    try {
      const res = await fetch("/api/scout/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ focus: focus.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      // Sessions are created synchronously at the top of runScout, so a short
      // refresh surfaces them. New ones keep streaming in as repos are swept.
      setTimeout(() => router.refresh(), 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        placeholder="Focus (optional) — e.g. check for N+1"
        disabled={busy}
        className="h-9 w-64 rounded-lg bg-surface-1 ring-1 ring-hairline px-3 text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-accent"
      />
      <Button
        type="button"
        loading={busy}
        disabled={busy}
        onClick={handleClick}
        trailingIcon={<PlayIcon weight="bold" className="h-3.5 w-3.5" />}
      >
        Run scout now
      </Button>
    </div>
  );
}
