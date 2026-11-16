No web app file changes in this change. Each task names its test. Sections 1, 2 and 3 can run in parallel. Section 4 needs sections 1, 2 and 3. Section 5 needs all of them.

## 1. API: column, migration and ingest

- [ ] 1.1 Add `AgTurnAttributes` (one field `id`) and `turn` on `AgAttributes` in `sdks/python/agenta/sdk/models/tracing.py`; keep `ag.turn` in `initialize_ag_attributes` (`api/oss/src/core/tracing/utils/attributes.py`), as for `session`. Test: `unit/tracing/utils/test_attributes.py`, a span with `ag.turn.id` keeps it and has no `unsupported.turn`.
- [ ] 1.2 Add `turn_id` to `Span` in `sdks/python/agenta/sdk/models/tracing.py`, to `SpanDBA`, to the three mappings in `api/oss/src/dbs/postgres/tracing/mappings.py`, and the partial index to `SpanDBE`. Update the comments that call `session_id` root-only. Test: `unit/tracing/test_dao_ingest_identity_columns.py` writes and reads `turn_id`.
- [ ] 1.3 Write the next `tracing_oss` migration: `lock_timeout`, nullable `turn_id` with `ADD COLUMN IF NOT EXISTS` so a rerun after a failed index build works, then `CREATE INDEX CONCURRENTLY ix_spans_project_id_turn_id ... WHERE turn_id IS NOT NULL` in an autocommit block, with a downgrade. Test: a migration unit test that the chain has one head and the new revision follows the previous head; run the migration on the local stack and check the index is valid.
- [ ] 1.4 Change `promote_identity_by_trace` (`api/oss/src/core/tracing/utils/trees.py`): copy `ag.session.id` and `ag.turn.id` from every span; keep `user_id` and `agent_id` root-only. Test: update `unit/tracing/utils/test_trees.py` (child span gets its own ids; span without ids stays empty; ids are not taken from the root).

## 2. API: span query by turn

- [ ] 2.1 Add `TURN_ID = "turn_id"` to `Fields` (`api/oss/src/core/tracing/dtos.py`), parse it as a string in `utils/filtering.py`, and handle it as a string column in `api/oss/src/dbs/postgres/tracing/utils.py`. Test: `unit/tracing/utils/test_filtering.py`, `turn_id` is known and builds a column clause.
- [ ] 2.2 Acceptance test in `acceptance/tracing/test_spans_queries.py`: ingest a root and two children with ids, and a second trace with the same turn id; query `session_id` and `turn_id` with `focus: span`; assert every span comes back with both columns set.

## 3. Runner: ids on every span

- [ ] 3.1 Add optional `sessionTurnId` to `AgentRunRequest` (`services/runner/src/protocol.ts`), with a comment that says it is the session turn the execution belongs to, while `turnId` is the execution. Test: `tests/acceptance/server-contract.test.ts` accepts a request with and without it.
- [ ] 3.2 In `createAgentaOtel` (`services/runner/src/tracing/otel.ts`), add `startRunSpan(name, parent)` that sets `ag.session.id` and `ag.turn.id` from `config`; use it for every `startSpan`; remove `ag.meta.turn.id`. Test: new `tests/unit/otel-identity-attributes.test.ts`, every exported Pi span has both ids and none has `ag.meta.turn.id`.
- [ ] 3.3 Same helper in `createSandboxAgentOtel`; add `turnId` to its `init` and pass `request.sessionTurnId ?? turnId` from `engines/sandbox_agent/run-turn.ts`. The `agent_error` span that this tracer makes for a Pi run gets the ids too. Test: the same file, every exported sandbox-agent span has both ids; a run without a session has neither; two runs in one trace keep their own turn ids.
- [ ] 3.4 Write `request.sessionTurnId ?? request.turnId` into the Pi turn control file (`engines/sandbox_agent/harness-trace-port.ts:144`; the write at line 112 only feeds the export logs). Test: `tests/unit/pi-trace-turn-export.test.ts`, the control file carries the session turn id when set.

## 4. Resume: one turn id across an approval

- [ ] 4.1 Where the API admits an approval and creates the continuation execution (`api/oss/src/core/sessions/commands/service.py`), walk `parent_execution_id` from the paused execution while the row has `source_interaction_id`, to the turn's starting execution (the nearest execution in the chain that no approval created), and store its id as `session_turn_id` in the command data. Pass it from delivery (`commands/delivery.py`) to `respond_many` (`api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py`), which sets `meta.session_turn_id`. Test: unit tests for the walk (one approval, two approvals in a row, an approval in a turn that a queued input started) and for `respond_many` (meta carries the value; without it, no key).
- [ ] 4.2 In the SDK, read `meta.session_turn_id` into `SessionConfig.session_turn_id` (`sdks/python/agenta/sdk/agents/handler.py`) and send it as `sessionTurnId` (`agents/utils/wire.py`, `agents/wire_models.py`). Test: `unit/agents/test_wire_contract.py` and `test_wire_models.py`, the key is present when set and absent when not.
- [ ] 4.3 Decided: write `ag.turn.id` (`session_turn_id`, else `run_id`) and `ag.session.id` on the workflow span in the SDK agent handler (`handler.py`, where it reads `current_product_span()`), because it is not certain that the normalizer's `store_session` reaches that span. Test: an SDK unit test that the workflow span carries both ids.

## 5. Check end to end

- [ ] 5.1 Run `ruff format` and `ruff check --fix` in `api` and `sdks/python`; run the runner lint. Run the API, SDK and runner unit suites.
- [ ] 5.2 On the local stack: one chat turn with a gated tool, approve it, then query `turn_id` with `focus: span` and see spans of both traces with the same `turn_id`; query `session_id` and see child spans.
- [ ] 5.3 Version mix on the local stack: run the old runner image against the new API, and the new runner against the old API; one chat turn each must finish and store its spans.
- [ ] 5.4 Check the sessions screen of the web app without changing it: can it switch to span focus, and if so, do the session cost and token sums change now that child spans carry `ag.session.id`? Report the result; do not edit web app files.
