# sandbox-agent fork — planning workspace

Maintain a temporary fork of `rivet-dev/sandbox-agent` in the agenta-ai org so
runner-critical fixes ship in hours instead of waiting on a dormant upstream. First fix:
the orphaned `claude`/`claude-agent-acp` process leak that OOMs the runner (one leaked
pair per run; 49.7 GiB / 7029 PIDs in 24h on the team dev box, 2026-07-09).

## Files

- [`context.md`](context.md) — the two incidents, the root cause, the fork decision and
  its goals/non-goals.
- [`research.md`](research.md) — leak mechanics with code references (runner + deployed
  SDK + upstream Rust), local consumption map, upstream repo deep-dive, pkg.pr.new
  assessment.
- [`plan.md`](plan.md) — the fix design (process-group kill + SIGTERM handling), fork
  mechanics (branching, fork CI, pkg.pr.new publishing, pnpm overrides), sync/exit
  criteria, milestones M0–M5, leak-detection runbook.
- [`status.md`](status.md) — current progress, open questions, blockers. Source of truth.

## TL;DR of the design

Fork from the `v0.4.2` tag onto an `agenta` branch. Fix in the Rust server: spawn each
ACP adapter in its own process group and kill the group on shutdown; handle SIGTERM like
SIGINT. Validate on the dev box via `SANDBOX_AGENT_BIN` before building any publishing.
Publish linux binaries per-commit via pkg.pr.new (no npm); consume via two
`pnpm.overrides` URLs in `services/runner`. Every fix also goes upstream as a PR
(issue #201 is this exact leak, closed without a fix). The fork retires when upstream
merges, releases, and shows signs of life.
