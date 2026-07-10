# Status

Source of truth for this workspace's progress. Keep it current.

## State: design draft, review round done, awaiting human review

Design only. No code changed. No live Daytona sandbox was run (credits).

## What this workspace concluded

- F-020's observed behavior still holds at HEAD, for a deeper reason than F-020 stated. The
  runner-side warm plumbing exists (keepWarm park, stored-id reconnect, native `session/load`,
  `ephemeral: false` plus idle timers), but the vendored Daytona provider (`sandbox-agent@0.4.2`)
  has no `pause` and no `reconnect`. So `pauseSandbox()` falls back to delete, reconnect cannot
  revive a stopped instance, and every turn still recreates. This is the load-bearing finding.
- The core fix is two provider hooks the runner already calls (the Daytona SDK exposes
  `sandbox.stop()` / `sandbox.start()` / `state`), plus two failure-cleanup seam fixes in the
  vendored lifecycle, a compatibility fingerprint, and fenced pointer writes (P0 list in
  `plan.md`).
- Two tiers, honest trade-offs, one recommendation. Tier 1 (park to stopped, storage-only
  parked cost) lands behind a default-off flag and is enabled after one credit-controlled live
  test. Tier 2 (park to running, compute cost, TTL and running cap are the knobs) is opt-in and
  deferred. Durable replay stays the floor.

## Decisions

- Tier 1 behind a default-off rollout flag first, not default-on; enable after the Phase 3 live
  lifecycle test. Changed from "default" by the review round.
- Hooks in a runner-side provider wrapper; the two failure-cleanup seam fixes in the existing
  `sandbox-agent@0.4.2` dist patch (they live inside the vendored `SandboxAgent`).
- Tier 2 uses a separate Daytona-scoped pool instance with awaited evict-to-stop; never
  reinterpret the local `poolMax`. Env names are Daytona-scoped
  (`AGENTA_RUNNER_DAYTONA_SESSION_*`), and the cap is `MAX_RUNNING`, not a "spend cap".
- Teardown carries a reason: kill/failed/aborted delete; clean resumable turns stop; SIGTERM
  deletes in-flight and stops idle.

## Design-review round

Ran the `ask-codex` skill (xhigh, gpt-5.6) on `plan.md`, `research.md`, and `context.md` as an
adversarial design review; Codex verified claims against the runner source, the vendored dist,
and the Daytona SDK. Verdict: two-tier split sound, "Tier 1 default-on" not sound yet. Its P0
findings are folded into `plan.md`: the broken failed-pause delete fallback (the vendored
`finally` clears the provider handle), the double-sandbox leak when reconnect fails after
`start()`, unfenced last-writer-wins `writeSandboxId` races, no compatibility check on reuse
(stale secrets or network policy), mount hygiene on reattach, teardown-by-reason, the
`orphan_sweep.py` scope correction (DB-only, never touches Daytona), Daytona's
external-interaction-only inactivity clock, the unmeasured latency claim (now a Phase 3
measurement), and Daytona-scoped Tier 2 config naming with a separate pool instance. Two of its
factual corrections were re-verified in-repo before folding: compose does forward the
`DAYTONA_AUTO*` timers (PR #5197's risk note is stale), and archived sandboxes resume via plain
`start()`.

## Open questions

See `open-questions.md`. The three that gate shipping: the orphan compute budget and autoStop
value (billing owner), the pointer-fencing design (reviewer), and the Tier 2 TTL and running
cap (billing owner).

## Blockers

- F-018 (Daytona tool-call hang) gates validation and benefit on tool-using turns. Chat can be
  verified first.
- Live E3 verification (Phase 3) needs Daytona credits; deferred out of this design pass.

## Provenance

- Project: warm-daytona-sessions. Built on PR #5197 (`feat/sessions-continuity`, open, base
  `big-agents`) and commit `60990d396e` ("Resolve hot/warm/cold/dead/new lifecycle (untested)").
- Authoritative source: F-020 in `docs/design/agent-workflows/projects/qa/findings.md`.
- Sibling workspaces: `session-keepalive/` (Tier 2 is its deferred slice 3),
  `harness-session-resume/` (durable continuity fallback).
