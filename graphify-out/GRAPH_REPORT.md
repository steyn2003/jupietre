# Graph Report - C:\Users\steyn\Paddock\jupietre-1 (app+lib+components)  (2026-04-24)

## Corpus Check
- 98 files · ~37,183 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 395 nodes · 621 edges · 41 communities detected
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 107 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Route Handlers|API Route Handlers]]
- [[_COMMUNITY_Dashboard Forms & Lists|Dashboard Forms & Lists]]
- [[_COMMUNITY_Usage & Budget Tracking|Usage & Budget Tracking]]
- [[_COMMUNITY_Repo & Worktree Management|Repo & Worktree Management]]
- [[_COMMUNITY_Agent Runner & Artifacts|Agent Runner & Artifacts]]
- [[_COMMUNITY_Agent Config CRUD|Agent Config CRUD]]
- [[_COMMUNITY_MCP Tools (GitHub, Linear)|MCP Tools (GitHub, Linear)]]
- [[_COMMUNITY_Invite Flow|Invite Flow]]
- [[_COMMUNITY_Tool Approval Flow|Tool Approval Flow]]
- [[_COMMUNITY_Team Settings & Membership|Team Settings & Membership]]
- [[_COMMUNITY_Linear Issue Poller|Linear Issue Poller]]
- [[_COMMUNITY_Schedule Windows|Schedule Windows]]
- [[_COMMUNITY_Git File Diff|Git File Diff]]
- [[_COMMUNITY_Syntax Highlighter|Syntax Highlighter]]
- [[_COMMUNITY_Session Chat UI|Session Chat UI]]
- [[_COMMUNITY_Session Auth (SignVerify)|Session Auth (Sign/Verify)]]
- [[_COMMUNITY_Brand Icon  Favicon|Brand Icon / Favicon]]
- [[_COMMUNITY_Session Forking|Session Forking]]
- [[_COMMUNITY_Agent Form Component|Agent Form Component]]
- [[_COMMUNITY_New Session Form|New Session Form]]
- [[_COMMUNITY_Diff Panel Component|Diff Panel Component]]
- [[_COMMUNITY_Env Loader|Env Loader]]
- [[_COMMUNITY_Git Repo Diff|Git Repo Diff]]
- [[_COMMUNITY_Relative Time Hook|Relative Time Hook]]
- [[_COMMUNITY_App Manifest|App Manifest]]
- [[_COMMUNITY_New Agent Page|New Agent Page]]
- [[_COMMUNITY_Login Page|Login Page]]
- [[_COMMUNITY_New Repo Page|New Repo Page]]
- [[_COMMUNITY_Delete Session Button|Delete Session Button]]
- [[_COMMUNITY_Sparkline Chart|Sparkline Chart]]
- [[_COMMUNITY_Agent Config Loader|Agent Config Loader]]
- [[_COMMUNITY_DB Migrations|DB Migrations]]
- [[_COMMUNITY_Auto-Grow Textarea Hook|Auto-Grow Textarea Hook]]
- [[_COMMUNITY_UI Density Hook|UI Density Hook]]
- [[_COMMUNITY_Stick-to-Bottom Hook|Stick-to-Bottom Hook]]
- [[_COMMUNITY_Top Nav|Top Nav]]
- [[_COMMUNITY_Card Component|Card Component]]
- [[_COMMUNITY_classNames Utility|classNames Utility]]
- [[_COMMUNITY_Field Component|Field Component]]
- [[_COMMUNITY_Icon Button|Icon Button]]
- [[_COMMUNITY_Skeleton Loader|Skeleton Loader]]

## God Nodes (most connected - your core abstractions)
1. `POST()` - 44 edges
2. `GET()` - 40 edges
3. `DELETE()` - 21 edges
4. `refresh()` - 11 edges
5. `pollOnce()` - 11 edges
6. `registerRepo()` - 10 edges
7. `startOfDayUtc()` - 9 edges
8. `git()` - 9 edges
9. `getMyTeamIds()` - 8 edges
10. `loadReadableSession()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `AgentsPage()` --calls--> `getMyTeamIds()`  [INFERRED]
  C:\Users\steyn\Paddock\jupietre-1\app\agents\page.tsx → C:\Users\steyn\Paddock\jupietre-1\lib\auth\authz.ts
- `EditAgentPage()` --calls--> `canEditAgent()`  [INFERRED]
  C:\Users\steyn\Paddock\jupietre-1\app\agents\[id]\edit\page.tsx → C:\Users\steyn\Paddock\jupietre-1\lib\auth\authz.ts
- `GET()` --calls--> `listAgentConfigs()`  [INFERRED]
  C:\Users\steyn\Paddock\jupietre-1\app\api\teams\route.ts → C:\Users\steyn\Paddock\jupietre-1\lib\db\agent-configs.ts
- `GET()` --calls--> `getAgentConfigById()`  [INFERRED]
  C:\Users\steyn\Paddock\jupietre-1\app\api\teams\route.ts → C:\Users\steyn\Paddock\jupietre-1\lib\db\agent-configs.ts
- `GET()` --calls--> `listInvitesByInviter()`  [INFERRED]
  C:\Users\steyn\Paddock\jupietre-1\app\api\teams\route.ts → C:\Users\steyn\Paddock\jupietre-1\lib\auth\invites.ts

## Communities

### Community 0 - "API Route Handlers"
Cohesion: 0.05
Nodes (18): canEditAgent(), canEditRepo(), canReadSession(), canUseAgent(), canUseRepo(), canWriteSession(), getMyTeamIds(), isTeamOwner() (+10 more)

### Community 1 - "Dashboard Forms & Lists"
Cohesion: 0.1
Nodes (12): handleSubmit(), handleDelete(), handleSubmit(), handleGithubChange(), handleSubmit(), handleDelete(), refresh(), copy() (+4 more)

### Community 2 - "Usage & Budget Tracking"
Cohesion: 0.19
Nodes (16): canStartSession(), fmtUsd(), getPerMemberBreakdown(), getAgentBreakdown(), getAgentSpendWindow(), getDailySpendSeries(), getTeamSpendWindow(), getTeamsSpendWindow() (+8 more)

### Community 3 - "Repo & Worktree Management"
Cohesion: 0.22
Nodes (18): clonePathForSlug(), cloneUrlFor(), detectDefaultBranch(), effectiveCwd(), fetchRepo(), git(), listAllRepos(), provisionWorktree() (+10 more)

### Community 4 - "Agent Runner & Artifacts"
Cohesion: 0.2
Nodes (18): hasArtifact(), listArtifactsForSession(), recordArtifact(), buildForkTranscript(), captureCommitArtifacts(), captureFileChangeArtifacts(), drainPendingUserText(), emit() (+10 more)

### Community 5 - "Agent Config CRUD"
Cohesion: 0.15
Nodes (12): createAgentConfig(), deleteAgentConfig(), ensureBuiltInAgentConfigs(), getAgentConfig(), getAgentConfigById(), getAgentConfigBySlug(), listAgentConfigs(), listVisibleAgentConfigs() (+4 more)

### Community 6 - "MCP Tools (GitHub, Linear)"
Cohesion: 0.16
Nodes (12): buildGithubTools(), installDeps(), resolveRepoSlug(), run(), worktreePathFor(), worktreesRoot(), buildMcpServersForSession(), buildLinearTools() (+4 more)

### Community 7 - "Invite Flow"
Cohesion: 0.26
Nodes (9): buildInviteUrl(), createInvite(), getInviteByToken(), listInvitesByInviter(), listInvitesByTeam(), redeemInvite(), revokeInvite(), AcceptInvitePage() (+1 more)

### Community 8 - "Tool Approval Flow"
Cohesion: 0.22
Nodes (7): createApprovalRequest(), decideApprovalRequest(), getApprovalRequest(), listPendingApprovalsForSession(), makeCanUseTool(), publishDecision(), waitForDecision()

### Community 9 - "Team Settings & Membership"
Cohesion: 0.31
Nodes (6): TeamSettingsPage(), createTeam(), getTeamMember(), listMembers(), listTeamsForUser(), removeMember()

### Community 10 - "Linear Issue Poller"
Cohesion: 0.51
Nodes (8): buildPriorContext(), buildRepoMap(), envKeyForSlug(), findAdminUserId(), loadPickupConfigs(), pollOnce(), startLinearPoller(), workflowForSlug()

### Community 11 - "Schedule Windows"
Cohesion: 0.5
Nodes (7): getNow(), getScheduleDescription(), isWithinSchedule(), loadConfig(), msUntilNextWindow(), parseDays(), parseTime()

### Community 12 - "Git File Diff"
Cohesion: 0.67
Nodes (5): detectLanguage(), getFileDiff(), looksBinary(), parseHunks(), safeResolveInRepo()

### Community 13 - "Syntax Highlighter"
Cohesion: 0.67
Nodes (5): getHighlighter(), highlightDiff(), highlightFile(), isLoaded(), safeLang()

### Community 14 - "Session Chat UI"
Cohesion: 0.48
Nodes (5): cn(), decideApproval(), flush(), handleFork(), handleSend()

### Community 15 - "Session Auth (Sign/Verify)"
Cohesion: 0.67
Nodes (4): getKey(), sessionCookieHeader(), signSession(), verifySession()

### Community 16 - "Brand Icon / Favicon"
Cohesion: 0.4
Nodes (6): Color Palette: Near-Black #0a0a0a + Blue #3b82f6, Jupietre App Icon (SVG), Jupietre Brand Identity, Jupietre Favicon / App Icon Asset, Letter 'J' Wordmark, Next.js app/icon.svg Convention

### Community 17 - "Session Forking"
Cohesion: 0.5
Nodes (2): ForkError, forkSession()

### Community 18 - "Agent Form Component"
Cohesion: 0.67
Nodes (2): AgentForm(), cn()

### Community 19 - "New Session Form"
Cohesion: 0.67
Nodes (2): handleRepoChange(), handleSubmit()

### Community 20 - "Diff Panel Component"
Cohesion: 0.67
Nodes (2): cn(), refresh()

### Community 21 - "Env Loader"
Cohesion: 0.83
Nodes (2): getEnv(), loadEnv()

### Community 22 - "Git Repo Diff"
Cohesion: 0.83
Nodes (2): getRepoDiff(), git()

### Community 23 - "Relative Time Hook"
Cohesion: 0.83
Nodes (2): format(), useRelativeTime()

### Community 24 - "App Manifest"
Cohesion: 0.67
Nodes (1): manifest()

### Community 25 - "New Agent Page"
Cohesion: 0.67
Nodes (1): NewAgentPage()

### Community 26 - "Login Page"
Cohesion: 0.67
Nodes (1): LoginPage()

### Community 27 - "New Repo Page"
Cohesion: 0.67
Nodes (1): NewRepoPage()

### Community 28 - "Delete Session Button"
Cohesion: 0.67
Nodes (1): DeleteSessionButton()

### Community 29 - "Sparkline Chart"
Cohesion: 0.67
Nodes (1): Sparkline()

### Community 30 - "Agent Config Loader"
Cohesion: 0.67
Nodes (1): buildSdkOptionsFromConfig()

### Community 31 - "DB Migrations"
Cohesion: 0.67
Nodes (1): runMigrations()

### Community 32 - "Auto-Grow Textarea Hook"
Cohesion: 0.67
Nodes (1): useAutoGrow()

### Community 33 - "UI Density Hook"
Cohesion: 0.67
Nodes (1): useDensity()

### Community 34 - "Stick-to-Bottom Hook"
Cohesion: 0.67
Nodes (1): useStickToBottom()

### Community 35 - "Top Nav"
Cohesion: 0.67
Nodes (1): isActive()

### Community 36 - "Card Component"
Cohesion: 0.67
Nodes (1): Card()

### Community 37 - "classNames Utility"
Cohesion: 0.67
Nodes (1): cn()

### Community 38 - "Field Component"
Cohesion: 0.67
Nodes (1): Field()

### Community 39 - "Icon Button"
Cohesion: 0.67
Nodes (1): cn()

### Community 40 - "Skeleton Loader"
Cohesion: 0.67
Nodes (1): cn()

## Knowledge Gaps
- **3 isolated node(s):** `Jupietre Favicon / App Icon Asset`, `Color Palette: Near-Black #0a0a0a + Blue #3b82f6`, `Next.js app/icon.svg Convention`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Session Forking`** (5 nodes): `fork.ts`, `ForkError`, `.constructor()`, `forkSession()`, `fork.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Agent Form Component`** (4 nodes): `AgentForm()`, `cn()`, `agent-form.tsx`, `agent-form.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `New Session Form`** (4 nodes): `new-session-form.tsx`, `new-session-form.tsx`, `handleRepoChange()`, `handleSubmit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Diff Panel Component`** (4 nodes): `diff-panel.tsx`, `diff-panel.tsx`, `cn()`, `refresh()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Env Loader`** (4 nodes): `env.ts`, `getEnv()`, `loadEnv()`, `env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Git Repo Diff`** (4 nodes): `diff.ts`, `getRepoDiff()`, `git()`, `diff.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Relative Time Hook`** (4 nodes): `useRelativeTime.ts`, `useRelativeTime.ts`, `format()`, `useRelativeTime()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `App Manifest`** (3 nodes): `manifest.ts`, `manifest.ts`, `manifest()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `New Agent Page`** (3 nodes): `page.tsx`, `page.tsx`, `NewAgentPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Login Page`** (3 nodes): `page.tsx`, `page.tsx`, `LoginPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `New Repo Page`** (3 nodes): `page.tsx`, `page.tsx`, `NewRepoPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Delete Session Button`** (3 nodes): `delete-button.tsx`, `delete-button.tsx`, `DeleteSessionButton()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Sparkline Chart`** (3 nodes): `sparkline.tsx`, `sparkline.tsx`, `Sparkline()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Agent Config Loader`** (3 nodes): `load-agent-config.ts`, `load-agent-config.ts`, `buildSdkOptionsFromConfig()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `DB Migrations`** (3 nodes): `migrate.ts`, `migrate.ts`, `runMigrations()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Auto-Grow Textarea Hook`** (3 nodes): `useAutoGrow.ts`, `useAutoGrow.ts`, `useAutoGrow()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `UI Density Hook`** (3 nodes): `useDensity.ts`, `useDensity.ts`, `useDensity()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Stick-to-Bottom Hook`** (3 nodes): `useStickToBottom.ts`, `useStickToBottom.ts`, `useStickToBottom()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Top Nav`** (3 nodes): `TopNav.tsx`, `TopNav.tsx`, `isActive()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Card Component`** (3 nodes): `Card.tsx`, `Card()`, `Card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `classNames Utility`** (3 nodes): `cn.ts`, `cn()`, `cn.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Field Component`** (3 nodes): `Field.tsx`, `Field.tsx`, `Field()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Button`** (3 nodes): `IconButton.tsx`, `IconButton.tsx`, `cn()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Skeleton Loader`** (3 nodes): `Skeleton.tsx`, `Skeleton.tsx`, `cn()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GET()` connect `API Route Handlers` to `Usage & Budget Tracking`, `Agent Runner & Artifacts`, `Agent Config CRUD`, `MCP Tools (GitHub, Linear)`, `Invite Flow`, `Tool Approval Flow`, `Team Settings & Membership`, `Linear Issue Poller`, `Git File Diff`, `Syntax Highlighter`, `Git Repo Diff`?**
  _High betweenness centrality (0.210) - this node is a cross-community bridge._
- **Why does `POST()` connect `API Route Handlers` to `Repo & Worktree Management`, `Agent Runner & Artifacts`, `Agent Config CRUD`, `Invite Flow`, `Tool Approval Flow`, `Team Settings & Membership`, `Session Auth (Sign/Verify)`, `Session Forking`?**
  _High betweenness centrality (0.144) - this node is a cross-community bridge._
- **Why does `refreshGraph()` connect `MCP Tools (GitHub, Linear)` to `API Route Handlers`, `Repo & Worktree Management`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `POST()` (e.g. with `createAgentConfig()` and `getApprovalRequest()`) actually correct?**
  _`POST()` has 22 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `GET()` (e.g. with `listAgentConfigs()` and `getAgentConfigById()`) actually correct?**
  _`GET()` has 20 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `DELETE()` (e.g. with `getAgentConfigById()` and `canEditAgent()`) actually correct?**
  _`DELETE()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `refresh()` (e.g. with `handleDelete()` and `handleSubmit()`) actually correct?**
  _`refresh()` has 9 INFERRED edges - model-reasoned connections that need verification._