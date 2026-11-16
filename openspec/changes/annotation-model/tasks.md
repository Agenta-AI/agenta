## 0. Before you start

- [ ] 0.1 Check what the change `sessions-and-spans` provides on the branch this change stacks on: the `turn_id` span column, the `ag.turn` namespace at ingest, the `turn_id` query field, and the per-span copy of `ag.session.id` and `ag.turn.id` into the columns. Code against that interface; rebase when the branch moves.
- [ ] 0.2 Build the decided forks and the five agreed simplifications as the design states them.
- [ ] 0.3 Check which credential the runner uses for the platform op `annotate_trace`, and write the result in the pull request.

## 1. Schema and ingest (API and SDK models)

- [ ] 1.1 Add the model `AgAnnotationAttributes` (`scope`, `author`, `actor`) and the field `annotation` to `AgAttributes` (`sdks/python/agenta/sdk/models/tracing.py`), and keep `ag.annotation` in `initialize_ag_attributes` (`api/oss/src/core/tracing/utils/attributes.py`) instead of moving it to `ag.unsupported`. Test: `unit/tracing/utils/test_attributes.py`.
- [ ] 1.2 Add the enums `AnnotationScope` (`span`, `trace`, `turn`, `session`) and `AnnotationPartyType` (`person`, `end_user`, `agent_run`, `platform`) and the model `AnnotationParty` `{type, user_id}`.
- [ ] 1.3 Add the optional input fields `scope`, `session_id` and `turn_id` to `SimpleTraceCreate` (`api/oss/src/core/tracing/dtos.py`). No `author` and no `actor` input field. No new response field.

## 2. Write path (API), after section 1

- [ ] 2.1 In `build_otel_links` (`api/oss/src/core/tracing/utils/traces.py`), take a list item's role from `attributes.key`; keep `"key"` for a list item with no role, as today. Keep the map case.
- [ ] 2.2 Add `find_turn(project_id, session_id?, turn_id?, trace_id?)` to the session turns DAO, its interface and its service: the matching row with the highest `turn_index`. The public turn query model does not change.
- [ ] 2.3 Write one layer 1 builder used by both routes: subject choice (link `subject`, else the first link); the turn and session anchor (no link, scope `turn` or `session`: link the span that the turn row names, else no link); the subject span lookup by key and the copy of its session and turn; else the request's session and turn; else the turn row by the subject's trace id; no turn at scope `session`; scope default `span` when a subject exists; author and actor `{type: person, user_id}` from the credential; agent references copied from the root span of the subject's trace when the request has no `application*` reference, with `workflow*` keys written as `application*` keys. It refuses nothing.
- [ ] 2.4 Call the builder from `AnnotationsService.create` and `SimpleTracesService.create`. Responses stay as today.
- [ ] 2.5 Keep layer 1 on edit in both services: copy `ag.session`, `ag.turn` and `ag.annotation` from the stored annotation, and keep the stored `application*` references when the edit names none. Links in an edit behave as today.

## 3. Retention (paid edition), can run in parallel with section 2

- [ ] 3.1 In `delete_traces_before_cutoff` (`api/ee/src/dbs/postgres/tracing/dao.py`), skip root spans whose attributes contain `{"ag": {"annotation": {}}}`; keep a root span with no attributes deletable.
- [ ] 3.2 Remove the raw SQL copy `_delete_traces_before_cutoff` if nothing calls it, else give it the same condition.
- [ ] 3.3 Add no entitlement and no second flush. Leave `delete_session` as it is.

## 4. Clients, after section 2

- [ ] 4.1 Web: no change. Check that the web schema (`web/packages/agenta-entities/src/annotation/core/schema.ts`) still parses every response.
- [ ] 4.2 Agent tool `annotate_trace`: no change (design D10). Check by test that an annotation written with the tool's request shape, on a running span of a session turn, gets the session and the turn from the turn row.
- [ ] 4.3 Regenerate the Python and TypeScript clients from the paid-edition API spec, if the request model change reaches them.

## 5. Tests

New unit tests:

- [ ] 5.1 Layer 1 builder: subject choice, the stored and not-stored subject span, the request values, the turn row by trace id, each scope rule, the turn-row anchor and the anchor with no row, the agent references, the scope check.
- [ ] 5.2 Links with roles and the map read shape, the edit path, and ingest keeping `ag.annotation`.
- [ ] 5.3 Retention query: a run trace, an evaluator trace from OTLP and an old annotation are deleted; an annotation with `ag.annotation` stays.

One test per flow of "What must not break", each asserting that every field of today keeps its value:

- [ ] 5.4 Web trace drawer annotation: map link `invocation`, `origin: human`, `channel: web`; create, read, edit, read.
- [ ] 5.5 Evaluation step key annotation: one link whose role is an evaluation step key; the role stays and the read is as today.
- [ ] 5.6 Testcase annotation without links: `links: {}`; stored and read with no new field.
- [ ] 5.7 Evaluator trace through OTLP with links `invocation`: stored as today, no `ag.annotation`, deleted by the flush.
- [ ] 5.8 Prompt trace annotation: subject span with no session and no turn; no session or turn on the annotation.
- [ ] 5.9 SDK annotation call: `POST /annotations` with a map link to a span that is not stored yet; accepted; the schema check on `data` still answers 422 on a mismatch.
- [ ] 5.10 A list of links without roles stores the role `"key"`.

Existing suites that must stay green, unchanged:

- [ ] 5.11 `api/oss/tests/pytest/acceptance/annotations/`, `unit/annotations/`, `unit/tracing/`, `unit/otlp/test_links_normalization.py`; `sdks/python/oss/tests/pytest/unit/test_evaluations_runtime.py` and `unit/agents/platform/test_op_catalog.py`. Run each area with `py-run-tests`.

End-to-end checks on a local deployment, before the pull request opens:

- [ ] 5.12 An evaluation of a prompt with one human evaluator and one automatic evaluator; the automatic results appear as before.
- [ ] 5.13 A human annotation of that evaluation's result in the web app; it shows and edits as before.
- [ ] 5.14 A human annotation of a prompt trace span in the trace drawer; reload; it shows and edits as before.
- [ ] 5.15 A testcase annotation in an annotation queue; the queue and the testset sync work as before.
- [ ] 5.16 An SDK annotation call, and a read with an old client shape (`POST /simple/traces/query`, `POST /annotations/query`), compared field by field with the base branch.
- [ ] 5.17 New behavior on a real agent run: an annotation on a turn and on a session is stored with the session, the turn, the scope and a link to the span that the turn row names; a span query by session and by turn finds it; it survives the retention job (paid edition, short cutoff) while its run's trace is deleted.
- [ ] 5.18 Run `ruff format` and `ruff check --fix` in `api` and `sdks/python`.

## 6. Docs

- [ ] 6.1 Describe the new request fields and the stored fields in the annotation docs, with Case 2 and Case 3 of the design as examples.
