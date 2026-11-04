# Automation run outcomes

## Purpose

Record how each automation run ended, so the automations screen shows the real result instead of
"dispatched", and so failures can be found.

## ADDED Requirements

### Requirement: Outcome on the trigger delivery
The system SHALL settle a trigger delivery by writing `data.outcome` (`completed`, `failed`,
`cancelled`, `waiting` or `skipped`) and, for `failed` and `skipped`, `data.reason_code`. It SHALL
NOT change the trigger delivery's `status`, and SHALL NOT add a column to `trigger_deliveries`.

#### Scenario: Run succeeds
- **WHEN** a `202` trigger delivery's turn has a `done` record with no `stopReason`, no `error` record, and the `done` was stored at least 5 minutes ago
- **THEN** the trigger delivery SHALL get `data.outcome` `completed`, and its `status` SHALL stay `202 dispatched`

#### Scenario: Error record and a plain done
- **WHEN** a `202` trigger delivery's turn has an `error` record with `attributes.code` `credential_delivery_failed` and a `done` record with no `stopReason`
- **THEN** it SHALL get `data.outcome` `failed` and `data.reason_code` `credential_delivery_failed`

#### Scenario: Watchdog ends a lost run
- **WHEN** the watchdog writes `error` with code `execution_lost` and a plain `done` for a `202` trigger delivery's turn
- **THEN** it SHALL get `data.outcome` `failed` and `data.reason_code` `execution_lost`

#### Scenario: Error stop reason with no error code
- **WHEN** a `202` trigger delivery's `done` has `stopReason` `error`, and no `error` record has a code
- **THEN** it SHALL get `data.outcome` `failed` and `data.reason_code` `runner_error`

#### Scenario: User stops the run
- **WHEN** a `202` trigger delivery's `done` has `stopReason` `cancelled`
- **THEN** it SHALL get `data.outcome` `cancelled`

#### Scenario: Run waits for a person
- **WHEN** a `202` trigger delivery's `done` has `stopReason` `paused`
- **THEN** it SHALL get `data.outcome` `waiting`

#### Scenario: Start-time failures
- **WHEN** a trigger delivery has status `400`, `403`, `422` or `500`
- **THEN** it SHALL get `data.outcome` `failed`, `failed`, `skipped` or `failed`, with `data.reason_code` `bad_configuration`, `paused_` followed by `data.error_details.code`, `agent_needs_setup` or `start_failed`

#### Scenario: Not settled
- **WHEN** a trigger delivery has status `102`, `409` or `200`
- **THEN** the system SHALL NOT write `data.outcome`

### Requirement: Wait for late error records
The system SHALL NOT settle a `202` trigger delivery until its newest `done` record has been stored
for at least 5 minutes. A `202` trigger delivery SHALL settle once. Records stored for its turn after
it settled SHALL NOT change its outcome.

#### Scenario: Error stored one minute after done
- **WHEN** a turn's plain `done` is stored, and its `error` record is stored 1 minute later
- **THEN** the trigger delivery SHALL get `data.outcome` `failed`

#### Scenario: Error stored after the trigger delivery was settled
- **WHEN** a turn's `error` record is stored 20 minutes after its plain `done`
- **THEN** the trigger delivery SHALL keep `data.outcome` `completed`

#### Scenario: Run still going
- **WHEN** a `202` trigger delivery's turn has no `done` record
- **THEN** it SHALL stay unsettled, and each pass SHALL read it again while it is less than 24 hours old

### Requirement: Settled once per status
The system SHALL write an outcome only if the trigger delivery still has the status it was read
with and has no outcome. A trigger delivery claimed again after a `500` SHALL be settled again from
its new status.

#### Scenario: Start failure claimed again
- **WHEN** a `500` trigger delivery was settled `failed`, and a repeated event claims it again and the run starts with `202`
- **THEN** the claim SHALL replace `data`, and the next pass SHALL settle the trigger delivery from its run

#### Scenario: Status changes during a pass
- **WHEN** a pass reads a `500` trigger delivery, and a repeated event claims it before the pass writes
- **THEN** the settle write SHALL change no row

### Requirement: One pass at a time, bounded
The outcome pass SHALL run every 60 seconds in the API, on at most one replica at a time under a
Redis lease, whether email is on or off. Each pass SHALL read start-time trigger deliveries (`400`,
`403`, `422`, `500`) oldest first and `202` trigger deliveries newest first, at most 10,000 of each,
through a partial index that leaves out settled rows.

#### Scenario: Two API replicas
- **WHEN** two API replicas run
- **THEN** only the replica that holds the lease SHALL run a pass

#### Scenario: Many runs still going
- **WHEN** 20,000 `202` trigger deliveries of the last 24 hours have no `done`, and a schedule writes a new `400`
- **THEN** the next pass SHALL settle the `400`

#### Scenario: Runs lost in an incident
- **WHEN** 20,000 older `202` trigger deliveries have no `done`, and a new run ends with an error
- **THEN** the pass SHALL read the new run first and settle it `failed`

### Requirement: Outcome on the automations screen
For a trigger delivery with status `202` and a `data.outcome`, the automations screen SHALL show
`completed` as worked, `failed` as failed, `cancelled` as cancelled, and `waiting` as waiting for a
person. Every other trigger delivery SHALL keep today's reading of `status.message`.

#### Scenario: Failed run after dispatch
- **WHEN** a trigger delivery has status `202 dispatched` and `data.outcome` `failed`
- **THEN** the screen SHALL show the run as failed, not as pending

#### Scenario: Old outcome on a changed status
- **WHEN** a `500` trigger delivery settled `failed` is turned into a `409` by a repeated event, and its `data` keeps `outcome`
- **THEN** the screen SHALL read the `409` status, not the outcome
