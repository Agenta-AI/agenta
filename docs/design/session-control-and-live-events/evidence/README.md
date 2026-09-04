# Evidence index

> **AGENT-GENERATED, low weight.**

This index connects design claims to code traces and live runs. Raw logs remain with their evidence
pull requests or test environment.

## Design and code traces

| Source | Evidence |
|---|---|
| PR #6497 | Durable command and replaceable delivery design |
| PR #6498 | Current browser, API, Redis, heartbeat, and runner Stop path |
| PR #6499 | Stable record IDs and progressive update cases |
| `research.md` | Current repository architecture and competitor API research |
| `records-invariants.md` | Required record properties and current violations |

## Live implementation evidence

| Source | Evidence |
|---|---|
| PR #6496 | Warm cancellation, native continuation, restart continuity, and Codex child cleanup |
| PR #6500 | Concurrent-send admission before sandbox mutation |
| PR #6501 | Dead runner, dead sandbox, and stale runner tail |
| PR #6502 | Postgres outage during record ingestion |
| PR #6503 | Durable Stop with direct delivery and measured timing |
| PR #6504 | Execution guard, approval cancellation, and client errors |
| PR #6505 | Full overnight reports and 2026-09-03 evidence timeline |
| PR #6506 | Combined integration run and thirteen passing implemented scenarios |

## Evidence limits

- The integrated stale-tail test used quarantine. The selected version-one contract requires
  rejection, so that row must run again after the implementation changes.
- Codex child cleanup passed locally but still needs Daytona verification.
- The current Codex ACP pin has not yet been compared with a current version.
- The final combined release commit has not run `qa.md`.
