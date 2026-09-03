# Staff review: session control and live events

> **AGENT-GENERATED, LOW WEIGHT.** This review is advisory. Mahmoud decides.

## Verdict

This is not yet the smallest design that meets the critical rows. The direction is sound: keep the runner private, make Stop durable and direct, preserve the warm sandbox and harness, separate temporary frames from durable facts, and defer multi-runner machinery. The design adds a broad public Send command and a replay system before it defines the smaller reliability spine they both need. The single biggest change I would make is to establish one Postgres execution-settlement compare-and-set, plus a retrying dispatcher for committed commands. Every runner outcome, watchdog outcome, late-record decision, liveness projection, and interaction cancellation should derive from that winner. That removes several races, makes accepted Stop recoverable after an API crash, and gives the later event work one authority instead of several cooperating conventions. I would also keep generic public commands out of version one, reject late output from canonical history, and require server-controlled rollout guards. This is the better trade-off between over-engineering and quality: build the concurrency mechanisms that already fail with one runner, but defer generic command APIs, multiple-runner routing, and global event infrastructure.

## Findings

| File and section | Weight | Concrete failure or cost | Proposed change |
|---|---|---|---|
| `architecture.md` "Command path"; `contracts/commands.md` "Failure rules"; `api/.../commands/service.py` `request_cancel` and `settle_abandoned_commands` | Critical: Stop is fast, safe, and warm | A command can commit and never reach the runner if the API process dies before or during direct delivery. The current sweep skips old pending commands while the session is still beating. It does not redeliver them. The accepted Stop can therefore remain pending while work continues, despite the RFC calling it recoverable. | Add one small command dispatcher. It reads committed pending or expired commands, calls the existing delivery port with the same command ID, and retries with bounded backoff until the command is claimed, obsolete, or its target is terminal. Run it independently of the request task. Assert a normal-operation delivery SLO of five seconds across an API restart. |
| `decisions.md` "Reject output after terminal settlement"; `contracts/persistence.md` "Durable record properties"; `api/.../records/service.py` `_quarantine_late_events` | Critical: One active execution and one terminal outcome | The built guard is narrower and weaker than the RFC. It quarantines only output after a watchdog terminal. Output after another terminal remains admissible. If the terminal lookup fails, it appends the whole batch unguarded, so stale output can enter visible history during the exact Postgres failure the guard must isolate. | Enforce the terminal check for every execution outcome at the database write boundary. On an unavailable check, leave ingest entries pending instead of admitting them. Reject content from canonical history with non-retryable `execution_terminal`. Preserve only bounded diagnostic metadata and usage accounting outside canonical session records. |
| `requirements.md` "Stop and hung executions"; `contracts/events.md` "Durable lifecycle vocabulary"; `qa.md` invariant 1 | Critical: One active execution and one terminal outcome | The RFC names one terminal winner but does not name the row or constraint that chooses it. Distinct runner and watchdog record IDs can both commit. A later reader filter is not a concurrency primitive. | Use the existing durable execution or turn row as the authority. Set its terminal state with `UPDATE ... WHERE terminal_state IS NULL RETURNING ...`. Only the winner appends the terminal event. Add a database constraint that prevents a second effective terminal event for the same execution. Do not add a new execution table if the current turn row can hold this state. |
| `architecture.md` "Stop sequence"; `contracts/commands.md` "State transitions"; `api/.../commands/service.py` `settle` | Critical: Session remains usable after every failure | Command settlement commits before clearing the stopping marker, updating liveness, cancelling interactions, and publishing the end. Those are separate calls and stores. A crash between them can leave a terminal command beside a session that still reads as stopping or an approval that remains actionable. The integration run already found several variants of this split-brain state. | Commit all Postgres facts in one transaction: terminal execution state, command state, interaction cancellation, and session-row projection. Perform Redis cleanup and notifications after commit through idempotent reconciliation. If existing service boundaries cannot share a transaction, persist a settlement outbox row in that transaction and reconcile until every projection matches. |
| `contracts/public-api.md` "Submit input"; `contracts/commands.md` "Command shape"; `work-packages/queue-steer-approvals.md` | Critical: Accepted input and committed history are not lost | The public API promises `202` only after Send is safe, but the private command contract defines only Stop semantics in the implementation, and the RFC does not define the atomic relation among input, execution, idempotency identity, and promotion. A client cannot tell whether a committed Send has an execution, is pending, or needs recovery. | Do not expose durable Send until one transaction creates the immutable input, its idempotency identity, and either the active execution or an explicit pending state. Keep the current invoke path during this work. Define the input lifecycle and retry result before adding Queue or Steer. |
| `web/.../useAgentChatSession.ts` `handleStop`; `contracts/public-api.md` "Stop" | Critical: Session remains usable after every failure | The desktop marks the turn stopped and aborts its stream before the durable Stop request succeeds. A failed request only shows a warning. It does not clear the stopped marker or restore the stream. The interface can therefore say "stopped" while work and billing continue, and the sender loses its live view. | Model `stopping` separately from `stopped`. Submit the durable Stop first. Keep or restore observation until a durable terminal outcome arrives. On request failure, clear the optimistic stopped state and reconnect or refresh. Render `stopped`, `failed`, `lost`, and `waiting` from server outcomes, not from the button click. |
| `qa.md` "Current timing reference"; evidence report "Scenario results" | Critical: Session remains usable after every failure | Runner death currently releases a session after roughly 90 to 150 seconds, but the RFC has no recovery SLO or user-visible `recovering` contract for that window. "Eventually usable" is too weak for a trust-critical interaction. | Set an explicit abandoned-execution settlement SLO and UI state. For version one, target no more than two missed heartbeats plus one sweep, and measure the percentile rather than only one run. Keep the conservative lease if needed, but show recovery progress and disable conflicting actions with a clear reason. |
| `contracts/public-api.md` "Acceptance rule"; `api/.../commands/dao.py` `create_command`; `web/.../session/api/api.ts` `cancelSessionExecution` | High: Retry, race, and disconnect correctness | The contract says conflicting reuse of an idempotency key returns `409`, but the DAO returns the existing row without comparing the request. The first-party Stop call also supplies no idempotency key. A lost response cannot reliably recover the same command identity. | Store a canonical request fingerprint with the idempotency key. Return the prior response only for an identical fingerprint and return `idempotency_key_reused` otherwise. Make an idempotency key required for Send, Queue, Steer, and interaction responses. Generate and retain one per Stop button action in first-party clients. |
| `decisions.md` "Serialize Stop and interaction responses with exact guards"; `contracts/commands.md` "Stop and interaction races" | High: Retry, race, and disconnect correctness | "The first transaction to commit wins" is a result, not an implementable lock rule. The contract does not say which row both paths lock, the order of locks, or the predicates that prevent a cancelled interaction and a continuation from both becoming durable. | Lock the session execution row first and the interaction row second in both paths. Use exact expected states in both updates. In the response-winning transaction, create the continuation execution and command with the accepted answer. In the Stop-winning transaction, cancel only interactions owned by the target execution. Add both commit-order tests. |
| `contracts/persistence.md` "Legacy records"; `architecture.md` "Migration" | High: Additive migration for existing sessions | Historical null sequences are safe, but post-migration writes through old endpoints are not covered. A legacy upsert can land after snapshot sequence N with no sequence of its own. Replay after N cannot return it, so a connected new reader can miss a committed change until a full refresh. | Keep historical rows null, but route every write made after the migration boundary through sequence allocation, including compatibility endpoints. If an old mutable row changes, append a sequenced immutable checkpoint for the new reader. Add a dual-client test where an old writer commits between snapshot and follow. |
| `contracts/events.md` "Shared envelope" and "Replay and live handoff" | High: Multiple clients converge on the same state | Temporary frames have stable IDs but no producer order. Redis insertion order cannot recover the runner's intended order after timeout, retry, or ingress through another API replica. Two clients can deduplicate the same frames yet fold them differently. | Add a monotonic `frame_index` scoped to execution and define duplicate and gap behavior. Ingress accepts an identical retry, rejects conflicting reuse, and records a gap. Clients order by the producer index, not wall-clock time. Keep durable `session_sequence` separate because it has a different owner and lifecycle. |
| `contracts/events.md` "Durable lifecycle vocabulary"; `open-questions.md` "Durable event payloads" | High: Multiple clients converge on the same state | The event names are selected, but the payloads, versioning rule, replacement semantics, and unknown-event behavior are not. API and client packages cannot implement one reducer independently from this list. | Freeze a discriminated, versioned envelope and exact payload for every version-one event before implementation branches start. Provide recorded contract fixtures for duplicates, gaps, preview replacement, unknown types, incomplete history, and every terminal outcome. Prefer one event version field over per-event ad hoc compatibility fields. |
| `rfc.md` "Delivery milestones"; `plan.md` "Checkpoints"; `status.md` | High: Additive migration for existing sessions | There is no feature flag, allowlist, capability negotiation, or rollback trigger. The new Stop route is already the desktop default on the integration branch, and later reader milestones replace the source of truth. Keeping old endpoints mounted does not make activation reversible. | Add server-authoritative milestone flags with an immediate kill switch and project allowlist. Return enabled session capabilities in the snapshot. Gate client behavior on both capability and client flag. State the rollback condition and old-path fallback for each work package. Do not use a browser-only flag for correctness. |
| `contracts/public-api.md` "Submit input"; `contracts/commands.md` "Purpose"; interface-design role rules | High: Replaceable transport boundaries | `POST /sessions/{id}/commands` exposes a private mechanism and mixes input data, operation kind, and busy policy in one flat body. It duplicates the existing invoke path and makes future command kinds part of a public tagged union. | Keep `session_commands` private. For version one, extend the existing invoke admission contract with role-based fields such as `input: {message, attachments}`, `policy: {on_busy}`, and `context: {idempotency_key}` where the protocol permits. If a new public resource is needed later, prefer a message or execution resource, not a generic command bucket. Keep `expected_execution_id` under an execution target object in body-based APIs. |
| `contracts/public-api.md` "Acceptance rule"; `api/AGENTS.md` "Domain-level exceptions" | High: Authorization and private runner control | The proposed errors list codes but not the repository-standard `{code, message, retryable, next_step?, details?}` envelope. The current command router returns strings or one-off `detail` objects. Clients will otherwise infer retry behavior from status codes and messages. | Define one typed session-operation error envelope now. Give each semantic code one status and retry rule. Put `current_execution_id` and similar fields under `details`. Use it for Stop, Send, Queue, Steer, interaction response, snapshot, and event admission failures. |
| `contracts/events.md` "Authorization"; `api/.../sessions/router.py` `watch_session_stream` | High: Authorization and private runner control | The design says event authorization matches transcript authorization, but the existing SSE check runs only at connect. A long-lived connection can continue receiving frames after membership, project access, or session visibility changes. | Bound SSE connection lifetime and force periodic authenticated reconnect, or revalidate authorization on a measured interval and on access-change notifications. Test access revocation while an execution is live. Keep runner ingress on private runner authentication and never accept a client-supplied runner target. |
| `work-packages/shared-client-reader.md`; `web/AGENTS.md`; `agenta-package-practices` | High: Multiple clients converge on the same state | "One reducer" has no package ownership. Without it, desktop and mobile can each wrap the contract in host-specific hooks, which recreates the current divergence. New session API code also risks repeating the integration branch's raw axios exception, contrary to repository practice. | Put session schemas, API access, cached durable entity state, and capability data in `@agenta/entities`. Put transcript projection and temporary preview folding in `@agenta/chat`, which already depends on entities and is consumed by both hosts. Keep host wiring thin. Regenerate and use the Fern client, retain Zod boundary validation, and place package tests under `tests/unit/`. |
| `qa.md` all sections | High: Retry, race, and disconnect correctness | The matrix is strong on warm Stop, but it does not require the failure points that threaten the proposed contracts: API death after command commit, API death during settlement, authorization revocation on SSE, old-writer commit during replay handoff, feature rollback, or a terminal-check database outage. | Add deterministic failure injection for each boundary. For every row assert the error, one terminal winner, command state, interaction state, Redis and Postgres projection, visible transcript, and a successful next message. Run sender, second browser, and mobile against the same execution. |
| `contracts/events.md` "Slow readers"; `open-questions.md` "Live-frame limits"; `contracts/public-api.md` "Snapshot" | Medium: Resource limits and backpressure | Retention and reader buffers are intentionally unmeasured, and the snapshot contains the full transcript with no size or pagination rule. One long tool stream or old session can exhaust an API worker or browser even if Redis is bounded. | Make frame size, stream age, per-session frame count, reader-buffer bytes, SSE connection duration, and snapshot response size explicit shared-env configuration. Reject oversized frames, close slow readers with a reason, and keep snapshot metadata separate from a windowed record read at one consistent watermark. |
| `review-standard.md` "Operational visibility"; `qa.md` "Evidence required" | Medium: Operational logs and metrics | The RFC lists desired evidence but no metric names, SLOs, alert thresholds, or cardinality rules. Logs alone will not show that Stop latency or lost settlements regressed after rollout. | Define the minimal counters and histograms before release: command admission, delivery attempts and latency, settlement outcome, watchdog settlement age, rejected late records, incomplete history, frame eviction, slow-reader close, and warm continuation. Put stable IDs in structured logs, but keep session and execution IDs out of metric labels. |
| `contracts/commands.md` "Version-one delivery" and "Future adapter" | Medium: Cost and implementation weight | The prose port has `deliver`, `recover`, and `settle`, while the implemented transport port has `deliver` and an unused `acknowledge`; settlement lives in the service. This predicts adapter behavior and blurs the boundary. | Reduce the transport port to `deliver(command) -> receipt`. Put retry scheduling and settlement in the command service and dispatcher. Add claim APIs only when the parked polling adapter is implemented. This keeps the long-poll replacement point without carrying speculative methods. |

## Simplifications

| Cut, defer, or merge | What breaks if we cut it |
|---|---|
| Cut the generic public Send command endpoint from version one. Keep the command table private and extend existing invoke admission when durable Send is ready. | Queue and Steer cannot become one generic public call yet. Stop, safe admission, and later transport replacement do not break. |
| Split approval continuation from Queue and Steer. Ship durable approval acceptance after reliable Stop, then defer server Queue and Steer until the shared snapshot can display pending input. | Cross-device queue visibility and interrupt-then-resume Steer remain unavailable. Accepted approval answers stop disappearing sooner, with a smaller race surface. |
| Reject late content from canonical history. Keep only diagnostic metadata and usage accounting outside session records. | Support loses the raw late tool payload from the primary transcript store. User-visible history, retention, and replay become simpler and safer. |
| Defer `session_events` unless the record-retention separation or progressive-update audit fails. Reuse repaired records only after those two gates pass. | If either gate fails, durable replay waits while a dedicated event table is built. No risky record backfill is required. |
| Defer multiple-runner routing, ownership generations, WebSockets, gRPC, and runner polling. Keep only the delivery port. | A deployment with more than one runner cannot promise fast direct Stop. That deployment is explicitly not version one. |
| Merge snapshot state and replay contracts around one watermark. Do not create separate cursor concepts for messages, tools, interactions, and executions. | Independent retention or partitioning per entity is unavailable. Version one gains one predictable recovery rule. |
| Keep the sender on invoke until durable replay is proven. Do not detach execution merely to complete the live-relay milestone. | Closing the sender still depends on current runner behavior during the secondary-reader stage. Other clients can still observe live frames, and the migration remains reversible. |

## Release order

| Order | Production slice | Flag or guard |
|---:|---|---|
| 0 | Freeze terminal CAS, command retry, error envelope, event envelope, and payload fixtures. | No exposed behavior. Contract tests must pass against old and new paths. |
| 1 | Land admission-before-sandbox, record acknowledgement after commit, the terminal compare-and-set, and idempotent settlement reconciliation. | Server kill switch only. Observe in shadow where possible. Do not change clients. |
| 2 | Release Stop and recovery with direct delivery and the retrying dispatcher. | `session_control_v1` server flag, project allowlist, optional `expected_execution_id`, first-party idempotency key, old Stop fallback, and automatic disable on delivery or settlement SLO breach. |
| 3 | Repair records and allocate sequences for every post-migration durable write. Run snapshot and replay in shadow. | `session_history_v1` write flag. No client reads until retention is independent, progressive updates are removed, and shadow snapshots match existing transcripts. |
| 4 | Release bounded live relay to secondary readers while the sender stays on invoke. | `session_live_relay_v1` project allowlist. Enforce measured ingress, Redis, reader, and connection limits. Fall back to watch-and-refetch. |
| 5 | Release snapshot plus durable replay to secondary readers. | `session_replay_v1` capability in snapshot plus client flag. Disable on cursor gaps, incomplete-history growth, or reducer mismatch. |
| 6 | Move desktop sender, then mobile, to the shared reader and detach execution from the start request. | Separate `session_shared_reader_desktop_v1` and `session_shared_reader_mobile_v1` flags. Keep invoke and old watch mounted until parity and rollback tests pass. |
| 7 | Release durable approval response and continuation. | `session_durable_approvals_v1`, exact interaction and execution guards, and old response compatibility. |
| 8 | Release server Queue, then Steer. | Separate `session_queue_v1` and `session_steer_v1` flags. Keep busy default `reject` until every enabled client shows pending input. Steer requires proven save-before-stop and priority-promotion races. |

## Questions for Mahmoud

### 1. What is the public Send surface?

- **Option 1:** Keep the existing invoke operation and add durable admission semantics to it.
- **Option 2:** Add `POST /sessions/{id}/commands` with a public tagged union for Send, Queue, and Steer.
- **Recommendation:** Option 1. It removes a duplicate start path and keeps delivery commands private. Add a new public resource only when invoke cannot express durable acceptance cleanly.

### 2. Where does late output go?

- **Option 1:** Reject it from canonical session records and retain bounded diagnostic metadata and usage accounting elsewhere.
- **Option 2:** Keep raw quarantined rows in `session_records` and require every current and future reader to exclude them.
- **Recommendation:** Option 1. The user-history invariant should fail closed. Option 2 buys support detail at the cost of a permanent second class of records in the canonical table.

### 3. How gradual must rollout be?

- **Option 1:** Use one global environment switch per milestone.
- **Option 2:** Use a server kill switch plus project allowlist and advertise enabled capabilities to clients.
- **Recommendation:** Option 2. Stop and reader migrations cross API, runner, and two clients. A global switch cannot contain a contract mismatch or roll out desktop before mobile.

### 4. Are repaired records the permanent event log?

- **Option 1:** Use records if tracing retention is separated and every progressive update is removed before immutable writes begin.
- **Option 2:** Add a dedicated `session_events` table now.
- **Recommendation:** Option 1 with hard gates. It is the smaller migration. Choose Option 2 immediately if either gate fails; do not compensate with reader filters or backfill.

### 5. What is the public Stop verb?

- **Option 1:** `POST /sessions/{id}/stop` publicly, with private runner cancellation terminology.
- **Option 2:** `POST /sessions/{id}/cancel` publicly and privately.
- **Recommendation:** Option 1. The product action is Stop, it preserves the session, and `cancel` already describes lower-level harness work. Separate names clarify the public and private boundaries.

## Files read

- `/tmp/claude-1000/-home-mahmoud-code-agenta-2/7c724667-82cd-41a6-ba0b-e47bc96b4f67/scratchpad/night/REVIEW-BRIEF.md`
- `session-rfc/docs/design/session-control-and-live-events/review-standard.md`
- `session-rfc/docs/design/session-control-and-live-events/README.md`
- `session-rfc/docs/design/session-control-and-live-events/rfc.md`
- `session-rfc/docs/design/session-control-and-live-events/requirements.md`
- `session-rfc/docs/design/session-control-and-live-events/decisions.md`
- `session-rfc/docs/design/session-control-and-live-events/architecture.md`
- `session-rfc/docs/design/session-control-and-live-events/contracts/commands.md`
- `session-rfc/docs/design/session-control-and-live-events/contracts/events.md`
- `session-rfc/docs/design/session-control-and-live-events/contracts/persistence.md`
- `session-rfc/docs/design/session-control-and-live-events/contracts/public-api.md`
- `session-rfc/docs/design/session-control-and-live-events/plan.md`
- `session-rfc/docs/design/session-control-and-live-events/work-packages/README.md`
- `session-rfc/docs/design/session-control-and-live-events/work-packages/durable-history.md`
- `session-rfc/docs/design/session-control-and-live-events/work-packages/live-relay.md`
- `session-rfc/docs/design/session-control-and-live-events/work-packages/queue-steer-approvals.md`
- `session-rfc/docs/design/session-control-and-live-events/work-packages/shared-client-reader.md`
- `session-rfc/docs/design/session-control-and-live-events/work-packages/stop-and-recovery.md`
- `session-rfc/docs/design/session-control-and-live-events/qa.md`
- `session-rfc/docs/design/session-control-and-live-events/status.md`
- `session-rfc/docs/design/session-control-and-live-events/open-questions.md`
- `session-overnight/docs/design/session-control-and-live-events/evidence-2026-09-03/report.md`
- `session-overnight/docs/design/session-control-and-live-events/evidence-2026-09-03/integration-refresh.md`
- `session-overnight/docs/design/session-control-and-live-events/review-2026-09-02.md`
- `integration/AGENTS.md`
- `integration/api/AGENTS.md`
- `integration/web/AGENTS.md`
- `integration/.agents/skills/agenta-package-practices/SKILL.md`
- `agenta/.agents/skills/design-interfaces/SKILL.md` because the path named in the brief was absent from the integration worktree
- `integration/api/oss/src/core/sessions/commands/interfaces.py`
- `integration/api/oss/src/core/sessions/commands/dtos.py`
- `integration/api/oss/src/core/sessions/commands/types.py`
- `integration/api/oss/src/core/sessions/commands/service.py`
- `integration/api/oss/src/dbs/postgres/sessions/commands/dao.py`
- `integration/api/oss/src/apis/fastapi/sessions/models.py`
- `integration/api/oss/src/apis/fastapi/sessions/router.py`
- `integration/api/oss/src/core/sessions/records/service.py`
- `integration/api/oss/src/dbs/postgres/sessions/records/dao.py`
- `integration/api/oss/src/core/sessions/streams/runner_client.py`
- `integration/api/oss/src/dbs/http/sessions/control_delivery_direct.py`
- `integration/web/packages/agenta-entities/src/session/api/api.ts`
- `integration/web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts`
- `integration/web/packages/agenta-chat/package.json`
- `integration/web/packages/agenta-entities/package.json`
- `integration/web/mobile/package.json`
- `integration/web/oss/package.json`
