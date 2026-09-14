# WP14 — Input sequencing

**Not channels work.** Owned by whoever owns the runner. Listed here — as
`plan.md` puts it for WP0 and repeats for this package — "for the same reason
WP0 is: channels depends on it, and leaving it off the graph is how a
dependency becomes a surprise." This spec exists so the runner owner has a
self-contained brief; it does not design the runner's solution, because which
of the two shapes below the runner takes is explicitly the runner's call.

Today a session **refuses** an overlapping turn: a submission arriving while a
turn is already running for that session is rejected rather than accepted, which
forces every caller to invent its own backpressure (retry, queue, drop). The
runner should instead accept the submission and **sequence** it — either queue
it behind the running turn, or fold it into that turn. **Which of the two is the
runner's decision**, and is exactly why this package specifies the problem and
the constraints, not the mechanism.

## Files

Owned by WP14, not channels (`workstreams/README.md`):
- runner + `core/sessions/` — the actual fix, wherever the runner owner judges
  it belongs. The known current refusal site is:
  - `api/oss/src/core/sessions/streams/service.py` — `SessionTurnInUse` is
    raised twice: the optimistic fast-path check in `command()` (around line
    103-108, when `liveness["alive"]` is true and the call is not a `force`
    steer) and the race-safe recheck inside `_start_turn()` (around line
    541-552, after a failed `acquire_alive` lock acquisition against the
    Redis-backed `LockEngine`).
  - `api/oss/src/core/sessions/streams/types.py` — `SessionTurnInUse` exception
    definition (around line 29-36): *"Raised when a session is already alive
    and force=False (a turn is in use)."*
  - `api/oss/src/apis/fastapi/sessions/router.py` — translates `SessionTurnInUse`
    to HTTP 409 (around line 180-187).

Not owned by WP14 and not touched by it:
- Anything under `core/channels/` or `tasks/asyncio/channels/` — WP4 (inbox
  worker) is the caller that currently retries on this refusal, and WP4's code
  does not change when this lands (see Contracts, below).

## Interfaces

Not applicable in the WP8 sense — this package changes runner/session behaviour,
not a router surface. The observable contract change, from the caller's side:

- **Before:** a submission during a running turn gets `SessionTurnInUse` /
  HTTP 409, and the caller must retry.
- **After:** the same submission is accepted (200/202-equivalent) and the
  runner sequences it — queued behind the running turn, or folded into it. The
  caller no longer has to retry to get it accepted (`plan.md`'s WP14 "Done
  when").

## Contracts this package must honour

- **This is not channels work, and building the decision here would be a
  mistake channels deliberately avoids.** WP4 (inbox worker) handles today's
  refusal by **retrying, and nothing else — no coalescing, no steer-or-queue**
  (`plan.md`, WP4 section; `architecture.md` §7). That restraint is
  deliberate: building queue-or-fold logic inside the channels inbox worker is
  "what would stop that work from happening" — i.e. it would preempt WP14's own
  design space by baking one answer into a caller before the runner owner has
  chosen.
- **Channels ships without this.** WP4 retries on refusal, and the retry is
  judged **adequate**, not merely tolerable, because only triggers contend for
  a turn (D9 — fill never starts a turn, only an explicit addressing does) and
  triggers are far rarer than messages. The concurrency surface this package
  addresses is therefore already small in channels' own numbers before WP14
  exists.
- **What the retry costs is latency under a burst of mentions, not
  correctness.** A burst of mentions during one running turn makes the
  *next* mention wait through however many retry cycles WP4 uses; it never
  drops a mention and never double-invokes one (`plan.md`, WP4 "Done when":
  "a mention arriving during that agent's own running turn is retried until
  accepted, never dropped and never duplicated"). WP14 improves the latency
  number. It does not fix a correctness bug, because there isn't one to fix.
- **Unlike WP0, nothing is deleted when this lands.** WP5's polling fallback is
  explicitly deleted once WP0's session events ship (`plan.md` C4 exit
  condition: "WP5's polling is deleted, not disabled"). WP14 has no equivalent
  deletion: "the retry stops firing on its own once refusals stop happening, so
  WP4 needs no revisit" (`plan.md`, WP14 section). WP14 landing is a pure
  latency improvement absorbed silently by existing retry code, not a trigger
  for a follow-up channels PR.
- **The choice between queue and fold is out of scope for this spec by
  design.** `plan.md`: "Which of the two is the runner's call, and it is the
  reason this is not specified here." Any implementation may pick either, or
  offer both under a runner-level policy — channels has no opinion and no
  dependency on which one is chosen, because WP4's retry-based caller works
  unmodified either way.
- **The web app hits the same wall independently** (`architecture.md` §7,
  `specs-wp13.md`). This package's justification does not depend on channels
  existing at all; channels merely being blocked on it is what earns it a slot
  on this graph.

## Tests

Owned by the runner team, not specified here beyond the observable contract:

- A submission arriving during a running turn on the same session is accepted
  rather than refused, and no caller has to retry to get it accepted.
- Whichever mechanism is chosen (queue or fold), a session under a burst of
  submissions processes all of them exactly once — no submission is dropped,
  none is duplicated.
- WP4's existing retry-on-refusal code path is exercised zero times against a
  runner that has this fix, without any change to WP4's code — this is the
  regression test that proves "WP4 needs no revisit."

## Out of scope

- WP4 — the inbox worker's retry behaviour, unchanged by this package landing.
- WP9 — `!new` mid-turn benefits from this landing (per `plan.md`: "It improves
  WP4 and WP9") but WP9's own behaviour (let the running turn finish, D24) is
  not altered structurally — a queued or folded `!new` still does not interrupt
  the turn in flight; it changes only how the *next* submission after refusal
  used to have to be retried.
- The choice of queue vs. fold mechanism, and any UI or API surface for
  observing queue depth — neither is specified here.

## Checkpoint

**WP14 is explicitly not a checkpoint gate.** From `plan.md`'s "What is not a
checkpoint" section:

> **WP14** (input sequencing) and **WP0** (session events) are not our code and
> gate nothing structurally. WP0 is needed *inside* C4 to delete WP5's polling.
> WP14 improves C2's behaviour whenever it lands and requires no revisit of
> anything.

There is no exit condition to quote for WP14 itself, by the same section's
logic — it "gates nothing structurally." The nearest thing to a completion
signal is `plan.md`'s package-level "Done when": *"a submission arriving during
a running turn is sequenced rather than refused, and the caller does not have
to retry to get it accepted."* That is a done condition for WP14 as a standalone
piece of runner work, not a channels checkpoint exit condition — it can land
before, during or after any channels checkpoint with no coordination required
beyond WP4's contract (retry-until-accepted) continuing to hold.
