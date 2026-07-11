# Status

The source of truth for this workspace's progress. Keep it current.

## State: design draft, review round done, awaiting human review

Design only. No code changed. No live Daytona sandbox was run (that would spend credits).

## What this workspace concluded

- F-020's slow-turn behavior still holds at HEAD, for a deeper reason than F-020 gave. The
  runner-side warm plumbing exists (park at turn end, reconnect by stored id, native session
  reload, `ephemeral: false` with idle timers), but the vendored Daytona provider
  (`sandbox-agent@0.4.2`) has no pause and no reconnect. So `pauseSandbox()` falls back to delete,
  reconnect cannot revive a stopped instance, and every turn still rebuilds. This is the key
  finding.
- The core fix is the two provider functions the runner already calls (the Daytona SDK exposes
  `sandbox.stop()`, `sandbox.start()`, and a `state` field), plus two teardown cleanup fixes in the
  vendored code, a compatibility check before reuse, and a guard on the pointer writes (the
  must-fix list in `plan.md`).
- Two levels of reuse, honest trade-offs, one recommendation. Park-to-stopped (stop the sandbox at
  turn end, storage-only parked cost) lands behind a default-off flag and is turned on after one
  credit-controlled live test. Park-to-running (keep the sandbox running, compute cost, with a
  time-to-live and a running cap as the knobs) is opt-in and deferred. Durable reload stays the
  floor.

## Decisions

- Park-to-stopped ships behind a default-off flag first, not default-on; it is turned on after the
  Phase 3 live test. This changed from "on by default" as a result of the review round.
- The two functions live in a runner-side provider wrapper; the two teardown cleanup fixes live in
  the existing `sandbox-agent@0.4.2` package patch (they sit inside the vendored code).
- Park-to-running uses a separate Daytona-scoped pool instance with an awaited evict-to-stop; it
  never reinterprets the local size cap. The env names are Daytona-scoped
  (`AGENTA_RUNNER_DAYTONA_SESSION_*`), and the cap is named `MAX_RUNNING`, not a "spend cap".
- Teardown carries a reason: kill, failed, and aborted turns delete; clean resumable turns stop;
  shutdown deletes an in-flight turn and stops an idle one.

## Design-review round

An `ask-codex` review (xhigh reasoning, gpt-5.6) ran as an adversarial design review on `plan.md`,
`research.md`, and `context.md`. Codex checked the claims against the runner source, the vendored
package, and the Daytona SDK. Verdict: the two-level split is sound, but "park-to-stopped on by
default" was not sound yet. Its must-fix findings are folded into `plan.md`:

- the broken failed-pause delete fallback (the vendored `finally` clears the provider handle),
- the double-sandbox leak when reconnect fails after `start()`,
- the unguarded last-writer-wins `writeSandboxId` races,
- no compatibility check on reuse (stale secrets or a weaker network policy),
- mount hygiene on reattach,
- teardown by reason,
- the `orphan_sweep.py` scope correction (database only, never touches Daytona),
- Daytona's external-interaction-only idle clock,
- the unmeasured latency claim (now a Phase 3 measurement),
- and Daytona-scoped park-to-running config naming with a separate pool instance.

Two of Codex's factual corrections were re-checked in the repo before folding: the compose files do
forward the `DAYTONA_AUTO*` timers (PR #5197's risk note is stale), and archived sandboxes resume
via a plain `start()`.

## Open questions

See `open-questions.md`. The three that gate shipping: the abandonment compute budget and the
stop-timer value (billing owner), the pointer write guard (reviewer), and the park-to-running
time-to-live and running cap (billing owner).

## Blockers

- F-018 (the Daytona tool-call hang) gates validation and benefit on tool-using turns. Chat can be
  verified first.
- Live E3 verification (Phase 3) needs Daytona credits; deferred out of this design pass.

## Provenance

- Project: warm-daytona-sessions. Built on PR #5197 (`feat/sessions-continuity`, open, base
  `big-agents`) and commit `60990d396e` ("Resolve hot/warm/cold/dead/new lifecycle (untested)").
- Authoritative source: F-020 in `docs/design/agent-workflows/projects/qa/findings.md`.
- Sibling workspaces: `session-keepalive/` (park-to-running is its deferred Daytona slice),
  `harness-session-resume/` (durable continuity fallback).
