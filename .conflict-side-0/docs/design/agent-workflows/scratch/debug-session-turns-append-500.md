# Debug report: session-turns append HTTP 500

Date: 2026-07-19. Stack: the local EE dev deployment (`agenta-ee-dev-wp-b2-rendering-*` containers). All code referenced here is the in-flight sessions redesign, which lives on JP's open PRs #5375 (backend) and #5376 (runner); none of it is on main yet.

Two terms used throughout. A "turn" is one user-message-to-agent-reply exchange inside a chat session. The "turn-append" is the runner's durable write at the end of each completed turn: it INSERTs one row into the `session_turns` table so that a later runner restart can find the harness's native session id and resume the conversation natively instead of replaying the transcript as text.

## 1. The verified request path and where the 500 is produced

The append request goes exactly where it is supposed to go. The lead suggesting the request might be eaten by a redirect or land on the wrong service turned out to be wrong.

- The runner container runs with `AGENTA_API_INTERNAL_URL=http://api:8000`, which resolves to the EE API container on the same compose network.
- `appendSessionTurn` POSTs to `${apiBase}/sessions/turns/` (services/runner/src/engines/sandbox_agent/session-continuity-durable.ts:168).
- The EE API access log records the failing requests at exactly the runner's timestamps. For the reported session `db58551b-f986-44ec-b939-d6b10b35717a`:
  - Runner: `append OK ... turn=0` at 09:52:37.645, then `append HTTP 500 ... turn=0` at 09:53:00.765, 09:54:23.105, 09:54:50.008 (all UTC, 2026-07-19).
  - EE API access log: `POST /api/sessions/turns/ HTTP/1.1" 500` at 09:53:00.765, 09:54:23.105, 09:54:50.008.

The API error log at 09:53:00.764 shows the actual exception:

```
asyncpg.exceptions.UniqueViolationError: duplicate key value violates unique
constraint "ix_session_turns_project_id_session_id_turn_index"
DETAIL: Key (project_id, session_id, turn_index) =
(019f4d22-..., db58551b-f986-44ec-b939-d6b10b35717a, 0) already exists.
```

The traceback runs through `append_turn` (api/oss/src/apis/fastapi/sessions/router.py:1086) into `SessionTurnsService.append_turn` (api/oss/src/core/sessions/turns/service.py:37) into the DAO's bare `session.add` plus `commit` (api/oss/src/dbs/postgres/sessions/turns/dao.py, `append`). Nothing on that path handles `IntegrityError`, so the `@intercept_exceptions()` decorator (api/oss/src/utils/exceptions.py:119) converts it into a generic 500. The database confirms the state: `session_turns` holds exactly one row for this session, `(db58551b-..., turn_index 0, pi_core, created 09:52:37)`, matching the one append that succeeded.

## 2. The root cause

The runner computes the turn index once per sandbox environment, not once per turn, so a warm environment that serves several turns keeps re-INSERTing the same index.

The mechanism, step by step:

- `acquireEnvironment` sets `environment.continuityTurnIndex = nextTurnIndex(...)` exactly once, at environment acquire time (services/runner/src/engines/sandbox_agent/environment.ts:962). For a fresh session that value is 0.
- The runner keeps finished environments warm in a keep-alive pool. When the next user message arrives within the idle TTL, the server takes the pooled environment and calls `engine.runTurn(live.environment, ...)` directly (the `hit-continue` branch, services/runner/src/server.ts:610). `acquireEnvironment` never runs again, so `continuityTurnIndex` stays frozen at its acquire-time value.
- At the end of every completed turn, `runTurn` records that same frozen index into the in-memory store and fires the durable append with it (services/runner/src/engines/sandbox_agent/run-turn.ts:572 and :584).

The first completed turn INSERTs `turn_index=0` and succeeds. Every later turn served by the same warm environment INSERTs `turn_index=0` again, which violates the unique index `(project_id, session_id, turn_index)` that migration oss000000014 created, and the API returns 500. That is precisely the db58551b log shape: one `append OK turn=0`, then `append HTTP 500 turn=0` on each following warm turn.

The second log shape confirms the same mechanism from the other direction. Session `e744a157-...` on 2026-07-18 shows indexes incrementing (turn=0 through turn=10) because its turns arrived five or more minutes apart, past the 60-second idle TTL, so each turn triggered a fresh cold acquire that recomputed the index. Its 500s appear exactly when a turn DID reuse a warm environment (duplicate turn=10, duplicate turn=11), and its late `turn=2` and `turn=3` failures came from a second pooled environment (the pool logged `poolSize=2`; approval-parked environments live for 300 seconds) that still carried the frozen index from its own, much earlier acquire.

A secondary defect sits on the API side: the write path treats a uniqueness conflict as an unknown error. The interceptor already maps `EntityCreationConflict` (api/oss/src/core/shared/exceptions.py) to a 409 Conflict response, but the turns DAO never raises it, so a duplicate INSERT surfaces as a 500 with a full traceback in the error log.

## 3. Blast radius

The failed append is fire-and-forget (`void ... .catch(() => {})` in run-turn.ts:584), so no turn fails and users see nothing at the moment of the error. The damage is deferred and silent:

- Most turns never reach the durable turn log. For a busy session only the first completed turn per environment acquire gets a row. After a runner restart, `hydrateHarnessSessionFromDurable` and the sandbox reconnect ladder (`fetchLatestSessionTurn` in sandbox-reconnect.ts:35) read a stale latest row. In the common single-environment case the row still happens to carry the right `agent_session_id` and `sandbox_id`, because those do not change across warm turns. But whenever more than one environment served the session (the e744a157 case), the latest surviving row can point at a dead sandbox and an outdated native session, so cold starts lose native continuity and degrade to transcript replay. That is exactly the degradation this table was built to prevent.
- Per-turn metadata is lost. Each row was meant to carry that turn's `stream_id` and `trace_id`, linking the turn to its trace. For every turn whose append 500s, that linkage row simply does not exist, which undermines anything that joins turns to traces (the records/turn-span work in the same PR stack).
- `turn_index` is not a turn counter. Even the rows that do land carry indexes that count environment acquires, not conversation turns, so any consumer treating the index as "how many turns has this conversation had" gets wrong numbers.
- Operational noise: every duplicate produces a full traceback in the API error log and a misleading 500 in the access log, which is how this investigation started with a wrong lead.

## 4. The minimal fix and where it should land

The unique index is correct and should stay; it is the thing that caught the bug. The runner's turn-index accounting is the component to change, with a small API-side hardening alongside it.

- Primary fix, on PR #5376's lane (the runner side of the sessions redesign): compute the turn index per turn instead of per acquire. Move the `nextTurnIndex` call from `acquireEnvironment` (environment.ts:962) to the start of `runTurn`, reading the process-wide `SessionContinuityStore` each time. The store already advances on every successful `record()` (session-continuity.ts:47), so a per-turn read yields 0, 1, 2, ... naturally, and it also fixes the two-pooled-environments case because both environments read the same shared store. `continuityTurnIndex` can stay as a field on the environment for the record-after-turn symmetry; it just needs to be refreshed at turn start.
- Secondary fix, on PR #5375's lane (the backend side): in `SessionTurnsDAO.append`, catch the SQLAlchemy `IntegrityError` for this unique constraint and raise `EntityCreationConflict`, which the existing interceptor already converts to a 409. A duplicate append then reads as what it is (a conflict on an idempotent-ish write) instead of an anonymous server error, and the runner's log line becomes diagnosable on sight.

Both fixes belong on the existing PR lanes, not a new one: the bug lives entirely inside code those two open PRs introduce, and landing the fix anywhere else would leave the PRs shipping a known-broken write path.

## 5. Open questions

- Should the runner retry a 409 with a freshly computed index, or is dropping the row acceptable? Within one Node process the single-threaded event loop makes read-then-record effectively atomic, but two runner replicas serving the same session could still collide. Today the local provider forbids multi-replica sessions (`LocalSandboxNotOwnerError`), so a retry may be over-engineering for now.
- Is `turn_index` meant to be a true conversation turn counter for consumers beyond continuity (analytics, the UI, the turn-span join)? If yes, the per-turn fix gives correct values going forward, but rows written while the bug was live carry wrong indexes; the dev database may deserve a wipe of `session_turns` before review.
- The e744a157 anomaly showed an approval-parked environment appending an index from five turns earlier. After the per-turn fix its append would compute the current latest index instead; worth a unit test covering "two pooled environments, interleaved completed turns" in services/runner/tests/unit/session-continuity-durable.test.ts.
