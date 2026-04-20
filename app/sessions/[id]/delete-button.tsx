"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/IconButton";

export function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    if (
      !confirm(
        "Delete this session?\n\nThe worktree under data/worktrees will be removed and the conversation history erased. Your source repo is untouched.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(data?.error ?? `Failed to delete (${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <IconButton
      variant="surface"
      size="sm"
      aria-label="Delete session"
      title="Delete session"
      onClick={handleClick}
      disabled={busy}
    >
      <TrashIcon weight="regular" />
    </IconButton>
  );
}
