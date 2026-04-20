# Code Review Panel

> Successor to the existing `DiffPanel`. Turns "wall of `git diff` text" into a navigable per-file browser with syntax-highlighted diffs and full-file views. Pairs with M5 (approvals catch problems pre-execution) — this catches them post.

**Goal:** From any session, click a changed file → see its diff *and* its current full contents, syntax-highlighted, phone-readable. Each hunk links back to the assistant turn that wrote it.

---

## Chunks

### Chunk 1 — Per-file diff API

**Create:**
- `lib/git/file-diff.ts` — `getFileDiff(repoPath, filePath)` → `{ patch, currentContents, isBinary, sizeBytes, language }`. Uses `git diff HEAD -- <path>` for patch, `fs.readFile` for current contents. Detects binary via NUL-byte sniff in first 8 KB. Refuses files > 256 KB with `{ error: "too large" }`.
- `app/api/sessions/[id]/diff/file/route.ts` — GET `?path=<rel>`, ACL via `loadReadableSession`. Path validation: must be inside repoPath after `path.resolve`, no `..`.

**Detect language:**
- Map common extensions (.ts/.tsx/.js/.jsx/.py/.go/.rs/.java/.css/.html/.json/.md/.sql/.sh/.yml/.toml) to shiki language IDs. Fallback `text`.

### Chunk 2 — Syntax highlighting

**Add dep:**
- `shiki` (latest). Server-rendered HTML; client never loads grammars.

**Create:**
- `lib/highlight/highlighter.ts` — singleton `getHighlighter()` lazy-loads shiki with the `min-dark` theme + the language set we map. Cached on the module so subsequent renders are instant.
- `highlightFile(contents, lang)` → HTML string.
- `highlightDiff(patch, lang)` → HTML string with `+` lines tinted green and `-` red on top of the syntax color.

### Chunk 3 — File picker UI

**Modify:**
- `app/sessions/[id]/diff-panel.tsx` — keep the collapsed-by-default top-level toggle. When open, render a flat clickable list of `changedFiles` (existing data); selecting one fetches `/api/sessions/[id]/diff/file?path=...` and shows the result in a sub-panel.
- Selection state: single-file at a time. Show the path of the selected file as a sticky header.

**No tree / folder collapse for v1** — paths in the list, sorted alphabetically. Adds folder grouping later only if file counts get unwieldy.

### Chunk 4 — Patch + Full-file panes

**Create:**
- `app/sessions/[id]/file-view.tsx` — accepts the API payload + `language`. Two tabs:
  - **Patch** (default) — renders `highlightDiff` HTML
  - **Current file** — renders `highlightFile` HTML with line numbers
- Mobile: tabs always; desktop: same (simpler, consistent). Sticky tab bar so the long file doesn't scroll the tabs out of view.
- "(too large to render)" / "(binary)" friendly messages from the API plumb through.

### Chunk 5 — Hunk → assistant turn link

**Modify:**
- `lib/git/file-diff.ts` — parse hunk headers (`@@ -10,5 +10,7 @@`) and return `hunks: Array<{ header, oldStart, newStart, content }>`.
- API also returns `assistantTurns: number[]` — derived from `session_artifacts` rows where `kind = "file_change"` and `externalId = filePath`. We don't know per-hunk attribution, but we can list "this file was touched by turns N, M".
- `file-view.tsx` — small `↗ turn N` chips above the patch view. Click scrolls back to that message in the chat (page-anchor on `#msg-<id>`).

---

## Out of scope

- **Side-by-side split view.** Unified diffs only — easier to read on mobile, less code.
- **In-UI edits.** Read-only review.
- **Per-line "blame to PR" links.**
- **Folder tree with expand/collapse.** Flat alpha-sorted list until file counts genuinely hurt.
- **Image / non-text previews.** Show "binary" message.

---

## Open questions

- **Shiki theme:** `min-dark` matches the app palette; if it clashes, swap to `vitesse-dark`. Theme is one config line.
- **Cache strategy:** start with no caching beyond shiki's in-memory grammar cache. Per-file render is fast enough. Add LRU later if needed.
- **What about uncommitted, brand-new files?** `git diff HEAD -- file` shows them as add-everything; the patch view handles it. The "Current file" view shows the contents (only file on disk). Both work.
- **Anchor target for `#msg-<id>`:** session-chat's `MessageBubble` doesn't currently set an `id` on the wrapping element. Add one.

---

## Success criteria

1. Open Diff → click a changed `.ts` file → see syntax-highlighted unified patch (green/red), default tab.
2. Switch to "Current file" tab → see the full file contents with syntax + line numbers.
3. Files > 256 KB or binary show a friendly message instead of crashing.
4. Above the patch, chips like `↗ turn 7` link back to the assistant message that wrote that file (single click, smooth scroll).
5. Mobile: tabs stack reliably, file contents scroll inside the panel without scrolling the page.
