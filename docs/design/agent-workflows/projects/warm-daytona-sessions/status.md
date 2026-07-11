# Status

The source of truth for this workspace's progress. Keep it current.

## State: design revised after measurement, direction, and a second review round; awaiting human review

Design only. No production code changed. One credit-controlled lifecycle measurement was run
directly against the Daytona API on 2026-07-11 (two sandboxes, both deleted; zero sandboxes in
the organization before and after). Its numbers are in research.md and reshaped the plan.

## What this workspace concluded

- F-020's slow-turn behavior still holds at HEAD, for a deeper reason than F-020 gave. The
  runner-side warm plumbing exists (park at turn end, reconnect by stored id, native session
  reload, `ephemeral: false` with idle timers), but the vendored Daytona provider
  (`sandbox-agent@0.4.2`) has no pause and no reconnect. So `pauseSandbox()` falls back to delete,
  reconnect cannot revive a stopped instance, and every turn still rebuilds.
- The measurements added the second key finding: the sandbox is not the slow-turn problem. Cold
  create to usable is 1.2 to 1.7 seconds, start from stopped is 0.7 to 0.8 seconds. Almost all of
  the measured ~15-second turn is our per-turn pipeline (~12.3 s; stage split in research.md,
  dominated by a redundant Pi install and the harness spawn). Archive is a dead state for us:
  restore (33 to 66 seconds) is slower than a fresh create, and the disk it frees costs under a
  tenth of a cent per hour.
- The core correctness fix is unchanged: the two provider functions the runner already calls,
  plus two teardown cleanup fixes in the vendored code, a compatibility check before reuse, and a
  guard on the pointer writes (the must-fix list in `plan.md`).

## Decisions

- **Park-to-running is in the main line, not deferred** (Mahmoud, 2026-07-11). The plan is one
  progressive sequence of slices ending with park-to-running. Rationale: the measurement shows
  only a running sandbox removes the per-turn pipeline, and the compute cost that justified
  deferral is small and bounded ($0.0028 per parked minute; worst case about $0.67/hour at the
  default cap of 4).
- **Reuse the local keepalive pool logic, refactored provider-aware** (Mahmoud, 2026-07-11).
  Per-provider operator config plus an engine-owned lifecycle adapter; one `SessionPool` instance
  per provider; local semantics preserved. No second pooling mechanism.
- **Billing knobs are configuration with conservative defaults, not deferral reasons**
  (Mahmoud, 2026-07-11). `AGENTA_RUNNER_DAYTONA_SESSION_*`: keepalive off until verification,
  idle window 60 seconds, cap 4.
- **The Daytona running cap is enforced by admission before creation, not by the pool**
  (review round 2, 2026-07-11). Permits are taken before create and before a reconnect's start,
  released only on a confirmed stop or delete; eviction is awaited; Daytona never gets the local
  "run unparked best-effort" behavior.
- **Teardown reasons are typed and travel from the pool into an engine-owned lifecycle function**
  (review round 2). Kill, failed, aborted turns, and mismatches delete; clean resumable turns and
  idle expiries stop; shutdown deletes an in-flight turn and stops an idle one; a failed stop
  escalates to delete; a failed stop plus failed delete keeps the capacity permit consumed until
  reconciliation.
- **The park-to-stopped feature flag lands in Slice 1, not Slice 2** (review round 2). The run
  paths already request `keepWarm`, so a real `pause` without the flag would activate parking
  immediately.
- **Archive is configured out of the demotion ladder** (measurement, 2026-07-11). The ladder is
  stop, then delete, with `DAYTONA_AUTOARCHIVE` strictly greater than `DAYTONA_AUTODELETE`
  (equality would race; interval 0 is unusable because `positiveMinutes()` treats it as unset).
- **Stop timer proposed at 15 minutes, not 5** (measurement, 2026-07-11). About 4 cents per crash
  orphan buys never stopping a sandbox under a live silent turn (the run-limits guard alone
  allows 300 seconds). Awaiting confirmation (open-questions.md).
- **Pending approvals follow the `daytona-gate-delivery` (F-018) resume model.** Below
  park-to-running, a pending approval always takes the cold path (teardown, stored decision,
  reissue on the next turn), because a stopped sandbox kills the waiting process. Holding a gate
  open byte-exact requires park-to-running plus that plan's file-transport parked-gate variant;
  parkability is an explicit transport capability check, never inferred from a paused stop
  reason.
- The two provider functions live in a runner-side provider wrapper (with state-inspecting,
  idempotent stop); the two teardown cleanup fixes live in the existing `sandbox-agent@0.4.2`
  package patch (they sit inside the vendored code).

## The measurement (2026-07-11)

Run directly against the Daytona API (SDK 0.187.0, snapshot `agenta-sandbox-pi`, target `eu`),
two repetitions, full numbers and prices in research.md. Headlines: create 1.2 to 1.7 s, stop
about 2 s, start from stopped 0.7 to 0.8 s, archive 50 to 82 s, restore from archive 33 to 66 s.
Prices from Daytona's pricing page: $0.0504/vCPU-hour, $0.0162/GiB-hour RAM, $0.000108/GiB-hour
disk. Our shape (2 vCPU, 4 GiB, 8 GiB disk): running about $0.17/hour, stopped about
$0.0009/hour. Hygiene: sandbox count zero before, zero after; both created sandboxes deleted.

A second measurement the same day filled the gap the first one left: the full turn. Three real E3
chat runs plus micro-measurements inside the runner container produced the stage-by-stage split
now in research.md ("Where the time goes"): ~15-second cold Daytona turn, ~12.3 seconds of it our
pipeline, dominated by a redundant ~5.2-second Pi install (skip already live on the dev sidecar,
E3 smoke down to 12.2 s) and a ~5.15-second harness spawn (of which ~2 seconds are pi-acp version
probes, removal planned in PR #5221). Consequences recorded in plan.md: park-to-stopped saves
about 1 second; park-to-running gets the turn to an estimated 2 to 3 seconds; Slice 5 first adds
the missing duration log lines, then re-measures against this baseline.

## Design-review round 2 (2026-07-11, after the reshape)

A second `ask-codex` review (xhigh reasoning, gpt-5.6) ran on the five-slice design, checking it
against `server.ts`, `session-pool.ts`, `sandbox_agent.ts`, the vendored package, the Daytona SDK,
and the `daytona-gate-delivery` plan. Verdict: the five-slice direction and ordering are right;
request changes on two design properties that were false as drafted. All of its findings were
accepted and folded into `plan.md`:

- The pool cannot enforce the running cap (fresh misses create sandboxes before the pool sees
  them; approval checkout removes entries from the map; LRU eviction is fire-and-forget). Fixed
  with the capacity admission gate in Slice 4.
- One provider-level "eviction disposition" cannot implement the teardown matrix (a mismatch must
  delete while an idle expiry stops). Fixed with typed teardown reasons through an engine-owned
  lifecycle function.
- Slice 1 without a flag would activate parking immediately (`keepWarm` is already requested at
  HEAD). Fixed by moving the flag into Slice 1.
- Operator config and lifecycle mechanisms must not be one "policy" record. Fixed in the refactor
  section.
- The live pool's `configFingerprint()` is not sufficient as the stopped-reconnect compatibility
  fingerprint (it omits resolved operator settings like `DAYTONA_SNAPSHOT`); derive it from the
  resolved create specification. Folded into must-fix item 2.
- Archive-out needs strict inequality, and Daytona's own timer semantics (auto-delete fires from
  continuously stopped, no archive required) get one explicit live check. Folded into item 6.
- Refresh Daytona activity once when entering the live parked state; make stop idempotent by
  state inspection; no recurring heartbeats. Folded into the park-to-running section.
- Do not claim the pipeline split is instrumentally proven, and do not call the one-second
  provider delta an end-to-end ceiling (today's Daytona path re-uploads assets on every start).
  Folded into plan.md, research.md, and the Slice 5 instrumentation list.
- Slice 5 verification split: park-to-stopped graduates independently; park-to-running needs a
  concurrent over-cap test, a TTL stop confirmation, a SIGTERM drain, and a forced stop failure.

Nothing from round 2 was rejected. One of its observations was procedural rather than design: it
noted the PR did not yet contain the reshaped files, which is expected; the reshape sits in the
working tree pending the coordinated commit.

## Design-review round 1 (before the reshape)

The first `ask-codex` review ran on the two-tier draft. Its must-fix findings are folded into
`plan.md` and still stand: the broken failed-pause delete fallback, the double-sandbox reconnect
leak, the unguarded `writeSandboxId` races, the missing compatibility check, mount hygiene on
reattach, teardown by reason, the `orphan_sweep.py` scope correction, Daytona's
external-interaction-only idle clock, and the unmeasured-latency correction (since replaced by
the 2026-07-11 measurement). Its "defer park-to-running" recommendation was superseded on
2026-07-11 by the measurement and Mahmoud's direction; its safety conditions (awaited eviction, a
real running cap, reason-aware teardown) are kept as requirements inside Slice 4 rather than as
reasons to defer.

## Open questions

See `open-questions.md`. Still open: the pointer-write guard mechanism, the shutdown split, and
the capacity-gate saturation behavior (reviewer), plus two proposed defaults to confirm (the
15-minute stop timer, the park-to-running window and cap). The former billing-owner gates are
resolved by the measurement.

## Blockers

- F-018 (the Daytona tool-call hang, in implementation at `daytona-gate-delivery/`) gates
  validation and benefit on tool-using and approval turns. Chat can be verified first.
- Live end-to-end verification (Slice 5) needs Daytona credits; deferred out of this design pass.

## Provenance

- Project: warm-daytona-sessions. Built on PR #5197 (`feat/sessions-continuity`, open, base
  `big-agents`) and commit `60990d396e` ("Resolve hot/warm/cold/dead/new lifecycle (untested)").
- Authoritative source: F-020 in `docs/design/agent-workflows/projects/qa/findings.md`.
- Lifecycle measurement: 2026-07-11, direct Daytona API; numbers transcribed into research.md.
- Sibling workspaces: `session-keepalive/` (the local pool this plan refactors provider-aware),
  `harness-session-resume/` (durable continuity fallback), `daytona-gate-delivery/` (F-018, the
  approval-gate contract this plan follows).
