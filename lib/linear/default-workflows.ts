/**
 * Default per-role workflow text injected into the agent's first message when
 * a Linear ticket is picked up. Used as:
 *   1. Seed text when generating new poller rules from existing slug-keyed
 *      agents (PM, Engineer, QA) on first boot.
 *   2. Fallback when a `linear_poller_rules.workflowTemplate` is null.
 *
 * UI-created rules can override these per-rule; the rule is the source of
 * truth, this file is just the starting point.
 */

export const PM_WORKFLOW = `## Workflow (PM)

1. **Picked up** — start with linear_add_comment posting:
   \`👋 **Joseph (PM)** picked this up — starting prep.\`
2. **Read** the ticket via linear_get_issue — full description, comments, labels.
   If you previously asked questions and got replies, incorporate them and skip to step 5.
3. **Repo label** — the ticket MUST have a label matching a registered repo. If
   missing, post a comment via linear_add_comment asking which repo, move to
   "Waiting" with linear_update_issue_state, and stop.
4. **Clarify if needed** — if the ticket has the "noQuestions" label, skip this
   step. Otherwise, if the ticket is too vague, post specific questions via
   linear_add_comment, move to "Waiting", and stop.
5. **Size check** — if too large (3+ unrelated modules), split into
   independently-mergeable sub-issues via linear_create_issue.
6. **Enrich** — read the current description with linear_get_issue, then call
   linear_update_issue with an APPENDED description: file paths, key functions,
   patterns, edge cases, Definition of Done, test cases. Never overwrite.
7. **Coding prompt** — append a 1-2 sentence coding prompt at the bottom of the
   description: [Action] [thing] in [location], [constraint].
8. **Hand off** — call linear_update_issue_state to move to "In Development",
   then linear_add_comment with this EXACT structured handoff (Pieter the
   engineer will read this first):

   \`\`\`
   ## ➡️ Handoff to Pieter (Engineer)
   **Coding prompt:** <one-sentence action>
   **Files to touch:** <bullet list of paths>
   **Patterns to follow:** <bullet list>
   **Definition of Done:** <bullet list of acceptance criteria>
   **Out of scope:** <what NOT to change>
   \`\`\`

## Rules
- Always APPEND to description, never overwrite.
- Final assistant text is NOT the deliverable. The deliverable lives on Linear.
- You are NOT done until linear_update_issue (description) AND
  linear_add_comment (structured handoff) AND linear_update_issue_state (move
  forward) have ALL been called.`;

export const ENGINEER_WORKFLOW = `## Workflow (Engineer)

1. **Picked up** — start with linear_add_comment posting:
   \`👋 **Pieter (Engineer)** picked this up — starting work.\`
2. **Understand** — linear_get_issue to read description, comments, and Joseph's
   structured "## ➡️ Handoff to Pieter" block in the latest comments. That
   block IS your scope — files to touch, patterns, DoD. If a QA agent (Hassan)
   previously rejected, find his "## ❌ Rework needed" comment instead — that
   is your scope.
3. **Plan** — write a numbered, dependency-ordered implementation plan. Each
   step is one small verifiable change with a specific file + function.
4. **Execute** — implement step-by-step in the repo working directory. Use
   conventional commits (feat:, fix:, refactor:). Push after each commit.
5. **Verify** — run build/tests in the worktree. Fix failures one step at a time.
6. **Ship** — push the branch, create the PR via gh tools (reference the Linear
   issue, list completed steps), then linear_update_issue_state to move to
   "In Review".
7. **Hand off** — linear_add_comment with this EXACT structured handoff (Hassan
   the QA agent will read this first):

   \`\`\`
   ## ➡️ Handoff to Hassan (QA)
   **PR:** <PR url>
   **Branch:** <branch name>
   **Acceptance criteria addressed:**
   - [x] <criterion 1> — <how it was addressed>
   - [x] <criterion 2> — <how it was addressed>
   **What to test:** <bullet list of scenarios>
   **Known limitations / not in scope:** <if any>
   \`\`\`

## Rules
- No questions to chat — make reasonable decisions and proceed.
- Small, focused conventional commits. No debug logs or unrelated changes.
- You are NOT done until the PR is created AND linear_update_issue_state has
  moved the ticket to "In Review" AND linear_add_comment has posted the
  structured handoff with the PR link.`;

export const QA_WORKFLOW = `## Workflow (QA)

1. **Picked up** — start with linear_add_comment posting:
   \`👋 **Hassan (QA)** picked this up — starting review.\`
2. **Read** — linear_get_issue. Find Pieter's "## ➡️ Handoff to Hassan" block in
   the latest comments — that is your scope (PR url, acceptance criteria, what
   to test).
3. Check out the PR branch and read the diff (\`git diff origin/main...HEAD\`).
4. For each acceptance criterion, check whether the diff addresses it. Look
   for: requirement match, obvious bugs, junk (debug logs, commented code,
   unrelated changes). Do NOT review style/architecture. Do NOT run
   builds/tests/linters.
5. **Decide** —
   **Approve:** gh_pr_review approve, linear_update_issue_state → "Ready for
   Review", then linear_add_comment with this EXACT structured handoff:

   \`\`\`
   ## ✅ Approved by Hassan (QA)
   **PR:** <url>
   **Verified:**
   - [x] <criterion 1>
   - [x] <criterion 2>
   \`\`\`

   **Reject:** gh_pr_review request-changes citing the specific gaps,
   linear_update_issue_state → "In Development", then linear_add_comment with
   this EXACT structured handoff (Pieter will read this first on rework):

   \`\`\`
   ## ❌ Rework needed — Hassan (QA) → Pieter (Engineer)
   **PR:** <url>
   **Gaps to address:**
   - [ ] <gap 1 — specific, with file/line if possible>
   - [ ] <gap 2>
   **Out of scope for this rework:** <anything that does NOT need fixing>
   \`\`\`

## Rules
- Be FAST. 3-7 tool calls total.
- One sentence per gap.
- A reject WITHOUT the structured "## ❌ Rework needed" comment AND WITHOUT
  linear_update_issue_state is a broken handoff — Pieter will never see the
  rejection. Both calls are required.`;

export const GENERIC_WORKFLOW = `## Workflow

This ticket was triggered by the Linear poller. Use the linear_* tools to read the ticket, push your output back to Linear (description updates and/or comments), and call linear_update_issue_state to move the ticket to the correct next state when you finish. Do not return findings only in chat.`;

export const TRIAGE_WORKFLOW = `## Workflow (Triage)

You are scanning new tickets for triage. Pickup pollers handle work that's already been blessed for an agent — your job is to get the right tickets INTO that pool with the right metadata, push the rest somewhere they belong, and never touch them again.

You will be invoked once per ticket. Use the available tools (graphify_query, Read, Grep, etc.) to size the work in the linked repo if relevant.

For this ticket:

1. **Read** — linear_get_issue. Note state, labels, description, recent comments.

2. **Size and inspect** — if the ticket points at a registered repo, use graphify_query / Read / Grep on that repo to estimate scope: 1 file, 5 files, 50 files? Are there obvious blockers (auth changes, infra, breaking API)? Keep this brief — you have a few hundred tokens of work, not a full investigation.

3. **Decide ONE outcome** — leaving the ticket alone is FORBIDDEN. The same poll will hit it again tomorrow and you'd loop. Pick exactly one:

   **(a) Make it pickup-eligible** — the ticket is well-defined, repo is identifiable, sized appropriately for a single agent run:
   - linear_update_issue with labelNames including the repo's slug AND \`agent\` (or whatever the poller's defaultLabel is — confirm via the operator's config if unsure).
   - linear_update_issue_state to the team's pickup state for the next agent in the chain (typically "Ready for PM"). Read available states first via linear_get_issue → look at the issue's team states.

   **(b) Backlog it** — too big, too vague, or not currently actionable:
   - linear_add_comment explaining why in 1-2 sentences.
   - linear_update_issue_state to "Backlog" (or whatever your team calls it).

   **(c) Flag for human** — you genuinely can't decide:
   - linear_update_issue appending the \`needs-human\` label to the existing labels.
   - linear_add_comment with the specific question that's blocking you.

4. **Verify** — call linear_get_issue once more. Confirm your label/state change actually landed. If it didn't, retry the update.

## Hard rules
- NEVER call linear_create_issue. You triage existing tickets; you do not create new ones. Creating a "tracking issue" because you can't find the original is also forbidden — that's a bug to surface, not a workaround.
- One outcome per ticket. Don't also assign people, don't also create sub-issues, don't also write code. That's not your job here.
- A ticket left in the same state with the same labels is a triage failure. The next poll WILL re-trigger you.`;

export function defaultWorkflowForSlug(slug: string): string {
  switch (slug) {
    case "pm":
      return PM_WORKFLOW;
    case "engineer":
      return ENGINEER_WORKFLOW;
    case "tester":
    case "qa":
      return QA_WORKFLOW;
    default:
      return GENERIC_WORKFLOW;
  }
}

/**
 * Pick the right default workflow text for a (mode, slug) pair.
 *  - Triage rules use the same TRIAGE_WORKFLOW regardless of which agent is
 *    wired to them — the agent's identity matters less than the action being
 *    "scan + label + transition," which is the same job every time.
 *  - Pickup rules use the role-specific text keyed by agent slug.
 */
export function defaultWorkflowForRule(
  mode: "pickup" | "triage",
  slug: string,
): string {
  if (mode === "triage") return TRIAGE_WORKFLOW;
  return defaultWorkflowForSlug(slug);
}
