# Automation run outcomes

## Purpose

Record how each automation run ended, so the automations screen shows the real result instead of
"dispatched", and so failures can be found.

## ADDED Requirements

### Requirement: Outcome on the trigger delivery
The system SHALL settle a trigger delivery by writing `data.outcome` (`completed`, `failed`,
`cancelled`, `waiting` or `skipped`) and, for `failed` and `skipped`, `data.reason_code`. It SHALL
NOT change the trigger delivery's `status`, and SHALL NOT add a column to `trigger_deliveries`. The
outcome of a started run SHALL come from the turn's `session_executions` row. The tracing records
SHALL be read only for a turn with no settled execution and for the error code of a failed one,
which SHALL be the code of the newest `error` record that has a code.

#### Scenario: Run completes
- **WHEN** a `202` trigger delivery's turn has an execution settled `completed`
- **THEN** the trigger delivery SHALL get `data.outcome` `completed`, and its `status` SHALL stay `202 dispatched`

#### Scenario: Run fails with an error code
- **WHEN** a `202` trigger delivery's turn has an execution settled `failed`, and an `error` record with `attributes.code` `credential_delivery_failed`
- **THEN** it SHALL get `data.outcome` `failed` and `data.reason_code` `credential_delivery_failed`

#### Scenario: Error code on the execution
- **WHEN** a `202` trigger delivery's turn has an execution settled `failed` whose `error.code` is `access_denied`
- **THEN** it SHALL get `data.reason_code` `access_denied`

#### Scenario: Coded acquire error and a codeless fallback error
- **WHEN** a run's acquire fails with an `error` record coded `credential_delivery_failed`, and the runner's fallback adds a second `error` record with no code
- **THEN** the trigger delivery SHALL get `data.reason_code` `credential_delivery_failed`

#### Scenario: Error code stored late
- **WHEN** a turn's execution settles `failed`, and its `error` record is stored only after the pass settled the row
- **THEN** the trigger delivery SHALL keep `data.outcome` `failed` and `data.reason_code` `runner_error`

#### Scenario: Run fails before the agent loop
- **WHEN** the runner cannot create a sandbox for a trigger run, and writes an `error` record and its fallback `done`
- **THEN** the execution SHALL settle `failed`, and the trigger delivery SHALL get `data.outcome` `failed`

#### Scenario: Watchdog ends a lost run
- **WHEN** the watchdog settles a `202` trigger delivery's turn as `lost`, and the runner later sends a `done` with no `stopReason`
- **THEN** it SHALL get `data.outcome` `failed` and `data.reason_code` `execution_lost`, and keep them

#### Scenario: Run waits for a person
- **WHEN** a `202` trigger delivery's turn has no settled execution and its newest `done` has `stopReason` `paused`, or its execution settled `continued`
- **THEN** it SHALL get `data.outcome` `waiting`

#### Scenario: Run stopped
- **WHEN** a `202` trigger delivery's turn has an execution settled `stopped` or `not_running`
- **THEN** it SHALL get `data.outcome` `cancelled`

#### Scenario: Start-time failures
- **WHEN** a trigger delivery has status `400`, `403`, `422` or `500`
- **THEN** it SHALL get `data.outcome` `failed`, `failed`, `skipped` or `failed`, with `data.reason_code` `bad_configuration`, `paused_` followed by `data.error_details.code`, `agent_needs_setup` or `start_failed`

#### Scenario: Not settled
- **WHEN** a trigger delivery has status `102`, `409` or `200`, or its run is still going
- **THEN** the system SHALL NOT write `data.outcome`

### Requirement: Runner fallback records a failure
When a run fails before the agent loop, the runner's fallback `done` SHALL carry `stopReason`
`error`, so the ingest route settles the execution `failed`. A Stop SHALL keep `stopReason`
`cancelled`.

#### Scenario: Acquire failure
- **WHEN** a run's sandbox acquire fails and no Stop was asked for
- **THEN** the runner SHALL write an `error` record and a `done` with `stopReason` `error`

#### Scenario: Stop before the turn
- **WHEN** a Stop aborts a run before its turn starts
- **THEN** the runner SHALL write a `done` with `stopReason` `cancelled`

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

### Requirement: One bounded pass at a time
The pass SHALL run behind the admin route `POST /admin/triggers/deliveries/settle`, which cron calls
every minute, whether email is on or off. It SHALL hold a guard lock with a 600-second TTL, and a
request that finds the lock held SHALL return at once. It SHALL read start-time trigger deliveries
oldest first and `202` trigger deliveries newest first, with keyset paging, through a partial index
that leaves out settled rows. It SHALL check a 30-second settle deadline between pages and between
automations, and SHALL leave rows not reached for the next pass.

#### Scenario: Two requests at once
- **WHEN** cron calls the route while the previous request still holds the lock
- **THEN** the second request SHALL return at once and settle nothing

#### Scenario: Pages move forward
- **WHEN** 1,200 `202` trigger deliveries of the last 24 hours are still running
- **THEN** one pass SHALL read three different pages of them, not the same page three times

#### Scenario: Runs lost in an incident
- **WHEN** many older `202` trigger deliveries are still running, and a new run ends with an error
- **THEN** the pass SHALL read the new run first and settle it `failed`

#### Scenario: Deadline reached
- **WHEN** the 30-second deadline is reached in the middle of a page
- **THEN** the pass SHALL stop settling, leave the remaining automations' rows unsettled, and go on to the send step

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
