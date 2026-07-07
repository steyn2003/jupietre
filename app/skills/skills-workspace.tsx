"use client";

import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { SkillsList, type SkillRow } from "./skills-list";
import { SkillDraftsReview, type DraftRow } from "./skill-drafts";

export function SkillsWorkspace({
  currentUserId,
  initialSkills,
  initialDrafts,
}: {
  currentUserId: string;
  initialSkills: SkillRow[];
  initialDrafts: DraftRow[];
}) {
  const [tab, setTab] = useState<"library" | "drafts">(
    initialDrafts.length > 0 ? "drafts" : "library",
  );
  const [draftCount, setDraftCount] = useState(initialDrafts.length);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 border-b border-hairline">
        <TabButton active={tab === "library"} onClick={() => setTab("library")}>
          Library
          <span className="ml-1.5 text-fg-subtle">{initialSkills.length}</span>
        </TabButton>
        <TabButton active={tab === "drafts"} onClick={() => setTab("drafts")}>
          Drafts
          {draftCount > 0 ? (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-soft px-1 text-[10px] font-semibold text-accent">
              {draftCount}
            </span>
          ) : null}
        </TabButton>
      </div>

      {tab === "library" ? (
        <SkillsList currentUserId={currentUserId} initial={initialSkills} />
      ) : (
        <SkillDraftsReview
          initial={initialDrafts}
          onCountChange={setDraftCount}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative -mb-px flex items-center px-4 py-2.5 text-[13px] font-medium transition-colors",
        active
          ? "text-fg border-b-2 border-[var(--accent)]"
          : "text-fg-muted border-b-2 border-transparent hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
