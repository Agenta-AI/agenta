# Open design questions

> **AGENT-GENERATED, low weight.**

Only these seven choices remain for Mahmoud. Each answer moves to `decisions.md` when settled.

## O1. Sequence home

Session records live on the analytics engine, while `session_streams` lives on the core engine.
The current cross-engine shape cannot allocate a sequence and insert its record in one transaction.

**Option 1: Add a records-domain cursor on the analytics engine.** A small per-session row stores
`latest_sequence`, and the records data access object locks it in the record transaction. This is
additive, avoids a data move, and keeps ordering with the rows it protects, but it leaves session
state on two engines.

**Option 2: Move session records to the core engine.** Records and core session state can then share
one engine and transaction. This simplifies ownership boundaries later, but it requires a tenant
data migration and changes retention and analytics integrations.

**Recommendation:** Choose Option 1 because it fixes atomic allocation with one additive table and
no record move.

**Reviewer holding the other view:** No reviewer recommends Option 2. Fable and Opus explicitly
recommend the records-domain cursor, while Codex requires an atomic record-side authority.

## O2. Late output

The current code quarantines records that arrive after watchdog settlement and hides them from
normal reads. The final guard will consult the execution row for every terminal cause, but storage
action remains undecided.

**Option 1: Quarantine late output.** Keep the existing nullable quarantine marker and filter one
predicate on canonical reads. This preserves late usage and tool results for accounting and support,
but it creates a second class of rows that every reader must exclude.

**Option 2: Reject late output.** Return non-retryable `execution_terminal` and retain only bounded
diagnostic metadata outside canonical records. This fails closed and simplifies the canonical
table, but it loses raw late usage and tool results.

**Recommendation:** Choose Option 1 because it is built, retains useful evidence, and gives users
the same canonical history. Keep it behind `AGENTA_SESSIONS_HISTORY_WRITES` until decided.

**Reviewer holding the other view:** Codex recommends Option 2. Fable and Opus recommend Option 1.

## O3. Codex child cleanup

PR #6496 includes runner-side child reaping that passed on the local provider but has not passed on
Daytona. The Codex ACP pin can move from 1.1.7 to 1.8.0, but that change affects every Codex turn.

**Option 1: Ship the reap now and test the pin bump separately.** This keeps the proven Stop fix
narrow and lets a separate pull request run the full Codex matrix. It carries runner cleanup code
until the newer adapter proves it can replace that code.

**Option 2: Bump the pin before shipping the reap.** This may remove custom cleanup and use upstream
behavior. It expands the Stop release surface and blocks it on cancellation, approval, tool, warm
continuation, and Daytona testing.

**Recommendation:** Choose Option 1 because the reap is the smaller release dependency and the pin
bump deserves an independent regression matrix.

**Reviewer holding the other view:** No reviewer recommends bump-first. The earlier draft preferred
the bump only if the full matrix passed; Fable explicitly recommends Option 1.

## O4. Rollout granularity

The plan defines one env-backed server switch for each of the Stop, history, and shared-reader
increments. A global switch is simple, while project targeting and advertised capabilities can
contain a client or contract mismatch.

**Option 1: Use one global env switch per increment.** Operators get one activation and rollback
point, and clients need no capability negotiation. A defect affects every enabled project at once,
and desktop and mobile cannot move independently.

**Option 2: Add a kill switch, project allowlist, and capability advertisement.** Operators can
stage projects and clients, and snapshots tell clients which contract is active. This adds config,
response fields, test combinations, and more rollback states.

**Recommendation:** Choose Option 1 for version one because it matches the three incremental flags
and keeps rollback easy to understand.

**Reviewer holding the other view:** Codex recommends Option 2. Fable recommends Option 1.

## O5. Stop verb

The shipped public route is `POST /sessions/{session_id}/cancel`, and clients already call it.
The product label is Stop, but a second route would add a migration without changing behavior.

**Option 1: Keep `/cancel` in version one.** This preserves compatibility and avoids a duplicate
route. The API name remains less aligned with the product label.

**Option 2: Add `/stop`.** This gives the public action the product name and can retain `/cancel`
during deprecation. It creates two spellings, client migration work, and another compatibility
period.

**Recommendation:** Choose Option 1 because it changes no contract and keeps version one smaller.

**Reviewer holding the other view:** Codex recommends Option 2. Fable and Opus recommend Option 1.

## O6. Runner shutdown grace period

The shared compose file does not set a shutdown grace period above the runner's bounded cleanup.
Current cleanup can consume three five-second budgets, so any safe value must exceed 15 seconds.

**Option 1: Set 30 seconds.** This doubles the known upper bound and keeps deploy shutdowns short.
It leaves less margin if provider or filesystem cleanup approaches its timeout.

**Option 2: Set 60 seconds.** This provides more margin for slow cleanup and evidence capture. It
can delay forced replacement of a stuck container by another 30 seconds.

**Recommendation:** Choose Option 1, then measure shutdown and raise it only if the bounded path
uses more than half the window.

**Reviewer holding the other view:** No reviewer chose 60 seconds. The QA audit requires a value
above 15 seconds and leaves the exact number to Mahmoud.

## O7. `not_running` or `lost` after teardown

After teardown, the Redis `running` key no longer identifies an active execution or owner. Version
one has one runner, so the distinction matters only when multi-runner routing arrives.

**Option 1: Return `not_running`.** The result describes current session state and stays compatible
with an already-ended execution. It does not tell a future multi-runner caller whether ownership
disappeared before delivery.

**Option 2: Return `lost`.** The result records that the targeted owner or runner vanished before
the command settled. It adds a stronger failure meaning that version one cannot always prove from
the missing Redis key alone.

**Recommendation:** Choose Option 1 for version one because it states only what the current system
can prove. Revisit `lost` with ownership generations and multi-runner guarantees.

**Reviewer holding the other view:** No reviewer recommends Option 2 for version one. The decision
list records this as a multi-runner-only distinction.
