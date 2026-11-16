## ADDED Requirements

### Requirement: Session and turn ids on every runner span

The runner SHALL write `ag.session.id` and `ag.turn.id` on every span that it makes, in the Pi tracer and in the sandbox-agent tracer, whenever the run has a session id and a turn id (Decided on 16 November 2026).

#### Scenario: A tool span carries both ids

- **WHEN** the runner makes the span `execute_tool send_email` during turn `t2` of session `s-40`
- **THEN** the span carries `ag.session.id: s-40` and `ag.turn.id: t2`

#### Scenario: Every span of a run carries the ids

- **WHEN** a run in session `s-40` and turn `t2` exports its spans (`invoke_agent`, the turn span, model spans, tool spans and `agent_error`)
- **THEN** each exported span carries `ag.session.id: s-40` and `ag.turn.id: t2`

#### Scenario: A run without a session

- **WHEN** the runner runs an agent with no session id, for example a test run from a prompt
- **THEN** its spans carry neither `ag.session.id` nor `ag.turn.id`

#### Scenario: Two runs in one trace

- **WHEN** two runs of different turns share one trace id
- **THEN** the spans of each run carry the turn id of their own run

### Requirement: Turn id on the SDK workflow span

The SDK SHALL write `ag.turn.id` on the workflow span at the root of an agent run's trace whenever the request carries a turn, with the same value as the runner's spans (Decided on 16 November 2026).

#### Scenario: The root of a turn's trace

- **WHEN** the SDK makes the workflow span of an agent run in turn `t2` of session `s-40`
- **THEN** the span carries `ag.session.id: s-40` and `ag.turn.id: t2`
- **AND** a query on `turn_id = t2` returns the workflow span with the runner's spans

#### Scenario: The root of a resumed run

- **WHEN** the SDK makes the workflow span of a run that resumes turn `t2` after an approval
- **THEN** the span carries `ag.turn.id: t2`, taken from `session_turn_id`

#### Scenario: A workflow with no turn

- **WHEN** the SDK makes the workflow span of a prompt or an evaluator run with no turn
- **THEN** the span carries no `ag.turn.id`

### Requirement: The turn attribute name

The runner SHALL write the turn id as `ag.turn.id` and SHALL NOT write `ag.meta.turn.id` (Decided on 16 November 2026).

#### Scenario: The agent span after the change

- **WHEN** the Pi tracer makes the `invoke_agent` span of turn `t2`
- **THEN** the span carries `ag.turn.id: t2`
- **AND** the span carries no `ag.meta.turn.id`

#### Scenario: The OpenTelemetry conversation id stays

- **WHEN** the runner makes an `invoke_agent` span in session `s-40`
- **THEN** the span still carries `gen_ai.conversation.id: s-40` and `session.id: s-40` (Proposed)

### Requirement: Ingest keeps the turn namespace

Ingest SHALL keep attributes under `ag.turn` in place and SHALL NOT move them to `ag.unsupported` (Proposed).

#### Scenario: A span with a turn id arrives

- **WHEN** ingest receives a span with `ag.turn.id: t2`
- **THEN** the stored attributes hold `ag.turn.id: t2`
- **AND** `ag.unsupported` holds no `turn` key

### Requirement: Columns copied from each span's own attributes

Ingest SHALL copy each span's own `ag.session.id` into the column `session_id` and its own `ag.turn.id` into the column `turn_id`, for root spans and child spans alike, and SHALL keep both values in the attributes (Decided on 16 November 2026).

#### Scenario: A child span names its own ids

- **WHEN** ingest receives the child span `sp-91` with `ag.session.id: s-40` and `ag.turn.id: t2`
- **THEN** the row of `sp-91` has `session_id: s-40` and `turn_id: t2`
- **AND** its attributes still hold both values

#### Scenario: A span with no ids

- **WHEN** ingest receives a span with neither `ag.session.id` nor `ag.turn.id`
- **THEN** its `session_id` and `turn_id` columns stay empty
- **AND** ingest looks up no value from the root span or from a turn row

#### Scenario: A child span arrives in a later request

- **WHEN** the runner sends a long trace in two requests, and the root span is in the first one
- **THEN** each child span in the second request gets its columns from its own attributes

#### Scenario: User and agent columns keep today's rule

- **WHEN** ingest stores a span
- **THEN** it fills `user_id` and `agent_id` only on the root span, as today

### Requirement: The turn column and its index

The `spans` table SHALL have a nullable column `turn_id` with an index on `(project_id, turn_id)` for rows that have a turn id, built without blocking writes, and the migration SHALL NOT backfill old rows (Proposed; no backfill, decided on 16 November 2026).

#### Scenario: The migration runs on a large table

- **WHEN** the tracing migration runs on a `spans` table with many rows while ingest writes
- **THEN** it adds `turn_id` as a nullable column with no default
- **AND** it builds `ix_spans_project_id_turn_id` with `CREATE INDEX CONCURRENTLY`, partial on `turn_id IS NOT NULL`, so ingest keeps writing

#### Scenario: Both editions get the column

- **WHEN** the open source edition or the paid edition runs its tracing migrations
- **THEN** both run the shared `tracing_oss` chain, so both get the column and the index

#### Scenario: Old rows

- **WHEN** the migration finishes
- **THEN** rows written before it keep `session_id` on the root span only and have no `turn_id`

### Requirement: One turn id across an approval resume

A run that resumes a turn after a person answers a paused tool call through a continuation command SHALL write the paused turn's id as `ag.turn.id` on its spans, so spans of different traces share one turn id (Decided on 16 November 2026).

#### Scenario: The person approves a paused tool call

- **WHEN** the agent waits on approval of `send_email` in trace `T-b` of turn `t2`, and the person approves
- **THEN** the run that resumes makes trace `T-c`, and its spans carry `ag.turn.id: t2`
- **AND** a query on `turn_id = t2` returns spans of `T-b` and of `T-c`

#### Scenario: The API passes the paused turn's id

- **WHEN** the API dispatches the resume
- **THEN** it follows the execution chain back to the turn's starting execution (the nearest execution in the chain that no approval created) and sends that execution's id as `session_turn_id` in the request meta (Proposed)
- **AND** the SDK passes it to the runner as `sessionTurnId`, and the runner writes it as `ag.turn.id`

#### Scenario: A fresh turn

- **WHEN** a person sends a new message and a new turn starts
- **THEN** the request has no `sessionTurnId`, and the runner writes its own `turnId` as `ag.turn.id`

#### Scenario: Two approvals in one turn

- **WHEN** the resumed run of turn `t2` pauses again, and the person approves again
- **THEN** the second resumed run also writes `ag.turn.id: t2`

#### Scenario: An answer through a channel

- **WHEN** a person answers a paused tool call through a channel (for example a chat app), which resumes without a continuation command
- **THEN** the resumed run gets no `session_turn_id` in this change, and its spans carry the resumed execution's id as `ag.turn.id`, as today

#### Scenario: A queued message starts its own turn

- **WHEN** turn `t1` ends, the queued message of turn `t3` starts, and `t3` pauses for an approval that the person approves
- **THEN** the resumed run writes `ag.turn.id: t3`, not `t1`

### Requirement: Span queries by session and by turn

The span query of the API SHALL accept conditions on the columns `session_id` and `turn_id`, and SHALL return every span whose column matches, with no change to the web app (Proposed; API only).

#### Scenario: All spans of one turn

- **WHEN** a caller sends `POST /tracing/spans/query` with `focus: span` and the condition `turn_id is t2`
- **THEN** the platform returns every stored span whose `turn_id` is `t2`, across traces

#### Scenario: All spans of one session

- **WHEN** a caller sends the same query with the condition `session_id is s-40`
- **THEN** the platform returns every stored span whose `session_id` is `s-40`, child spans included

#### Scenario: The response names the turn

- **WHEN** the platform returns a span from the span query
- **THEN** the span carries `session_id` and `turn_id` next to its other fields

### Requirement: Mixed versions keep working

The runner, the services and the API SHALL keep working when one of them runs a version from before this change (Proposed).

#### Scenario: A new runner sends spans to an old API

- **WHEN** a runner with this change sends spans to an API without it
- **THEN** the API stores the spans, and `ag.turn.id` lands in `ag.unsupported`

#### Scenario: An old runner sends spans to a new API

- **WHEN** a runner without this change sends spans to an API with it
- **THEN** the API stores the spans, and child spans keep empty `session_id` and `turn_id` columns

#### Scenario: An old runner receives the turn id field

- **WHEN** the services send `sessionTurnId` to a runner without this change
- **THEN** the runner runs the turn and ignores the field
