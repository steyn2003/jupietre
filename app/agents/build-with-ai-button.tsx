"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SparkleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";

export function BuildWithAiButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const res = await fetch("/api/agent-builder/start", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      router.push(`/sessions/${data.sessionId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="secondary"
      type="button"
      loading={busy}
      disabled={busy}
      onClick={handleClick}
      trailingIcon={<SparkleIcon weight="bold" className="h-3.5 w-3.5" />}
    >
      Build with AI
    </Button>
  );
}
