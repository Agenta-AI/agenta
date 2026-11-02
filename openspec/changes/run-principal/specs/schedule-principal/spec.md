# Schedule principal

## Purpose

Make the principal and agent of schedules and subscriptions explicit, check the current target before each run, and stop them when the principal loses access.

## ADDED Requirements

### Requirement: Triggers store their principal and agent
`trigger_schedules` and `trigger_subscriptions` SHALL store `principal_kind`, `principal_id` and, for a direct reference, `artifact_id`. Create SHALL set the principal from `request.state.principal`. An environment reference SHALL leave `artifact_id` null.

#### Scenario: Create by a human
- **WHEN** a signed-in user creates a schedule for an agent
- **THEN** the row SHALL store principal `human` with the user id and the agent's artifact id

### Requirement: Edits keep the stored principal
An edit by any principal with `EDIT_TRIGGERS` SHALL be allowed, as today, and SHALL NOT change the stored principal. The edit rule ships in M7 (CONTRACT.md section 6).

#### Scenario: Bob edits Alice's schedule
- **WHEN** Bob, with `EDIT_TRIGGERS`, changes the target agent of Alice's schedule
- **THEN** the change SHALL succeed and the schedule SHALL keep principal Alice

### Requirement: Each tick resolves its target and is rechecked before the claim
`TriggersDispatcher._run` SHALL resolve the current target, including environment references, then call `decide(RUN_WORKFLOWS, resource=agent)` with the stored principal, and only then claim the delivery. The invoke SHALL run the resolved revision.

#### Scenario: Creator removed from the organization
- **WHEN** a schedule's human principal is removed and the schedule fires
- **THEN** the schedule SHALL be paused and the delivery SHALL say why

#### Scenario: Subscription whose key was deleted
- **WHEN** the API key that is a subscription's principal is deleted and an event arrives
- **THEN** the subscription SHALL be paused and no run SHALL start

#### Scenario: Environment moved to another agent
- **WHEN** an environment-bound schedule fires after the environment was moved to another agent
- **THEN** the access check SHALL use the new agent, and the run SHALL use the revision that was checked

### Requirement: A refused tick records the delivery and pauses the trigger
On deny, the dispatcher SHALL record a failed delivery `access_denied` and pause the trigger in one transaction, keep the event's dedup key, create no session, and SHALL NOT invoke. A trigger without a principal SHALL be refused the same way with `missing_principal` and SHALL NOT be given one from `created_by_id`.

#### Scenario: Repeated event for a refused trigger
- **WHEN** the same event arrives twice for a trigger whose principal lost access
- **THEN** one failed delivery SHALL exist for that event and the trigger SHALL be paused

### Requirement: Archiving the agent pauses its triggers
`artifact_id` SHALL NOT cascade. Archiving an agent SHALL pause every trigger with that `artifact_id` (`agent_deleted`). A tick whose resolved target is archived SHALL pause the trigger.

#### Scenario: Agent deleted
- **WHEN** the agent of an active schedule is archived
- **THEN** the schedule row SHALL remain, paused, with the same `artifact_id`

### Requirement: Existing triggers are backfilled
The M2 revision SHALL set existing rows to `human(created_by_id)` and resolve `artifact_id` from direct references. Rows with no creator SHALL be paused (`missing_principal`) and listed. Environment-bound rows SHALL stay active.

#### Scenario: Schedule bound by variant
- **WHEN** an existing schedule references a workflow variant only
- **THEN** the backfill SHALL store that variant's artifact id
