## ADDED Requirements

### Requirement: Only the executing principal changes what durable work executes
For a trigger schedule, a trigger subscription and an evaluation run, the system SHALL let only the executing principal change what the work executes: its target agent or environment reference, its input, and for an evaluation run its configuration. A change by any other principal SHALL be refused, also when that principal has `EDIT_TRIGGERS` or `EDIT_EVALUATION_RUNS`. The refusal SHALL name the person the work runs as. Work whose executing principal is an API key SHALL be changed only with that same key. The executing principal SHALL NOT change on any edit.

#### Scenario: Bob edits Alice's schedule
- **WHEN** Bob, with `EDIT_TRIGGERS`, changes the target agent of a schedule whose executing principal is Alice
- **THEN** the system SHALL refuse the change, and the schedule SHALL keep its target and its principal

#### Scenario: Alice edits her own schedule
- **WHEN** Alice changes the input of a schedule whose executing principal is Alice
- **THEN** the change SHALL succeed and the schedule SHALL keep principal Alice

#### Scenario: Another key edits a key's schedule
- **WHEN** a schedule's executing principal is the API key K1, and a request with the API key K2 changes its input
- **THEN** the system SHALL refuse the change

#### Scenario: Bob edits Alice's evaluation run
- **WHEN** Bob, with `EDIT_EVALUATION_RUNS`, changes the testset of an evaluation run whose executing principal is Alice
- **THEN** the system SHALL refuse the change

### Requirement: Others may stop durable work
A principal with the capability SHALL be able to pause, stop, archive or delete durable work whose executing principal is someone else. These actions SHALL NOT change the executing principal.

#### Scenario: Bob pauses Alice's schedule
- **WHEN** Bob, with `EDIT_TRIGGERS`, pauses a schedule whose executing principal is Alice
- **THEN** the schedule SHALL be paused and SHALL keep principal Alice

### Requirement: A rerun or a copy is new work
A rerun or a copy of durable work SHALL be new work whose executing principal is the principal that starts it.

#### Scenario: Bob copies Alice's schedule
- **WHEN** Bob copies a schedule whose executing principal is Alice
- **THEN** the new schedule SHALL have principal Bob, and its runs SHALL use Bob's accounts for `caller_account` connections
