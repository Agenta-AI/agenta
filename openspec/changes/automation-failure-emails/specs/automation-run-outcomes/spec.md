# Automation run outcomes

## Purpose

Record how each automation run ended, so the automations screen shows the real result instead of
"dispatched", and so failures can be detected.

## ADDED Requirements

### Requirement: Outcome on the delivery
The system SHALL record the final result of an automation delivery in `data.outcome`, with the
values `succeeded`, `failed`, `cancelled`, `paused` and `skipped`, and the reason in
`data.outcome_code` for `failed` and `skipped`. The system SHALL NOT change the delivery `status`
to record an outcome, and SHALL NOT add a column to `trigger_deliveries`.

#### Scenario: Run succeeds
- **WHEN** a `202` delivery's run ends with a `done` record that has no `stopReason`, no `error` record exists for the turn, and the `done` was stored at least 5 minutes ago
- **THEN** the delivery SHALL get `data.outcome` `succeeded`, and its `status` SHALL stay `202 dispatched`

#### Scenario: Run fails with an error record and a plain done
- **WHEN** a `202` delivery's turn has an `error` record with code `credential_delivery_failed` and a `done` record with no `stopReason`
- **THEN** the delivery SHALL get `data.outcome` `failed` and `data.outcome_code` `credential_delivery_failed`

#### Scenario: Watchdog closes a lost run
- **WHEN** the watchdog writes `error` with code `execution_lost` and a plain `done` for a `202` delivery's turn
- **THEN** the delivery SHALL get `data.outcome` `failed` and `data.outcome_code` `execution_lost`

#### Scenario: Error stop reason without an error record
- **WHEN** a `202` delivery's `done` record has `stopReason` `error` and no `error` record exists
- **THEN** the delivery SHALL get `data.outcome` `failed` and `data.outcome_code` `runner_error`

#### Scenario: User stops the run
- **WHEN** a `202` delivery's `done` record has `stopReason` `cancelled`
- **THEN** the delivery SHALL get `data.outcome` `cancelled`

#### Scenario: Run waits for a person
- **WHEN** a `202` delivery's `done` record has `stopReason` `paused`
- **THEN** the delivery SHALL get `data.outcome` `paused`

#### Scenario: Start-time failures
- **WHEN** a delivery has status `400`, `403`, `422` or `500`
- **THEN** it SHALL get `data.outcome` `failed`, `failed`, `skipped` or `failed`, with `data.outcome_code` `bad_configuration`, the code in `data.error_details.code`, `agent_needs_setup` or `start_failed`

#### Scenario: Not decided
- **WHEN** a delivery has status `102`, `409` or `200`
- **THEN** the system SHALL NOT write `data.outcome`

### Requirement: Late error records
The system SHALL NOT decide a `202` delivery until its `done` record has been stored for at least
5 minutes, because a records batch that fails is written again after 30 seconds, up to 5 times.

#### Scenario: Error stored one minute after done
- **WHEN** a turn's `done` record with no `stopReason` is stored, and its `error` record is stored 1 minute later
- **THEN** the delivery SHALL get `data.outcome` `failed`

#### Scenario: Run still going
- **WHEN** a `202` delivery's turn has no `done` record
- **THEN** the delivery SHALL stay undecided, and the next pass SHALL read it again while it is less than 24 hours old

### Requirement: Decided once per status
The system SHALL write an outcome only if the delivery still has the status it was read with and
has no outcome. A delivery claimed again after a `500` SHALL be decided again from its new status.

#### Scenario: Start failure claimed again
- **WHEN** a `500` delivery got `data.outcome` `failed`, and then a repeated event claims it again and the run starts with `202`
- **THEN** the claim SHALL replace `data`, so the outcome is gone, and the next pass SHALL decide the delivery from its run

#### Scenario: Status changes during a pass
- **WHEN** a pass reads a delivery, and another writer changes its status before the pass writes the outcome
- **THEN** the write SHALL change no row, and no notification SHALL be opened or closed for it in that pass

### Requirement: One pass at a time
The outcome pass SHALL run every 60 seconds in the API, on at most one replica at a time under a
Redis lease, and SHALL run whether email is on or off.

#### Scenario: Two API replicas
- **WHEN** two API replicas run
- **THEN** only the replica that holds the lease SHALL run a pass

### Requirement: Outcome on the automations screen
The automations screen SHALL read `data.outcome` first: `succeeded` as worked, `failed` as failed,
`skipped` as skipped, `cancelled` as cancelled, and `paused` as waiting for a person. Without
`data.outcome`, it SHALL keep today's reading of `status.message`.

#### Scenario: Failed run after dispatch
- **WHEN** a delivery has status `202 dispatched` and `data.outcome` `failed`
- **THEN** the screen SHALL show the run as failed, not as pending
