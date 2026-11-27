## Why

Readers of traces need to answer two questions with one filter each: "which spans ran in session `s-40`" and "which spans ran in turn `t2`". A session is one conversation with an agent. A turn is one exchange in a session, from one input until the run stops or waits for a person. A span is one recorded step of a run, and a trace is the tree of spans that one run makes.

Today the platform cannot answer either question for every span. The runner writes the session id only on its top span (`invoke_agent`), and only the Pi harness writes the turn id there, under the name `ag.meta.turn.id`. Ingest (the API step that stores incoming spans) fills the `session_id` column only on the root span of a trace. There is no `turn_id` column. After a person approves a paused tool call, the resumed run gets a new id, so its spans do not share the paused turn's id.

The product owner agreed on the target on 16 November 2026.

Later changes (for example annotations and feedback on agent runs) read spans by session and by turn.

## What Changes

- The runner writes `ag.session.id` and `ag.turn.id` on every span that it makes, in both of its tracers (the Pi tracer and the sandbox-agent tracer). `ag.turn.id` replaces `ag.meta.turn.id`. Decided.
- Ingest copies each span's own `ag.session.id` and `ag.turn.id` into the indexed columns `session_id` (exists) and `turn_id` (new). The values stay in the attributes too. Decided.
- Ingest keeps the `ag.turn` attribute namespace. Today an unknown `ag.*` namespace moves to `ag.unsupported`. Proposed.
- A migration adds the nullable column `spans.turn_id` and builds an index on `(project_id, turn_id)` without a long lock. Old rows are not backfilled.
- A run that resumes after an approval carries the paused turn's id, so spans of both traces share one `ag.turn.id`. Decided as a model. The mechanism is Proposed: the API follows the chain of executions back to the one that started the turn (the nearest one that no approval created), whose id is the turn's id, and passes it through the SDK to the runner as `sessionTurnId`.
- The SDK also writes `ag.turn.id` on the workflow span that it makes at the root of an agent run's trace, so a query by turn returns the whole turn. Decided.
- The span query of the API accepts a condition on the column `turn_id`, next to the condition on `session_id` that exists today. The change is in the API only.

## Capabilities

### New Capabilities

- `sessions-and-spans`: session and turn ids on every runner span and on the SDK workflow span, the indexed columns that ingest fills from each span's own attributes, one turn id across an approval resume, and span queries by session and by turn.

### Modified Capabilities

None.

## Impact

- Runner: `services/runner/src/tracing/otel.ts` (both tracers), `services/runner/src/protocol.ts` (one optional wire field), `services/runner/src/engines/sandbox_agent/run-turn.ts` and `harness-trace-port.ts` (pass the turn id to the tracers).
- API: one tracing migration (shared chain, so it runs in the open source and the paid edition), `api/oss/src/dbs/postgres/tracing/` (column, index, mappings, filter), `api/oss/src/core/tracing/utils/trees.py` (copy per span), `api/oss/src/core/tracing/dtos.py` and `utils/filtering.py` (the `turn_id` field), `api/oss/src/core/sessions/commands/service.py`, `commands/delivery.py` and `api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py` (resume carries the turn id).
- SDK: `sdks/python/agenta/sdk/models/tracing.py` (the `ag.turn` namespace and the `turn_id` field), `sdks/python/agenta/sdk/agents/handler.py`, `utils/wire.py` and `wire_models.py` (pass `sessionTurnId`, and write `ag.turn.id` on the workflow span).
- Web app: no change; no web app file changes. Nothing in the web app, the API or the SDK reads `ag.meta.turn.id` today.
- Size: one pull request, about 20 files, about 600 lines including tests.

### Later changes, not in this one

- The annotation schema: scope, author, actor, and links with roles.
- A retention class of their own for annotations.
- Anything for traces that do not come from our runner.
- An agent id on spans. Dropping the `ag.agent.id` that the SDK writes today belongs to a later change too.
- `ag.refs.*` references of the agent on runner spans, and the choice of the `application` reference family.
- An OpenTelemetry span link from the resumed run's root span to the paused span.
