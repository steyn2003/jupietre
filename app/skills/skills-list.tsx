"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpenIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  ownerId: string;
  teamId: string | null;
}

export function SkillsList({
  initial,
  currentUserId,
}: {
  initial: SkillRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete skill "${name}"? This cannot be undone.`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/skills/${id}`, { method: "DELETE" });
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

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<BookOpenIcon weight="regular" className="h-5 w-5" />}
        title="No skills yet"
        description="A skill is a markdown file with frontmatter (name + description) and a body of instructions. The agent loads it lazily when its description matches what the agent is about to do."
        action={
          <Link href="/skills/new">
            <Button>Create your first skill</Button>
          </Link>
        }
      />
    );
  }

  return (
    <ul className="rounded-2xl ring-1 ring-hairline bg-surface-1/60 divide-y divide-hairline overflow-hidden">
      <AnimatePresence initial={false}>
        {rows.map((s) => {
          const mine = s.ownerId === currentUserId;
          return (
            <motion.li
              key={s.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-start justify-between gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-medium text-fg truncate">
                    {s.name}
                  </span>
                  <Badge>
                    <span className="font-mono normal-case">{s.slug}</span>
                  </Badge>
                  {s.teamId ? <Badge>Team</Badge> : null}
                </div>
                <p className="mt-1 text-[12px] text-fg-muted line-clamp-2 leading-relaxed">
                  {s.description}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {mine ? (
                  <>
                    <Link href={`/skills/${s.id}/edit`}>
                      <Button variant="secondary" size="sm">
                        Edit
                      </Button>
                    </Link>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busyId === s.id}
                      loading={busyId === s.id}
                      onClick={() => handleDelete(s.id, s.name)}
                    >
                      Delete
                    </Button>
                  </>
                ) : (
                  <span className="text-[11px] text-fg-subtle italic">
                    {s.teamId ? "owner-only" : "shared"}
                  </span>
                )}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
