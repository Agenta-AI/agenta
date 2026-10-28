# Turn usage delta

## Purpose

Store cost and tokens on each turn, so displays need no trace access.

## ADDED Requirements

### Requirement: Usage stored on each turn
Each turn SHALL store input tokens, output tokens, total tokens, cost and the source (`runner` or `trace`). Each field SHALL be nullable, and null SHALL mean unknown.

#### Scenario: Completed turn
- **WHEN** an agent turn completes and its trace is ingested
- **THEN** the turn row SHALL hold its tokens and cost.

### Requirement: Writers and precedence
The runner SHALL send its usage on turn completion, stored only if the turn has no usage. Ingest SHALL write the priced usage of the trace root to the turn with the same trace id, with source `trace`. A runner value SHALL NOT replace a trace value.

#### Scenario: Runner cannot price the turn
- **WHEN** the runner completes a turn with tokens and no cost, and the priced trace arrives later
- **THEN** the turn SHALL first show cost as unavailable, then the trace cost, and a later runner write SHALL NOT replace it.

### Requirement: Displays read the turn
Chat turn metrics SHALL take tokens and cost from the turn and latency from its start and end times, without a trace read. Turn usage SHALL be readable exactly by the principals who may read the session.

#### Scenario: Session reader without trace access
- **WHEN** a Viewer of a shared session has no `VIEW_SPANS`
- **THEN** the turn footers SHALL show cost and tokens from the turn rows.

#### Scenario: Private session of another user
- **WHEN** Bob queries the turns of Alice's private session
- **THEN** the request SHALL be refused and Bob SHALL NOT receive its usage.
