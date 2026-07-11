# Context: forking sandbox-agent

## Why this work exists

The runner depends on the `sandbox-agent` npm package (JS SDK + platform CLI binaries) to
spawn and drive coding-harness sessions. We hit a second production-grade incident caused
by its process lifecycle, and we cannot fix it from our side of the API:

- **2026-07-06 dev-box incident:** orphaned `claude-agent-acp` processes accumulated until
  the runner container OOMed. Fixed in #5102 by sending a graceful `destroySession` before
  `destroySandbox` at teardown.
- **2026-07-09 recurrence:** `agenta-oss-team-runner-1` at 49.7 GiB / 7029 PIDs within 24h
  of a restart. Diagnosis (this session): ~300 orphaned `claude` + `claude-agent-acp`
  pairs, one per run — a 100% per-run leak rate.

Root cause of the recurrence: the #5102 fix calls `SandboxAgent.destroySession()`, but in
sandbox-agent 0.4.2 that method is a *logical* destroy only — it cancels pending
permissions, sends ACP `session/cancel`, and stamps `destroyedAt` on the session record
(`dist/chunk-TVCDKGSM.js:1366`). It never terminates the ACP adapter subprocess or the
harness CLI it wraps. `destroySandbox` then kills only the sandbox-agent server pid, not
its process tree, so the adapter and harness reparent to PID 1 and live forever. Every
run leaks one pair (~80–160 MB each).

The fix belongs inside sandbox-agent (the server spawns the adapter; only it can reliably
kill the child process tree). Upstream is `rivet-dev/sandbox-agent`, Apache-2.0, with a
single maintainer. We cannot block runner reliability on upstream review latency.

## Decision (Mahmoud, 2026-07-09)

Maintain a fork hosted in the agenta-ai GitHub org:

- We land runner-critical fixes on the fork immediately and consume the fork in our npm
  installs.
- Every fix is also opened as a PR upstream (`rivet-dev/sandbox-agent`).
- We keep the fork synced with upstream releases.
- The fork is **temporary but real**: it retires when the issues are fixed upstream and we
  trust the upstream project more. Mahmoud has already reached out to the founder
  (Nathan Flurry).

## Goals

1. Unblock runner-critical fixes: hours, not upstream-review-latency.
2. First fix shipped through the fork: `destroySession` / `destroySandbox` (or server
   shutdown) must kill the ACP adapter + harness child process tree, so the orphan leak
   stops at the source.
3. Low-friction consumption: `services/runner` installs the fork like any npm dep, in dev,
   Docker images, and (if applicable) Daytona sandboxes.
4. Cheap upstream sync: pulling a new upstream release into the fork is a routine,
   documented operation, not surgery.
5. Clean exit: switching back to upstream is a version bump, not a migration.

## Non-goals

- Diverging the fork's API from upstream. The fork carries fixes we intend to upstream,
  nothing Agenta-specific.
- Rewriting or vendoring sandbox-agent into the monorepo.
- Fixing the leak runner-side only (process-group kill in the runner is a possible
  *backstop*, but the decided path is fixing it in sandbox-agent via the fork).

## Related

- Leak diagnosis and keep-alive interplay: see `research.md` (this workspace).
- Session keep-alive pool: #5156 / #5158 (orthogonal — the pool never engages on the
  affected box because mount signing 503s and every run degrades to cold).
- #5102: the prior partial fix (graceful destroySession at teardown).
