# Context

## What a user sees today

An Agenta user building an agent picks a harness. Today the working choices are Pi and
Claude Code. Codex appears in one place only: a user with a ChatGPT subscription can run
Codex models through the Pi harness (Pi's `openai-codex` provider, authenticated by the
subscription sidecar). There is no way to run the actual Codex CLI as the agent, so none
of Codex's own behavior (its tool use, its sandboxing, its planning style) is available.

## Why add a Codex harness

The platform's promise is that a user brings the coding agent they trust. Claude Code
and Codex are the two agents with the largest user bases. Running the real Codex CLI as
a harness gives Codex users the same first-class treatment Claude users have: their
agent, their subscription or key, inside Agenta's sandboxes, with Agenta's tools,
approvals, and tracing attached.

## What exists already

- A draft PR stack from July 2 (#5042, #5043, #5049, #5050) added a Codex harness
  against a code base that has since been restructured. Its analysis (see
  `research.md`) concluded: the SDK adapter skeleton and the auth-file knowledge are
  reusable; the runner wiring, wire contract, fixtures, and Daytona/E2B parts are
  obsolete or policy-dead. We re-implement on main and salvage, not rebase.
- The sandbox-agent daemon the runner already ships can spawn Codex behind the
  `codex-acp` bridge. The heavy machinery (process management, ACP, event streaming,
  tracing) is therefore already in place and shared with Claude.

## Goals

1. Codex as a selectable harness on the local sandbox, at feature parity with Claude
   where Codex can express the feature: managed-key auth, subscription auth via the
   sidecar, Agenta tools over the loopback MCP server, permissions, human-in-the-loop
   approvals with park and resume, tracing.
2. Daytona support with managed keys only (subscription state never leaves the runner
   host, same policy as Claude).
3. Code quality at or above the surrounding code. Every milestone ends with a review
   pass and a cleanup pass; the adapter must read like the Claude adapter it sits next
   to.

## Non-goals

- E2B support (no E2B sandbox exists on main).
- Rebasing the old PR stack.
- Any change to how Pi's Codex-models-via-subscription path works today.
- Inventing an Agenta-abstract permission vocabulary. The established pattern stays:
  authors write harness-native permission options; the platform derives reinforcement
  rules from its own layers.

## Working arrangements for this project

Approved by Mahmoud on 2026-07-24:

- All work happens in this worktree with its own local deployment (Traefik port 8180,
  Postgres 5433, compose project `agenta-ee-dev-codex-harness`).
- Implementation is driven through Codex (gpt5.6-sol); Opus reviews; after each
  milestone the desloppify skills and `/simplify` run before the milestone report.
- Each milestone starts with the plan-feature structure (this workspace) and follows
  implement-feature patterns: implement, test, live QA in the worktree deployment.
- Every milestone produces a written report in `reports/` for Mahmoud's review.
- No implicit decisions: anything not an obvious copy of the existing Claude pattern
  goes to `decisions.md` and waits for approval at the next checkpoint.
