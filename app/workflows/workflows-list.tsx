"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface WorkflowRow {
  id: string;
  slug: string;
  name: string;
  nodeCount: number;
  transitionCount: number;
  ownerId: string;
  teamId: string | null;
}

export function WorkflowsList({
  initial,
  currentUserId,
}: {
  initial: WorkflowRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete workflow "${name}"? Existing runs are kept; new runs can't be started.`))
      return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setRows((r) => r.filter((x) => x.id !== id));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
      {rows.map((w) => {
        const mine = w.ownerId === currentUserId && w.teamId === null;
        return (
          <li key={w.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/workflows/${w.id}/edit`}
                  className="font-medium text-fg hover:underline truncate"
                >
                  {w.name}
                </Link>
                <code className="text-[11px] text-fg-subtle">{w.slug}</code>
                {w.teamId ? <Badge>team</Badge> : mine ? null : <Badge>shared</Badge>}
              </div>
              <div className="mt-0.5 text-[12px] text-fg-subtle">
                {w.nodeCount} nodes · {w.transitionCount} transitions
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/workflows/${w.id}/run`}>
                <Button size="sm">Start run</Button>
              </Link>
              <Link href={`/workflows/${w.id}/edit`}>
                <Button size="sm" variant="ghost">
                  Edit
                </Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                disabled={busyId === w.id}
                onClick={() => handleDelete(w.id, w.name)}
              >
                Delete
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
