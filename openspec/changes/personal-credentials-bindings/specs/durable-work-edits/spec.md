## ADDED Requirements

### Requirement: An edit makes the editor the executing principal
For a trigger schedule, a trigger subscription and an evaluation run, every save through an edit route SHALL write the caller as the executing principal, in the same database write as the change. The last save SHALL win, also for a save that changes only the name. Work SHALL never run with the personal accounts of a person who did not save it last.

#### Scenario: Bob edits Alice's schedule
- **WHEN** Bob, with `EDIT_TRIGGERS`, changes the target agent of a schedule whose executing principal is Alice
- **THEN** the change SHALL succeed and the schedule SHALL run as Bob, with Bob's own accounts for `"user"` items

#### Scenario: Alice edits her own schedule
- **WHEN** Alice changes the input of a schedule whose executing principal is Alice
- **THEN** the change SHALL succeed and the schedule SHALL keep principal Alice

#### Scenario: Bob edits Alice's evaluation run
- **WHEN** Bob, with `EDIT_EVALUATION_RUNS`, changes an evaluation run whose executing principal is Alice
- **THEN** the change SHALL succeed and the run SHALL have principal Bob

#### Scenario: A channel installation edits a trigger
- **WHEN** a channel installation sends an edit of a trigger schedule or subscription
- **THEN** the system SHALL refuse it with 403 `edit_from_channel_not_allowed`

### Requirement: Lifecycle actions keep the executing principal
A principal with the capability SHALL be able to pause, resume, stop, archive or delete durable work whose executing principal is someone else. These actions and worker writes SHALL NOT change the executing principal.

#### Scenario: Bob pauses Alice's schedule
- **WHEN** Bob, with `EDIT_TRIGGERS`, pauses a schedule whose executing principal is Alice
- **THEN** the schedule SHALL be paused and SHALL keep principal Alice

### Requirement: A rerun or a copy is new work
A rerun or a copy of durable work SHALL be new work whose executing principal is the principal that starts it.

#### Scenario: Bob copies Alice's schedule
- **WHEN** Bob copies a schedule whose executing principal is Alice
- **THEN** the new schedule SHALL have principal Bob, and its runs SHALL use Bob's own accounts for `"user"` items
