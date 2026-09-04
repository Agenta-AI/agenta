# Review: repository practices and interface roles

> **AGENT-GENERATED, low weight.** One reviewer, one model, one night. Every conclusion below is
> an agent opinion. Mahmoud decides.

Scope of this review: Mahmoud's point 2 (repository organization practices) and point 3 (the
`design-interfaces` skill), plus sections 7, 10, and 11 of the review standard (boundaries,
security, migration). I did not re-review the concurrency model or the Stop evidence.

## Verdict

The design meets the critical rows of the weighting table, and it meets them with mechanisms this
repository already runs: Postgres for durable facts, Redis for leases and temporary frames, SSE for
fan-out, and one additive nullable migration. It is close to the smallest design that works. It is
not yet the smallest design, because it adds a second public write path in version one. The single
biggest change I would make: remove `POST /sessions/{id}/commands` from version one. Version one
needs exactly one control verb (Stop) and two read verbs (snapshot and events). Send already has a
path, Queue and Steer arrive in milestone six, and the public route named after the private command
table contradicts the design's own rule that the command store stays private. The second largest
change is smaller but more mechanical: move the per-session sequence off `session_streams`. That row
is the liveness and ownership row, written by every heartbeat and by Stop settlement. Taking a row
lock on it for every durable record insert couples the durable-history path to the ownership path,
which is exactly the separation the architecture document promises. Beyond those two, the contracts
need role names instead of feature names in three places, and the work packages need to name real
modules and real packages before an agent starts a branch.

## Findings

Sorted by weight. File references are relative to
`docs/design/session-control-and-live-events/`.

| # | File and section | Weight | Concrete failure or cost | Proposed change |
|---|---|---|---|---|
| 1 | `contracts/persistence.md`, "Per-session ordering" | Critical | Sequence allocation locks `session_streams`, the same row heartbeats and Stop settlement write. Every durable record insert now waits behind, and delays, the ownership and liveness path. A slow record write can delay a heartbeat and push a healthy runner toward watchdog `lost`. | Allocate the sequence from a row that only the records domain writes. Add `session_sequences(session_id, latest_sequence)` or put the counter on the session record aggregate. Keep the lock, change its home. |
| 2 | `contracts/public-api.md`, "Submit input" | Critical | A second public admission path exists beside invoke while both accept new work. Two admission paths double the race surface the Stop package must prove, and version one gains no user capability because `on_busy` defaults to `reject`. | Cut the route from version one. Ship Stop, snapshot, and events. Introduce the input route with the Queue and Steer milestone, when the server queue is real and clients can display it. |
| 3 | `contracts/events.md`, "Authorization" | High | The rule is stated for the connection, not for its lifetime. An SSE connection can run for the length of an execution. A viewer whose project access is revoked keeps receiving live text and durable events until the client disconnects. | Re-check access on a bounded interval, or bound the connection lifetime and force a reconnect. State the interval in the contract. |
| 4 | `contracts/events.md`, "Shared envelope" | High | One envelope expresses two categories, so invalid shapes are expressible: a temporary frame carrying a sequence, or a durable event without one. `frame_or_event_id` names two roles in one field. The client reducer must guess from a missing field. | Give the envelope an explicit `kind` of `frame` or `event`, carry the sequence only on the event arm, and name the identifier `id`. SSE named events are the free way to do this on the wire. |
| 5 | `contracts/commands.md`, "Version-one delivery" | High | `deliver(command, runner_target)` implies a target the system cannot produce. Today `core/sessions/streams/runner_client.py` reaches one address from `env.runner.internal_url` with one shared bearer token, and the Redis `owner` value is an identity, not an address. The port signature promises multi-runner routing that does not exist. | Either drop the parameter until a runner registry exists, or define the resolver as its own port (`resolve_target(owner) -> address`) and say version one returns the single configured address. |
| 6 | `contracts/events.md` and the runner ingress | High | Frame ingress authenticates with the shared runner token only. A runner holding that token can inject frames into any session. The design rejects foreign output only after terminal settlement (`execution_terminal`); there is no rule for a foreign, non-terminal writer. | Require ingress to verify that the caller holds the current owner claim for that session and execution. Reject a non-owner with a private conflict code, and count it. |
| 7 | `contracts/public-api.md` and `api/AGENTS.md`, "Domain-level exceptions" | High | The contract lists status codes and short codes (`idempotency_key_reused`, `session_busy`, `execution_mismatch`, `execution_terminal`, `admission_unavailable`) but not the required error envelope. `api/AGENTS.md` mandates `{code, message, retryable, next_step?, details?}` for agent-actionable failures, raised as typed core exceptions and converted at the router. Without this in the contract, five work packages invent five bodies. | Add the envelope to the public contract, with a table of code, HTTP status, `retryable`, and `next_step`. State that core raises typed exceptions from `core/sessions/*/types.py` and the router converts them. |
| 8 | `contracts/public-api.md`, "Stop" and the existing router | High | `POST /sessions/{id}/stop` is a synonym for the shipped `POST /sessions/{session_id}/cancel` (operation `cancel_session_execution`). Two public names for one operation is the exact overload the decisions document forbids, and desktop, mobile, and any external client must migrate for a rename that buys nothing. | Keep `/cancel` for version one and record the spelling question as a separate API review. If the rename is wanted, mount both and deprecate the old one in a later milestone. |
| 9 | Whole RFC, migration | High | There is no flag or rollback point for any package. Immutable record inserts change producer behavior for readers that expect progressive tool rows, which is a behavior migration, not an additive one. | Add one env-backed switch per package in `api/oss/src/utils/env.py` (never `os.getenv`): direct delivery, frame ingress, sequence allocation, immutable inserts, sender migration. Each switch has a defined off behavior, which is current behavior. |
| 10 | `contracts/public-api.md`, "Submit input" | Medium | Role mixing in one object. `type` is a discriminator, `message` is input data, `on_busy` is admission policy. Worse, the two knobs overlap: with Stop on its own route, `type` has one value while `on_busy` carries the real choice. Invalid combinations are easy to express. | Use one knob. Either a typed union (`send`, `queue`, `steer`) or a single object with `input` and `policy.on_busy`. Do not ship both. |
| 11 | `contracts/commands.md`, "Command shape" | Medium | `target_execution_id` and the public `expected_execution_id` are one concept under two names across one boundary. A reader has to learn that they are the same guard. `payload` is a vague bucket at both layers. | Use one name for the guard on both sides. Type the payload per command type instead of a free object. |
| 12 | `contracts/public-api.md`, "Snapshot" | Medium | The snapshot mixes session data, execution state, pending work, read metadata (`history completeness`), and a cursor (`latest_sequence`) in one flat object. A client cannot tell which fields are truth about the session and which are truth about this read. | Group by role: `{session, execution, pending: {inputs, interactions}, cursor: {latest_sequence, history_complete}}`. |
| 13 | `work-packages/shared-client-reader.md` | Medium | The package says "desktop and mobile session state types" and never names a package. Three homes already exist: `web/packages/agenta-entities/src/session` (api plus state), `web/packages/agenta-chat/src/{transport,state}`, and `web/packages/agenta-sessions/src/watch` (`watchEventSource.ts`). Two agents will pick two homes. | Name them. Reducer, snapshot client, and SSE client in `@agenta/entities/session`; previews and rendering in `@agenta/chat`; fold or generalize `agenta-sessions/src/watch`. The hierarchy allows this, because `@agenta/chat` depends on `@agenta/entities`. |
| 14 | `work-packages/*` and `web/AGENTS.md` | Medium | No package names the Fern client rule. New session calls must go through `getSessionsClient()` from `@agenta/sdk/resources` with zod at the boundary. SSE cannot go through Fern, which is an exception the packages must state, or an agent writes raw axios and passes review by accident. | Add one line per client package: request/response through Fern, SSE through a URL builder beside `resolveInvocationUrl.ts`, zod at both boundaries. |
| 15 | `architecture.md`, "Ownership and health" | Medium | The Postgres mirror has one writer named (Stop settlement). The evidence run measured a row that stayed `is_running: true` for 193 seconds when nothing settled. If settlement is lost, the mirror stays wrong and every liveness poll reads it. | State that the watchdog also writes the mirror when it records `lost`, and that the mirror is derived state with exactly two writers. |
| 16 | `contracts/commands.md`, "Version one delivery" and `core/sessions/streams/runner_client.py` | Medium | The one existing direct hop lives in the `streams` domain and swallows every failure by design, because `kill` must succeed regardless. Stop needs the opposite: a failed delivery must stay recoverable and visible. Reusing that module by proximity will inherit the wrong failure policy. | Put the delivery port in `core/sessions/commands/interfaces.py`, the HTTP adapter beside it, and wire it in `api/entrypoints/`. Say in the contract that delivery failure is recorded, not swallowed. |
| 17 | `qa.md` and `web/AGENTS.md` | Medium | The client packages gain states a reviewer cannot reach by clicking: incomplete history, closed slow reader, stale preview replaced by a checkpoint, legacy session with null sequences. `web/AGENTS.md` requires Storybook stories for exactly these. | Add a QA row that each client package ships stories for the four states, and that `/m` gets a smoke check per the same file. |
| 18 | Observability, and the evidence report | Medium | The evidence run found interaction tokens inside runner logs. The design adds more logging around commands, records, and rejections. Section 10 requires that logs add no new exposure. | State the rule in the contract: identifiers only, never message content and never any token. Add one test that greps a captured log for the token prefix. |
| 19 | `contracts/persistence.md`, "Retention" | Medium | Records become permanent session history while their retention is still coupled to tracing quota. The fallback (`session_events`) is named but has no decision gate. | Make retention separation a completion gate on the durable-history package, with its own named check, before immutable inserts are enabled. |
| 20 | `contracts/public-api.md`, replay reads | Low | The `after=` sequence cursor is a bespoke pagination shape. The repository standard for reads is cursor pagination through `Windowing`. | Keep the sequence semantics, but shape the replay read like `Windowing` so one convention covers the API. |

## Simplifications

- **Cut the public input route from version one** (finding 2). What breaks: nothing user-visible.
  Queue and Steer are milestone six, and the busy default is `reject`. What we lose: one milestone
  of early feedback on the route spelling.
- **Cut the `/stop` spelling and keep `/cancel`** (finding 8). What breaks: nothing. What we lose:
  a nicer name, which a later API review can still take with a dual mount.
- **Cut `runner_target` from the delivery port until a second runner exists** (finding 5). What
  breaks: nothing today. A resolver port can be added later without touching public operations.
- **Keep the quarantine column instead of rebuilding rejection.** It is already implemented, has a
  migration, and passed a live stale-tail run. It keeps the late `usage` for token accounting and
  the late tool result for support, and reads already hide it, so the user-visible rule of the RFC
  (one terminal outcome, no late output in history) holds either way. What breaks if we cut
  quarantine and reject instead: we spend a slice re-testing behavior we already proved, and we lose
  the evidence trail on every future late-tail bug.
- **Do not add a `resync_required` event, a persistent runner spool, or Postgres ownership.** The
  RFC already defers all three. I agree with all three deferrals and record them here so a later
  reviewer does not reopen them.

## Release order

Each line names the guard. Every guard defaults to off, and off means today's behavior.

1. **Records acknowledged after the Postgres commit** (PR #6502). No flag needed. It removes a
   data-loss path and changes no interface.
2. **Admission before sandbox mutation** (PR #6500). Guard: `sessions.admission.strict`. Off falls
   back to current admission.
3. **Warm cancellation and child cleanup** (PR #6496). Guard: per-harness cancel path, plus the
   Codex adapter decision. Off keeps the current teardown.
4. **Durable Stop with direct delivery and the optional guard** (PR #6503, plus #6504 for the guard
   and clients). Guard: `sessions.commands.direct_delivery`. Off routes Stop through the heartbeat,
   which is today's path, so a failed rollout degrades to slow Stop rather than to no Stop.
5. **Watchdog settlement and late-tail handling** (PR #6501). Guard: the existing quarantine flag.
   Off leaves the current sweep behavior.
6. **Frame ingress and the bounded Redis stream**, senders untouched. Guard:
   `sessions.frames.ingress`. Off means no frames are written and nothing else changes.
7. **SSE relay to secondary readers only.** Guard: `sessions.events.relay`. Off leaves secondary
   clients on watch-and-refetch.
8. **Sequence allocation and immutable inserts.** Two guards, not one:
   `sessions.records.sequence` and `sessions.records.immutable`. The columns are nullable, so off
   for either is a clean rollback with no data change.
9. **Snapshot and replay routes.** Guard: route registration behind
   `sessions.events.replay`. Off keeps the current transcript endpoints.
10. **Sender migration to the shared read path.** Guard: `sessions.reader.shared`, evaluated per
    client so desktop and mobile can move separately. This is the only step that cannot be rolled
    back silently, because it changes who owns execution lifetime. Ship it last.
11. **Durable pending input, Queue, Steer, and the public input route.** Guard: the route itself,
    plus the busy default. Ship the route and keep `reject` until every client shows the queue.

## Questions for Mahmoud

**1. Does version one get a public input route?**
Option 1: ship `POST /sessions/{id}/commands` now with `on_busy: reject`, so external clients see
the final shape early. Option 2: ship only Stop, snapshot, and events now, and introduce the input
route with Queue and Steer. Recommendation: Option 2. The route adds a second admission path that
the Stop package must then prove safe, and it buys no capability until the server queue exists.

**2. Is Stop spelled `/stop` or does it keep `/cancel`?**
Option 1: rename to `/stop` and migrate desktop and mobile. Option 2: keep `/cancel` and defer the
spelling to the API review that already owns route names. Recommendation: Option 2. The rename costs
a client migration and changes no meaning, and the decisions document already parks final spelling.

**3. Where does the per-session sequence live?**
Option 1: `session_streams.latest_sequence`, as written. Option 2: a separate row owned by the
records domain. Recommendation: Option 2. Option 1 puts the durable-history write path and the
ownership write path on one lock, which contradicts the failure isolation the architecture promises
and creates a heartbeat delay under record load.

**4. Late output: quarantine or reject?**
Option 1: keep the shipped quarantine column, hidden from reads. Option 2: reject with
`execution_terminal` and keep only logs. Recommendation: Option 1. Both satisfy the user-visible
rule. Option 1 is already built, migrated, and tested on a live stale-tail run, and it keeps the
token accounting and the tool result that support asks for.

## Files read

- `docs/design/session-control-and-live-events/review-standard.md`
- `docs/design/session-control-and-live-events/README.md`, `rfc.md`, `architecture.md`,
  `decisions.md`, `plan.md`, `status.md`, `open-questions.md`
- `docs/design/session-control-and-live-events/contracts/public-api.md`, `commands.md`,
  `events.md`, `persistence.md`
- `docs/design/session-control-and-live-events/work-packages/README.md`,
  `stop-and-recovery.md`, `live-relay.md`, `durable-history.md`, `shared-client-reader.md`,
  `queue-steer-approvals.md`
- `docs/design/session-control-and-live-events/evidence-2026-09-03/report.md` (overnight worktree)
- `AGENTS.md`, `api/AGENTS.md`, `web/AGENTS.md`
- `.agents/skills/design-interfaces/SKILL.md`, `.agents/skills/agenta-package-practices/SKILL.md`
- `api/oss/src/apis/fastapi/sessions/router.py`, `api/oss/src/core/sessions/` (`commands`,
  `records`, `streams`), `api/oss/src/core/sessions/streams/runner_client.py`,
  `api/oss/src/dbs/postgres/sessions/`, `api/oss/src/tasks/asyncio/sessions/`
- `services/runner/src/sessions/` (file list, `auth.ts`)
- `web/packages/` (package list), `web/packages/agenta-chat/`,
  `web/packages/agenta-entities/src/session/`, `web/packages/agenta-sessions/src/watch/`,
  `web/packages/agenta-sdk/src/resources.ts`
