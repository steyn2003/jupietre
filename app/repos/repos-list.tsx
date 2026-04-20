"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/Badge";

interface RepoRow {
  id: string;
  slug: string;
  githubRepo: string;
  defaultBranch: string;
  clonePath: string;
  ownerId: string;
  teamId: string | null;
}

export function ReposList({
  initial,
  currentUserId,
}: {
  initial: RepoRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(r: RepoRow) {
    if (
      !confirm(
        `Delete repo "${r.slug}"?\n\nThis removes ${r.clonePath} from disk. Existing sessions keep their worktrees and continue to work; new sessions can no longer pick this repo.`,
      )
    )
      return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/repos/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
      {rows.map((r) => {
        const owned = r.ownerId === currentUserId;
        return (
          <li
            key={r.id}
            className="flex items-center gap-4 px-5 py-4 hover:bg-surface-2/60 transition-colors duration-150"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-medium text-fg">
                  {r.slug}
                </span>
                <Badge>
                  <span className="font-mono normal-case">{r.githubRepo}</span>
                </Badge>
                <Badge>
                  <span className="font-mono normal-case">
                    ↳ {r.defaultBranch}
                  </span>
                </Badge>
                {r.teamId ? <Badge tone="accent">Team</Badge> : null}
                {!owned ? <Badge>shared</Badge> : null}
              </div>
              <div className="mt-1 text-[12px] font-mono text-fg-subtle truncate">
                {r.clonePath}
              </div>
            </div>
            {owned ? (
              <IconButton
                variant="surface"
                size="sm"
                aria-label="Delete repo"
                title="Delete repo"
                onClick={() => handleDelete(r)}
                disabled={busyId === r.id}
              >
                <TrashIcon weight="regular" />
              </IconButton>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
