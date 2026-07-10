# Warm and resumable Daytona sessions (F-020)

Design workspace for making follow-up turns on a Daytona agent skip full sandbox creation.
Every Daytona turn today pays about 20 seconds of cold provision plus mount plus harness
startup. This workspace plans two tiers that reuse a session's sandbox between turns, with
honest cost trade-offs and a recommendation.

This is a takeover of work that builds on PR #5197 (durable session continuity). A follow-up
commit at HEAD (`60990d396e`, untested) already prototypes most of Tier 1. Read `context.md`
first; the "what changed under our feet" section is load-bearing.

## Files

- `context.md` — why this exists, the symptom, why it happens, the untested lifecycle commit,
  goals and non-goals.
- `research.md` — the actual current code at HEAD (teardown, reconnect, provider flags, the
  sandbox-agent patch), how the local keep-alive pool works, the three-tier fallback model, and
  Daytona lifecycle and billing semantics.
- `plan.md` — the two tiers, phased, with the recommendation. Tier 1 (cheap resume, park to
  stopped) ships first behind a default-off flag. Tier 2 (true warm pool, park to running) is
  an opt-in follow-up.
- `open-questions.md` — the decisions a reviewer and a billing owner still have to make.
- `status.md` — current state, decisions, the design-review round, blockers.

## Recommendation in one line

Land Tier 1 (mostly prototyped, storage-only parked cost) behind a default-off flag, close the
P0 lifecycle gaps the review round found, enable it after one credit-controlled live test, keep
durable continuity as the floor, and defer Tier 2 (running compute; TTL and a running cap are
the billing knobs) until F-018 lands and a billing owner sets those knobs.

## Related workspaces

- `docs/design/agent-workflows/projects/session-keepalive/` — the local in-memory keep-alive
  pool. Its deferred "slice 3 (Daytona)" is this project's Tier 2.
- `docs/design/agent-workflows/projects/harness-session-resume/` — durable continuity via ACP
  `session/load`. The fallback rung under both tiers.
- `docs/design/agent-workflows/projects/qa/findings.md` — F-020 (this problem), F-018 (the
  Daytona tool-call hang that gates the benefit), F-017 (the mount fix PR #5197 shipped).
