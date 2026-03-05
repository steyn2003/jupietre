# Multi-Agent System Design

## Overview

3 autonomous agents running in Docker containers, coordinating through Linear ticket states. Single TypeScript codebase using the Claude Agent SDK, one Docker image, role selected via `AGENT_ROLE` env var.

## Agents

| Agent | Name | Model | Dev-Agent Model | Role |
|-------|------|-------|-----------------|------|
| PM | Juno | Opus 4.6 | — | Prep tickets, research, route to engineer |
| Engineer | Titus | Sonnet 4.6 | Opus 4.6 | Implement features, create PRs |
| Tester | Scout | Opus 4.6 | Opus 4.6 | Review PRs, run tests, approve or reject |

## Ticket Lifecycle

All tickets require the `agent` label to be picked up.

```
Backlog → Juno preps → In Development → Titus implements → In Review → Scout verifies → Done
                                                                         ↓
                                                              Back to In Development
                                                              (with feedback comment)
```

### Poller Filters

| Agent | Polls for state | Label | Moves to (start) | Moves to (done) |
|-------|----------------|-------|-------------------|-----------------|
| Juno (PM) | Backlog | agent | In Progress | In Development |
| Titus (Eng) | In Development | agent | In Development | In Review |
| Scout (QA) | In Review | agent | In Review | Done |

## Tools per Agent

### Juno (PM)
- `linear_get_issue` — read ticket details
- `linear_update_issue_state` — move tickets between states
- `linear_add_comment` — post updates on tickets
- `linear_create_issue` — create sub-tickets when splitting (NEW)

### Titus (Engineer)
- `linear_get_issue` — read ticket details
- `linear_update_issue_state` — move tickets
- `linear_add_comment` — post PR links, status updates
- `git_create_worktree` — isolate work on branches
- `git_push_branch` — push code
- `gh_create_pr` — create pull requests
- `git_cleanup_worktree` — clean up after work
- Dev-agent subagent (Opus 4.6) — delegated coding with full filesystem/shell

### Scout (Tester)
- `linear_get_issue` — read ticket + acceptance criteria
- `linear_update_issue_state` — move tickets
- `linear_add_comment` — post review results
- `git_create_worktree` — check out PR branches
- `git_cleanup_worktree` — clean up
- `gh_pr_review` — approve or request changes on GitHub PRs (NEW)
- Dev-agent subagent (Opus 4.6) — for minimal test fixes

## System Prompts

Each role gets a rich system prompt with identity/soul from the multi-agent-example patterns, plus structured skill workflows. No memory/heartbeat/bootstrap — agents are stateless containers.

### Juno (PM)
- Identity: organized, proactive, calm under pressure
- Workflow: size check → research → context enrichment → coding prompt → assign to Titus
- Routing: labels (Bug, Research Needed, Plan) determine workflow depth

### Titus (Engineer)
- Identity: competent, direct, low-ego, ships code
- Workflow: read issue → create worktree → delegate to dev-agent → push → PR → comment PR link → clean up
- Retry once on failure, comment on ticket if stuck

### Scout (Tester)
- Identity: thorough, skeptical, detail-oriented
- Workflow: read ticket + acceptance criteria → checkout PR → review diff → run build/tests → approve or request changes
- Minimal fix via dev-agent on test failures, one retry, then send back

## Communication

All agent communication happens via Linear comments on tickets. No Slack integration.

## Docker Setup

3 containers from 1 image, shared `/data` volume:

```yaml
services:
  pm:        # AGENT_ROLE=pm, Juno, Opus 4.6
  engineer:  # AGENT_ROLE=engineer, Titus, Sonnet 4.6
  tester:    # AGENT_ROLE=tester, Scout, Opus 4.6
```

Env vars: `ANTHROPIC_API_KEY`, `LINEAR_API_KEY`, `GITHUB_TOKEN`, optional Langfuse tracing.

## New Code to Build

- `src/roles/pm.ts` — Juno role config with system prompt and tools
- `src/tools/linear.ts` — add `linear_create_issue` tool
- `src/tools/github.ts` — add `gh_pr_review` tool
- `src/roles/engineer.ts` — enrich system prompt with soul/identity/workflow
- `src/roles/qa.ts` — rename to tester, enrich system prompt, add `gh_pr_review`
- `docker-compose.yml` — add `pm` service
- `.env.example` — remove Slack vars
