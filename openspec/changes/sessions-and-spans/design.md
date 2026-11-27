## Context

All code references are to `origin/main` at commit `8d6f0dff68` (13 November 2026). We read the code. We did not run it.

### Words used here

- **Span**: one recorded step of a run, for example one model call or one tool call. A **trace** is the tree of spans of one run.
- **Session**: one conversation with an agent, stored as a row (`SessionStream`). **Turn**: one exchange in a session, stored as a row (`SessionTurn`) with `turn_id` and `turn_index`.
- **Execution**: one run of the agent loop. The runner calls its id `turnId` on the wire. A fresh turn has one execution, and its id is the turn row's `turn_id`. An approval resume is a second execution of the same turn.
- **Ingest**: the API step that receives spans over OTLP (the OpenTelemetry wire format) and stores one row per span in the `spans` table.
- **Runner**: our service that runs the agent harness and makes the spans of the run. A **harness** is the program that runs the model loop, for example Pi. Other harnesses run through the sandbox agent, our adapter for them.

### Where the runner makes spans and sets the ids today

The runner has two tracers in `services/runner/src/tracing/otel.ts`:

- The Pi tracer, `createAgentaOtel` (`otel.ts:1320`, tracer at `otel.ts:1343`). It runs inside the Pi process as our extension (`services/runner/src/extensions/agenta.ts:559-597`). The runner copies the extension bundle into each sandbox (`services/runner/src/engines/sandbox_agent/pi-assets.ts:720-726` for a local run, `pi-assets.ts:903-912` for a Daytona sandbox), so its version is the runner's version. It makes `invoke_agent` (`otel.ts:1444`), one span per Pi turn (`otel.ts:1503`), model spans (`otel.ts:1520`) and tool spans (`otel.ts:1551`).
- The sandbox-agent tracer, `createSandboxAgentOtel` (`otel.ts:1994`, tracer at `otel.ts:2007`). It makes spans from the harness events for the other harnesses: `invoke_agent` (`otel.ts:2265`), `turn 0` (`otel.ts:2297`), the model span (`otel.ts:2302`), `execute_tool <name>` (`otel.ts:2385`) and `agent_error` (`otel.ts:2565`). For Pi it makes no spans (`emitSpans` is false, `otel.ts:2254-2259`, `harness-trace-port.ts:182`), because the Pi tracer makes them, with one exception: it makes `agent_error` (`otel.ts:2565`) when a Pi run sends no valid trace batch.

The ids today:

| Span | Pi tracer | Sandbox-agent tracer |
|---|---|---|
| `invoke_agent` | `session.id`, `gen_ai.conversation.id`, `ag.meta.turn.id` (`otel.ts:1460-1465`) | `session.id`, `gen_ai.conversation.id`, no turn id (`otel.ts:2282-2285`) |
| every other span | none | none |

Ingest maps the OpenInference name `session.id` to `ag.session.id` (`api/oss/src/apis/fastapi/otlp/extractors/adapters/openinference_adapter.py:62`), so `invoke_agent` ends up with `ag.session.id` in its attributes.

### Does the runner make every span itself, with the context?

Yes, for the spans it exports. The span processor drops every span that is not from the two runner tracers (`otel.ts:600-604`, `otel.ts:626-628`). Both tracer factories hold the session id and the turn id in their own closure for the whole run: the Pi tracer in `config.sessionId` and `config.turnId` (`otel.ts:1333-1334`, refreshed per Pi turn by `beginTurn`, `otel.ts:1403-1412`), filled from the turn control file (`agenta.ts:589-590`, written at `harness-trace-port.ts:142-145`); the sandbox-agent tracer in its `start` input and `init` (`otel.ts:2281`). So the runner can write both ids on every span.

One span in the same trace is not the runner's: the workflow span that the SDK makes in the services (the parent of `invoke_agent`). The normalizer calls `ag.tracing.store_session` (`sdks/python/agenta/sdk/middlewares/running/normalizer.py:311-327`) before the handler opens the workflow span, so it is not certain from reading that the workflow span gets `ag.session.id` on the HTTP path. The agent handler writes both ids on the workflow span itself (D6, decided for the turn id).

### How ingest fills `session_id` today, and why only on the root

`promote_identity_by_trace` (`api/oss/src/core/tracing/utils/trees.py:225-252`) copies `ag.session.id`, `ag.user.id` and `ag.agent.id` into the columns `session_id`, `user_id` and `agent_id`, only for spans with no parent. Its docstring gives the reason: "ingestion is span-by-span / partial-batch, so there is no cheap way to propagate identity from a root to children arriving in a different request." The service calls it at `api/oss/src/core/tracing/service.py:185`. The reason disappears when every span carries its own value.

Ingest normalizes `ag.*` attributes against the model `AgAttributes` (`sdks/python/agenta/sdk/models/tracing.py:94-111`, used at `api/oss/src/core/tracing/utils/attributes.py:258-262`). The model has `session` and `user` but no `turn`, so today an `ag.turn` value moves to `ag.unsupported.turn`. The API depends on the SDK by path (`api/pyproject.toml:86`), so the model ships in the API image.

### The spans table and its migrations

The table is `SpanDBE` (`api/oss/src/dbs/postgres/tracing/dbes.py`) with columns from `SpanDBA` (`dbas.py:63-75`: `session_id`, `user_id`, `agent_id`). The index `ix_spans_project_id_session_id` on `(project_id, session_id)` exists (`dbes.py:43-47`). Migration `oss000000003` added the three columns and that index with a plain `CREATE INDEX` (`api/oss/databases/postgres/migrations/tracing_oss/versions/oss000000003_add_span_identity_columns.py`). The tracing chain on `origin/main` ends at `oss000000007`.

The `tracing_oss` chain is shared: the paid edition runs it first, then its own `tracing_ee` chain (`api/ee/databases/postgres/migrations/runner.py:21-39`). So one migration in `tracing_oss` covers both editions. A migration that builds an index without blocking writes exists in the repo: `CREATE INDEX CONCURRENTLY` inside `op.get_context().autocommit_block()` (`api/ee/databases/postgres/migrations/core/versions/a2b3c4d5e6f7_add_retention_helper_indexes.py:22-35`).

### Who reads `ag.meta.turn.id` today

Nobody. A search of `origin/main` for `meta.turn` finds only the writer at `otel.ts:1465` and an old design note (`docs/design/agent-chat-turn-continuation/trace-continuation.md`). The web app, the API and the SDK do not read it. The web app reads `ag.session.id` from attributes in three places (`web/mobile/src/features/observability/sessionDrawer/sessionDrawerQueries.ts:60`, `web/packages/agenta-observability/src/state/queries.ts:418`, `web/packages/agenta-observability/src/filters/filterColumns.ts:182`). No web code filters on the `session_id` column.

### How the span query filters by a column

`POST /tracing/spans/query` (`api/oss/src/apis/fastapi/tracing/router.py:109`) takes conditions with a `field`. The field `session_id` is in the enum `Fields` (`api/oss/src/core/tracing/dtos.py:97`), validated as a string (`api/oss/src/core/tracing/utils/filtering.py:719-720`) and turned into SQL on the column (`api/oss/src/dbs/postgres/tracing/utils.py:856-857`). A `turn_id` field needs the same three lines.

### The resume path after an approval

When a person answers a paused tool call, the API makes a new execution with a new id (`api/oss/src/core/sessions/commands/service.py:869`, `execution_id = str(uuid4())`, parent `source_execution_id`). Delivery passes it as `continuation_execution_id` (`api/oss/src/core/sessions/commands/delivery.py:64`). The dispatcher sends it as `run_id` (`api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:597-598`), the SDK puts `meta.run_id` into `SessionConfig.turn_id` (`sdks/python/agenta/sdk/agents/handler.py:683`), and the runner uses it as `turnId` (`services/runner/src/server.ts:306-308`). The code reads as if the resume reuses the paused turn's index and the API answers a second row write with 409 (`services/runner/src/engines/sandbox_agent/session-continuity-durable.ts:327-331`, `services/runner/src/lifecycle/session-coordinator.ts:616-617`). The live check on 16 November 2026 saw otherwise: each cold approval resume wrote a second `session_turns` row with the continuation execution's id. This change does not read turn rows, so it is not affected; the spans of that resume carry the paused turn's id.

**Answer: no. The resumed run does not carry the paused turn's id today.** Its spans get a new id, where they get one at all. One exception, read but not run: on a live Pi resume the runner keeps the paused prompt's trace channel (`harness-trace-port.ts:184-190`), so Pi spans after the resume keep the control file's original turn id.

The dispatcher reads the session's latest turn row only as a fallback, when the interaction row has no references (`api/oss/src/core/sessions/interactions/references.py:62-78`).

A later turn row can exist while an approval waits: a steer, or an invoke without `on_busy`, starts a new run that writes the next turn row (checked by reading, 16 November 2026). So the latest turn row is not a safe source of the paused turn's id.

The service that admits the approval already loads the paused execution (`source`) and creates the continuation with `parent_execution_id=source_execution_id` (`api/oss/src/core/sessions/commands/service.py:869-876`). Each execution row keeps its parent (`api/oss/src/core/sessions/executions/dtos.py:18-30`), and `fetch_execution` reads one row (`executions/interfaces.py:14-23`). An execution that an approval created has `source_interaction_id` set. The nearest execution in the chain without it is the **turn's starting execution**, and its id is the turn row's `turn_id`. It can have a parent of its own: a queued input's execution points to the turn before it.

### What we could not verify

- We ran nothing. All statements come from reading the code.
- On a live Pi resume, which trace the spans after the approval land in. Answered by reading: they stay in the paused prompt's trace, under its `invoke_agent`, with the turn's starting execution id, because no new control file is written and Pi starts no new prompt. To check by a run.
- Whether the runner rejects an unknown request field. Answered by reading: no. `/run` and `/stream` share one handler that parses the body with `JSON.parse` and casts it to `AgentRunRequest`, with no schema check.
- The size of the `spans` table in the cloud, and the time a concurrent index build takes there.
- Whether a new message during a paused approval can create a later turn row before the approval arrives. Answered by reading: yes (see the resume path above), so D4 does not use the latest turn row.
- Whether the sessions page in the web app can switch to span focus (see Risks).

## Goals / Non-Goals

**Goals**

- Every span that the runner makes carries `ag.session.id` and `ag.turn.id` when the run has them, and so does the SDK workflow span at the root of an agent run's trace (D6).
- Each span row has `session_id` and `turn_id` copied from that span's own attributes, with indexes.
- Spans of a run that resumes after an approval carry the paused turn's id.
- One span query returns the spans of one session, and one returns the spans of one turn.
- A new runner with an old API works, and an old runner with a new API works.

**Non-Goals**

- The annotation schema, annotation retention, outside traces, an agent id on spans, `ag.refs.*` on runner spans, and an OpenTelemetry link from the resumed root to the paused span. Each is a later change (see the proposal).
- A backfill of old rows.
- Changes to the web app. Decided on 16 November 2026. The filter by turn is a change of the span query of the API only.

## Decisions

### D1. How the runner writes the ids on every span (Proposed)

| Option | Trade-off |
|---|---|
| A. Read the ids from the context in the processor's `onStart` (`otel.ts:621`), the way the run id travels today | One place. Misses spans started from a fallback context: Pi's turn and tool spans fall back to `context.active()` when there is no agent context (`otel.ts:1500`, `otel.ts:1516`, `otel.ts:1547`). |
| **B. One small helper per tracer factory that starts a span and sets both ids from the factory's own closure** | Two places, each next to the ids it uses. Works for every parent context. A new `startSpan` call that skips the helper would miss the ids, so a test checks that every exported span has them. |

Chosen: **B**. Each factory gets `startRunSpan(name, parent)`, which calls `tracer.startSpan` and then sets `ag.session.id` and `ag.turn.id` when they are set. `invoke_agent` stops writing `ag.meta.turn.id`. It keeps `session.id` and `gen_ai.conversation.id`, because OpenTelemetry asks for the conversation id there and the change costs nothing.

### D2. How ingest fills the columns (Decided)

Ingest copies each span's own `ag.session.id` into `session_id` and `ag.turn.id` into `turn_id`, for every span, not only the root. The values stay in the attributes. `user_id` and `agent_id` keep today's root-only rule, because they are not part of this change.

`AgAttributes` gets `turn: Optional[AgTurnAttributes]` with one field `id`, next to `session`, and `initialize_ag_attributes` keeps it the way it keeps `session` (`attributes.py:229-236`).

### D3. The migration (Proposed)

| Option | Trade-off |
|---|---|
| Plain `CREATE INDEX` in the migration, as `oss000000003` did | Simple. Blocks every write to `spans` for the whole build, so ingest stops on a large table. |
| **`ADD COLUMN` (nullable, no default), then `CREATE INDEX CONCURRENTLY` in an autocommit block, partial on `turn_id IS NOT NULL`** | Ingest keeps writing during the build. The build scans the table twice and takes longer. A failed build leaves an invalid index and a committed column; the rerun adds the column only if it is missing (`ADD COLUMN IF NOT EXISTS`) and drops the invalid index before it builds again, the pattern of `core_oss/versions/oss000000061_add_session_turn_usage.py`. |

Chosen: **the concurrent, partial index**. The next tracing migration (`oss000000008` on `origin/main`; the implementer takes the head at the time) does:

```python
def upgrade() -> None:
    op.execute("SET lock_timeout = '10s'")
    op.execute("ALTER TABLE spans ADD COLUMN IF NOT EXISTS turn_id VARCHAR")
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_spans_project_id_turn_id")
        op.execute(
            "CREATE INDEX CONCURRENTLY ix_spans_project_id_turn_id "
            "ON spans (project_id, turn_id) WHERE turn_id IS NOT NULL"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_spans_project_id_turn_id")
    op.execute("ALTER TABLE spans DROP COLUMN IF EXISTS turn_id")
```

`SpanDBE` declares the same index with `postgresql_where`, so the model and the database agree.

**Cost on a large table.** Adding a nullable column with no default changes only the catalog in PostgreSQL 11 and later. It needs a short exclusive lock, which waits for running queries on `spans` to finish. The migration sets `lock_timeout` (Proposed: 10 seconds) so that it fails fast and the deploy can retry, instead of queueing every ingest write behind it. The concurrent build reads the whole table but holds only a lock that lets reads and writes go on. A partial index covers only the rows that match its condition. Here it holds only new rows, so it starts empty and grows with new traffic. The `session_id` index does not grow in entry count, because a B-tree index (the default kind in PostgreSQL) already holds an entry for every row, null or not. Each new runner span adds one entry to the `turn_id` index.

**Old rows.** No backfill. Old rows keep `session_id` on the root only and have no `turn_id`.

### D4. Where the resumed run gets the paused turn's id (Proposed)

| Option | Trade-off |
|---|---|
| A. The runner looks up the turn row itself | The runner learns the index only when its turn row write fails with 409, after spans may have started. More runner code on the hot path. |
| B. The dispatcher reads the session's latest turn row and sends its `turn_id` | One query. Wrong when a later turn row exists while the approval waits, and that can happen (see the resume path above). |
| **C. The service that admits the approval walks the execution chain back to the turn's starting execution, and stores its id in the command data** | Exact in every case, chains of approvals included. The service already loads the paused execution and holds the executions store (`commands/service.py:869-876`); a chain has one row per approval, so the walk reads a few rows. The command carries the value to delivery, so the dispatcher needs no new store. |

Chosen: **C**. When the service creates the continuation execution, it starts at the paused execution and follows `parent_execution_id` with `fetch_execution` while the row was created by an approval (`source_interaction_id` is set). The first row that no approval created is the start of the turn, and its id is the turn's id. The walk must stop there, because `parent_execution_id` also links other executions: a queued new input that starts the next turn points to the execution before it (`commands/service.py:1838-1845`), and a recovery attempt that replaces a lost delivery points to the execution it replaces (`commands/service.py:1318-1325`). Neither has `source_interaction_id`. A delivery retry or a recovery attempt reuses the same command, so it keeps the command's `session_turn_id`. The service writes it into the command data as `session_turn_id`. Delivery passes it to `respond_many`, which puts it into the request meta. A command written before this change has no `session_turn_id`; the resume then gets a new turn id, as today.

The value travels under one name in each layer:

| Layer | Name | Value |
|---|---|---|
| Command data, request meta (API to services) | `session_turn_id` | the paused turn's id; absent on a fresh turn |
| `SessionConfig` and wire (SDK to runner) | `session_turn_id`, wire `sessionTurnId` | copied from meta |
| Runner tracers | `ag.turn.id` | `sessionTurnId` when set, else `turnId` |

The runner also writes this value into the Pi turn control file (`harness-trace-port.ts:144`), so Pi spans carry it on a cold resume. On a live Pi resume the Pi spans already carry the id of the turn's starting execution, because the paused prompt's trace channel stays open (see the open points above).

**Naming.** In the runner wire, the sessions API (records, interactions, streams, commands) and `SessionConfig`, the shipped name `turn_id` / `turnId` holds the execution id, and so do `target_turn_id`, `expected_turn_id` and `replacement_turn_id` on a command, the row that now also holds `data.session_turn_id`. This change does not rename those. The new field is named `session_turn_id` / `sessionTurnId` because its value is the `turn_id` of the session's turn row (`session_turns.turn_id`), which is also the value of `ag.turn.id` and of the span column `turn_id`. A reader who has an execution id from a record or a stream after an approval resume must map it to the turn first; that mapping is the execution chain above.

### D5. Queries (Proposed)

`Fields` gets `TURN_ID = "turn_id"`, validated as a string and handled as a string column, the same way as `session_id`. `OTelFlatSpan` (`Span` in `sdks/python/agenta/sdk/models/tracing.py:189-216`) gets `turn_id`, and the three mappings in `api/oss/src/dbs/postgres/tracing/mappings.py` copy it. No new route.

Example: all spans of turn `t2`:

```json
POST /tracing/spans/query
{"focus": "span", "filter": {"conditions": [{"field": "turn_id", "operator": "is", "value": "t2"}]}}
```

### D6. The SDK workflow span also carries the turn id (Decided)

The trace of an agent run has one span that the runner does not make: the workflow span from the SDK, which is the root of the trace and holds the agent's references, the turn's input and its final output. The SDK agent handler writes `ag.session.id` and `ag.turn.id` on it when the request carries a turn: `session_turn_id` when set, else `run_id`, the same value that the runner writes. One query on `turn_id` then returns the whole turn, root included.

A fresh turn on an idle session gets no execution id from the input admission (`api/oss/src/core/sessions/inputs/service.py:223`, `action="execute"` only), so the request reaches the handler without `meta.run_id`, and before this change the runner made its own turn id later (`services/runner/src/server.ts:306`). The handler now creates the run id for a session run that has none, writes it on the workflow span, and sends it to the runner as `turnId`, the way an approval resume already sends one. Found by the live check on 16 November 2026.

Decided on 16 November 2026.

Option A, runner spans only, is rejected: every reader of a turn would need a second request to get the input, the output and the agent's references.

## Before and after: one real span

A run with a harness other than Pi, in session `s-40`, turn `t2`. The agent calls the tool `send_email`. The sandbox-agent tracer makes the span at `otel.ts:2385-2391`.

**Before** (what the runner sends, and the row ingest writes):

```yaml
trace_id: T-b
span_id: sp-91
parent_id: sp-80          # the "turn 0" span
name: execute_tool send_email
attributes:
  openinference.span.kind: TOOL
  gen_ai.operation.name: execute_tool
  gen_ai.tool.name: send_email
  gen_ai.tool.call.id: call-7
  ag.data.inputs: {to: "...", subject: "..."}
row:
  session_id: null        # not the root, so ingest leaves it empty
  # no turn_id column
```

**After:**

```yaml
trace_id: T-b
span_id: sp-91
parent_id: sp-80
name: execute_tool send_email
attributes:
  openinference.span.kind: TOOL
  gen_ai.operation.name: execute_tool
  gen_ai.tool.name: send_email
  gen_ai.tool.call.id: call-7
  ag.data.inputs: {to: "...", subject: "..."}
  ag.session.id: s-40
  ag.turn.id: t2
row:
  session_id: s-40
  turn_id: t2
```

The `invoke_agent` span of the same run loses `ag.meta.turn.id` and gains `ag.session.id` and `ag.turn.id`. After the person approves, the resumed run makes trace `T-c`. Its spans carry `ag.turn.id: t2` too, so the query on `turn_id = t2` returns spans of `T-b` and `T-c`.

## Version skew

The runner, the services (SDK) and the API ship as separate images, and any pair can differ for a while.

| Case | What happens | Works? |
|---|---|---|
| New runner, old API | Old ingest has no `turn` in `AgAttributes`, so `ag.turn.id` moves to `ag.unsupported.turn`. No column. `ag.session.id` stays in attributes; the column stays root-only. Nothing reads `ag.meta.turn.id`, so its loss breaks nothing. | Yes |
| Old runner, new API | Child spans have no ids, so their columns stay empty. `invoke_agent` gets `session_id` from the mapped `session.id`. No `turn_id`. | Yes |
| New API pods, old ingest worker, during the rollout | The worker reads spans from a stream with a Pydantic model that ignores unknown fields (`api/oss/src/core/tracing/streaming.py:57-71`), so it drops `turn_id` for a few minutes. | Yes, with a short gap |
| New worker before the migration | The insert would name a missing column. The migration runs before the API and the worker start, as for every schema change. | Yes, by deploy order |
| New API, old SDK in the services | The SDK ignores the unknown meta key `session_turn_id` (`handler.py:668-672` reads only named keys). The resume gets a new turn id, as today. | Yes |
| New SDK, old runner | The runner ignores the unknown wire field `sessionTurnId` (no schema check: `JSON.parse` and a type cast; to confirm by a run). | Yes |
| New runner, old SDK | No `sessionTurnId`, so the runner uses `turnId`, as today. | Yes |

## Tests

Existing suites that must stay green, with the edits they need:

- Runner (`pnpm test` in `services/runner`, Vitest): `tests/unit/otel-skills-error.test.ts`, `otel-tool-call-name.test.ts`, `otel-foreign-spans.test.ts`, `otel-trace-target-attribution.test.ts`, `pi-trace-turn-export.test.ts`. Update any assertion on `ag.meta.turn.id`.
- API (`py-run-tests` in `api`): `tests/pytest/unit/tracing/utils/test_trees.py:1623-1676` (the root-only tests change to per-span), `unit/tracing/test_dao_ingest_identity_columns.py`, `unit/tracing/utils/test_attributes.py`, `unit/tracing/utils/test_filtering.py`, `unit/sessions/test_interactions_dispatcher.py`, `acceptance/tracing/test_spans_queries.py`, `acceptance/tracing/test_picker_filter_fields.py`.
- SDK (`py-run-tests` in `sdks/python`): `tests/pytest/unit/agents/test_wire_contract.py`, `test_wire_models.py`, and the tests of the agent handler.

New tests:

- Runner: `tests/unit/otel-identity-attributes.test.ts`. Drive each tracer through a run with a session and a turn, export to a capture, and assert that every span has both ids and none has `ag.meta.turn.id`. A run with no session writes neither. Two runs in one trace keep their own ids. With `sessionTurnId` set, every span carries it.
- API unit: ingest copies both ids on a child span; a span with no ids leaves both columns empty; `ag.turn` stays out of `ag.unsupported`; `turn_id` is a known filter field.
- API unit: the service that admits an approval stores `session_turn_id` equal to the turn's starting execution, for one approval, for two approvals in a row, and for an approval in a turn that a queued input started; `respond_many` puts it into the request meta; a command without it sends none.
- API migration unit: the tracing chain has one head, and the new revision follows `oss000000007` (pattern of `unit/migrations/test_tracing_session_sequence_chain.py`).
- API acceptance: ingest a root and two children with ids, then query `session_id` and `turn_id` with `focus: span`; two traces with one turn id both come back.
- SDK unit: `meta.session_turn_id` reaches the wire as `sessionTurnId`; without it the wire has no such key.
- SDK unit (D6): the workflow span of an agent run carries `ag.turn.id`, equal to `session_turn_id` when set and to `run_id` otherwise; a run with no turn writes none.
- Live check on the local stack: one chat turn with a gated tool, approve it, then query `turn_id` and see spans of both traces, the two workflow root spans included.

## Rollout

One pull request and one release, because every order of deploy works (see Version skew).

1. The release deploys the API image. The migration adds the column and builds the index.
2. The services and the runner deploy with the same release, in any order.

Nothing to turn on. No backfill. No feature flag.

## Risks / Trade-offs

- **More rows match a session filter on attributes (a check for the implementation).** No web app file changes in this change, but the web app filters sessions on `attributes.ag.session.id`. With trace focus (the default, `web/packages/agenta-observability/src/state/controls.ts:34-36`) the result is the same traces. With span focus, every runner span now matches, so a list of spans by session gets longer, and the session cost and token sums in `queries.ts:517-546` would add child spans. They prefer incremental metrics, which add up correctly, but they fall back to cumulative metrics. The implementer checks whether the sessions screen can switch to span focus and, if it can, whether its sums change (task 5.4), and reports the result instead of changing the web app.
- **The `session_id` column changes meaning** from "root span only" to "this span's own session". The comment on `SpanDBE` and on `Span.session_id` (`tracing.py:206-207`) must change. Old rows keep the old meaning.
- **The execution chain** (D4) stops at the turn's starting execution. A missing row stops the walk; the service then sends no `session_turn_id`, and the resume gets a new turn id, as today.
- **Known limit: an approval inside a recovery attempt.** When a delivery is lost, the recovery creates a replacement execution with no approval marker, and the replacement keeps the command's `session_turn_id`. If that replacement then pauses for a second approval, the walk stops at the replacement, so the second resume carries the replacement's id instead of the turn's id. It needs a lost delivery and then a second approval in the same turn. We accept it and do not add a lookup for it.
- **Lock wait** when the column is added (D3). `lock_timeout` turns a long wait into a fast failure and a retry.

## Migration

See D3. Old rows are not backfilled.

## Open Questions

None. The one question of the first draft (whether the SDK workflow span also carries the turn id) is decided; see D6.
