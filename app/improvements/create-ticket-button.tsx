"use client";

import { useState } from "react";
import { ArrowSquareOutIcon, TicketIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";

export function CreateTicketButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ url: string; identifier: string } | null>(
    null,
  );

  async function handleClick() {
    setBusy(true);
    try {
      const res = await fetch("/api/scout/ticket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        url?: string;
        identifier?: string;
      } | null;
      if (!res.ok || !data?.url) {
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setDone({ url: data.url, identifier: data.identifier ?? "issue" });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <a
        href={done.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:text-accent-strong"
      >
        {done.identifier}
        <ArrowSquareOutIcon weight="bold" className="h-3.5 w-3.5" />
      </a>
    );
  }

  return (
    <Button
      variant="secondary"
      type="button"
      loading={busy}
      disabled={busy}
      onClick={handleClick}
      trailingIcon={<TicketIcon weight="bold" className="h-3.5 w-3.5" />}
    >
      Create Linear ticket
    </Button>
  );
}
