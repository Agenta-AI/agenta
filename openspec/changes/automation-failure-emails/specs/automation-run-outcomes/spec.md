# Automation run outcomes

## Purpose

Record how each automation run ended, so the automations screen shows the real result instead of
"dispatched", and so failures can be found.

## ADDED Requirements

### Requirement: Outcome on the trigger delivery
The system SHALL settle a trigger delivery by writing `data.outcome` (`completed`, `failed`,
`cancelled`, `waiting` or `skipped`) and, for `failed` and `skipped`, `data.reason_code`. It SHALL
NOT change the trigger delivery's `status`, and SHALL NOT add a column to `trigger_deliveries`.

The outcome of a started run SHALL come from the turn's `session_executions` row
(`terminal_outcome`). The tracing records SHALL be read only for a turn with no settled execution
(to find `paused` or `cancelled`) and for the error code of a `failed` turn.

#### Scenario: Run completes
- **WHEN** a `202` trigger delivery's turn has an execution settled `completed`
- **THEN** the trigger delivery SHALL get `data.outcome` `completed`, and its `status` SHALL stay `202 dispatched`

#### Scenario: Run fails with an error code
- **WHEN** a `202` trigger delivery's turn has an execution settled `failed`, and an `error` record with `attributes.code` `credential_delivery_failed`
- **THEN** it SHALL get `data.outcome` `failed` and `data.reason_code` `credential_delivery_failed`

#### Scenario: Watchdog ends a lost run
- **WHEN** the watchdog settles a `202` trigger delivery's turn as `lost`
- **THEN** it SHALL get `data.outcome` `failed` and `data.reason_code` `execution_lost`

#### Scenario: Runner thaws after the watchdog
- **WHEN** the watchdog settled a turn as `lost`, and the runner later sends a `done` with no `stopReason`
- **THEN** the trigger delivery SHALL keep `data.outcome` `failed`

#### Scenario: User stops the run
- **WHEN** a `202` trigger delivery's turn has an execution settled `stopped`
- **THEN** it SHALL get `data.outcome` `cancelled`

#### Scenario: Approval answered before the pass
- **WHEN** a `202` trigger delivery's turn paused, and a person answered the approval before the next pass, so the execution settled `continued`
- **THEN** it SHALL get `data.outcome` `waiting`

#### Scenario: Stop finds the turn gone
- **WHEN** a `202` trigger delivery's turn has an execution settled `not_running`
- **THEN** it SHALL get `data.outcome` `cancelled`

#### Scenario: Access refusal with an error code
- **WHEN** a `202` trigger delivery's turn has an execution settled `failed` whose `error.code` is `access_denied`
- **THEN** it SHALL get `data.reason_code` `access_denied` without waiting for the records

#### Scenario: Run waits for a person
- **WHEN** a `202` trigger delivery's turn has no settled execution, and its newest `done` has `stopReason` `paused`
- **THEN** it SHALL get `data.outcome` `waiting`

#### Scenario: Start-time failures
- **WHEN** a trigger delivery has status `400`, `403`, `422` or `500`
- **THEN** it SHALL get `data.outcome` `failed`, `failed`, `skipped` or `failed`, with `data.reason_code` `bad_configuration`, `paused_` followed by `data.error_details.code`, `agent_needs_setup` or `start_failed`

#### Scenario: Not settled
- **WHEN** a trigger delivery has status `102`, `409` or `200`
- **THEN** the system SHALL NOT write `data.outcome`

### Requirement: Error code of a failed run
For a turn whose execution settled `failed`, the reason SHALL be the execution's `error.code` if
set, else the code of the newest `error` record stored when the pass settles the row, else
`runner_error`. The pass SHALL NOT wait for a late `error` record. A `202` trigger delivery SHALL
settle once.

#### Scenario: Error code already stored
- **WHEN** a turn's execution settles `failed`, and its `error` record with a code is stored before the next pass
- **THEN** the trigger delivery SHALL get that record's code as `data.reason_code`

#### Scenario: Error code stored late
- **WHEN** a turn's execution settles `failed`, and its `error` record is stored only after the pass settled the row
- **THEN** the trigger delivery SHALL keep `data.outcome` `failed` and `data.reason_code` `runner_error`

#### Scenario: Run still going
- **WHEN** a `202` trigger delivery's turn has no settled execution and no `paused` or `cancelled` `done`
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
The outcome pass SHALL run behind the admin route `POST /admin/triggers/deliveries/settle`, which cron
calls every minute, whether email is on or off. It SHALL hold a guard lock with a 120-second TTL
and no renewal, and a request that finds the guard held SHALL return at once. Each pass SHALL read
start-time trigger deliveries (`400`, `403`, `422`, `500`) oldest first and `202` trigger deliveries
newest first, with keyset paging, through a partial index that leaves out settled rows, and SHALL
stop settling after 30 seconds, checking the deadline between pages and between rows; a row not
reached SHALL stay unsettled for the next pass. The same request then sends notification
deliveries with the time left.

#### Scenario: Large page set
- **WHEN** applying the rules to the rows read so far reaches 30 seconds in the middle of a page
- **THEN** the pass SHALL stop settling, leave the remaining rows unsettled, and send emails with the time left

#### Scenario: Two requests at once
- **WHEN** cron calls the route while the previous pass still runs
- **THEN** the second request SHALL return at once and settle nothing

#### Scenario: Pages move forward
- **WHEN** 1,200 `202` trigger deliveries of the last 24 hours have no `done`
- **THEN** one pass SHALL read three different pages of them, not the same page three times

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
