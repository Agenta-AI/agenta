# Automation failure notifications

## Purpose

Tell the right people, once, when an automation starts failing, and stay quiet until it is fixed.

## ADDED Requirements

### Requirement: What opens a notification
The system SHALL open an `automation_failing` notification with `dedup_key`
`automation:<automation_id>` when a trigger delivery of a not-deleted automation is settled as
`failed` or `skipped` and ended less than 1 hour before the pass. The system SHALL NOT open one for
`completed`, `cancelled` or `waiting`, or for a trigger delivery that is not settled (`102`, `409`,
`200`).

#### Scenario: First failed run
- **WHEN** an automation with no open notification has a trigger delivery settled as `failed`
- **THEN** the system SHALL open one notification, with the trigger delivery's `reason_code`, and its `created_at` as `failed_at` and `last_failed_at`

#### Scenario: Platform pauses the automation
- **WHEN** the dispatcher writes a `403` trigger delivery with `error_details.code` `agent_deleted` and pauses the automation
- **THEN** the system SHALL open one notification with `reason_code` `paused_agent_deleted`

#### Scenario: Model needs setup
- **WHEN** a schedule writes a `422 skipped` trigger delivery on each fire
- **THEN** the system SHALL open one notification, and later `422` trigger deliveries SHALL open none while it is open

#### Scenario: Run waits for a person
- **WHEN** a trigger delivery is settled as `waiting`
- **THEN** the system SHALL NOT open a notification

#### Scenario: Subscription revoked
- **WHEN** a subscription that a person revoked writes a `409` trigger delivery for an event already in flight
- **THEN** the system SHALL NOT open a notification

#### Scenario: Deleted automation
- **WHEN** a trigger delivery is settled as `failed`, and its automation is deleted or no longer exists
- **THEN** the system SHALL NOT open a notification

#### Scenario: Email off when the failure happened
- **WHEN** an automation failed while email was off, and email is turned on while it still fails
- **THEN** no email SHALL be sent until the automation is fixed and fails again

#### Scenario: Success settles late
- **WHEN** a notification is open, and the outcome pass was down for 2 hours while the next run completed
- **THEN** the first pass after the outage SHALL resolve the notification

#### Scenario: First pass after the deploy
- **WHEN** the feature is deployed, and an automation failed 6 hours earlier and was edited since
- **THEN** the pass SHALL settle that trigger delivery and SHALL NOT open a notification

### Requirement: One open notification per automation
The database SHALL allow at most one `open` notification per `(project_id, dedup_key)`. While one is
open, more failures of the automation SHALL send nothing.

#### Scenario: Ten failed runs in a row
- **WHEN** ten runs of one automation fail one after another
- **THEN** exactly one notification SHALL be open, and one email SHALL be sent per recipient

#### Scenario: Concurrent opens
- **WHEN** two transactions try to open a notification for the same automation at the same time
- **THEN** exactly one SHALL insert a row, and only that one SHALL insert notification deliveries

#### Scenario: Three automations fail for one cause
- **WHEN** three automations fail because of the same expired model sign-in
- **THEN** the system SHALL open three notifications, one per automation

### Requirement: What resolves a notification
While a notification is open, each new failed or skipped trigger delivery of the automation SHALL
set `data.last_failed_at` to the later of its value and the trigger delivery's `created_at`. The
system SHALL resolve the open notification when a trigger delivery of the automation that started
at or after `data.last_failed_at` is settled as `completed` or `waiting`, and after a person's successful edit, start, refresh or
delete of the automation. `resolved_at` SHALL be the time of the resolve. It
SHALL NOT resolve it on a stop, a revoke, a schedule stopped at its end time, or a pause by the
dispatcher. No email SHALL be sent about the fix.

#### Scenario: Success after failure
- **WHEN** an automation has an open notification and its next run is settled as `completed`
- **THEN** the notification SHALL be resolved and no email SHALL be sent

#### Scenario: Older run succeeds after a newer failure
- **WHEN** a long run starts, a `422` opens a notification, and then the long run is settled as `completed`
- **THEN** the notification SHALL stay open

#### Scenario: Fail, fix, fail
- **WHEN** an automation fails, then a person edits it, then it fails again
- **THEN** the system SHALL send two emails in total

#### Scenario: Edit before the email is sent
- **WHEN** a notification opens, and a person edits the automation before the send pass runs
- **THEN** the send pass SHALL skip its notification deliveries and send no email

#### Scenario: Newer failure while open
- **WHEN** a `500` opens a notification at 10:00, a long run starts at 10:05, a `403` at 10:10 pauses the automation, and the long run then completes
- **THEN** the notification SHALL stay open

#### Scenario: Runs that wait for approval
- **WHEN** a `422` opened a notification, a person sets up the model, and the next run ends waiting for an approval
- **THEN** the notification SHALL be resolved

#### Scenario: Re-claimed start succeeds
- **WHEN** a `500` opened a notification, and a repeated event claims the same trigger delivery again and its run completes
- **THEN** the notification SHALL be resolved

#### Scenario: Connection deleted
- **WHEN** a subscription has an open notification, and a person deletes its connection, which deletes the subscription
- **THEN** the notification SHALL stay open as a row, and no more email SHALL be sent for it, because the subscription writes no more trigger deliveries

#### Scenario: Run cancelled by a person
- **WHEN** an automation has an open notification, and its next run is cancelled by a person
- **THEN** the notification SHALL stay open, and no new notification SHALL open

#### Scenario: Subscription refreshed
- **WHEN** a subscription has an open notification, and a person refreshes it
- **THEN** the notification SHALL be resolved

#### Scenario: Person stops the automation
- **WHEN** an automation with an open notification is stopped by a person
- **THEN** the notification SHALL stay open

#### Scenario: Resolve fails
- **WHEN** a person edits an automation, and resolving its notification raises an error
- **THEN** the edit SHALL succeed and the error SHALL be logged with ids only

### Requirement: Failures across a fix
After a notification is resolved, the next failed or skipped trigger delivery of the automation SHALL
open a new notification, also when its run started before the fix (the owner cut that check on
2026-11-05).

#### Scenario: Failure that started after a success
- **WHEN** run S starts at 10:00 and succeeds, run F starts at 10:05 and fails, S settles at 10:07 and resolves an open notification, and F settles at 10:12
- **THEN** the system SHALL open a new notification for F

#### Scenario: Known limit with overlapping runs
- **WHEN** run D starts at 10:00, run S starts at 10:05 and is settled `completed` with nothing open, and then D fails and is settled `failed`
- **THEN** the system SHALL open a notification, and the next healthy run that starts after 10:00 SHALL resolve it

#### Scenario: Failure and newer success settled in the same pass
- **WHEN** run D starts at 10:00 and fails, run S starts at 10:05 and completes, and both settle in the same pass
- **THEN** D SHALL open the notification and S SHALL resolve it in that pass, and the send step SHALL skip its email

#### Scenario: Known limit with a run in flight during the fix
- **WHEN** an automation has an open notification, a person edits it, and a run that started before the edit is settled as `failed` after the edit
- **THEN** the system SHALL open a new notification and send one email

### Requirement: Outage brake
When the failures settled in one outcome pass with a platform reason (`start_failed`,
`execution_lost`, `sandbox_gone`) come from more than 10 projects, the system SHALL set an outage
flag for 15 minutes and log one error. While the flag is set, a failure with a platform reason SHALL
settle but SHALL NOT open a notification. Failures with other reasons SHALL open as usual.

#### Scenario: Runner outage
- **WHEN** the runner is down, and failed starts from 40 projects settle in one pass
- **THEN** no notification SHALL open for them, and one error SHALL be logged

#### Scenario: Still failing after the outage
- **WHEN** the outage flag expired, and an automation's next start fails again with `start_failed`
- **THEN** the system SHALL open one notification for it

#### Scenario: Other reasons during an outage
- **WHEN** the outage flag is set, and an automation fails with `paused_agent_deleted`
- **THEN** the system SHALL open a notification for it

### Requirement: Recipients
When a notification opens, the system SHALL choose recipients in this order, and the first step
that gives at least one user SHALL win: (1) the automation's creator; (2) the project members with
role `owner` or `admin` from `MembershipsService.query_project_members`; (3) the organization owner.
Every recipient SHALL pass `AccessService.check_human` for `view_triggers` in the project. The
system SHALL NOT read `project_members` directly, and SHALL insert one `email` notification delivery
per recipient.

#### Scenario: Creator is a member
- **WHEN** an automation's creator can view automations in the project
- **THEN** the creator SHALL be the only recipient

#### Scenario: Creator left
- **WHEN** the creator is no longer a member, and the project has one owner and two admins
- **THEN** the three of them SHALL be the recipients

#### Scenario: Creator lost the permission
- **WHEN** the creator's custom role no longer has `view_triggers`
- **THEN** the creator SHALL NOT be a recipient, and step 2 SHALL apply

#### Scenario: OSS project
- **WHEN** the edition is OSS and the creator left the organization
- **THEN** the recipients SHALL be the organization's owners and admins

#### Scenario: No recipient
- **WHEN** no step gives a user
- **THEN** the notification SHALL open with no notification delivery, and a warning with ids only SHALL be logged

### Requirement: Email content
The email SHALL have the subject `Automation "<name>" in <project> is failing`. It SHALL give the
automation name, the project name, the time of the first failure in UTC, a plain reason and action from the reason catalog, an
"Open automation" link to
`<AGENTA_WEB_URL>/m/w/<organization_id>/p/<project_id>/automations/<automation_id>`, and the line
"You will not get another email about this until it is fixed." It SHALL have a plain-text part and
an HTML part with every value escaped. It SHALL NOT contain the raw error text or the agent's name.

#### Scenario: Recipient in several projects
- **WHEN** an admin of two projects gets the email for an automation that someone else created
- **THEN** the subject and the body SHALL name the project

#### Scenario: Unknown error code
- **WHEN** a run fails with a code that is not in the reason catalog
- **THEN** the email SHALL say "The agent's run ended with an error." and "Open the automation to see the run and its error."

#### Scenario: Run fails with access denied
- **WHEN** a `202` run fails with the runner code `access_denied`
- **THEN** the email SHALL use the "any other code" text, not the text of a paused automation

#### Scenario: Name with markup
- **WHEN** an automation is named `<b>Daily</b>`
- **THEN** the HTML part SHALL show the name as text, not as markup

#### Scenario: Name with a line break
- **WHEN** an automation name contains a carriage return and a line feed
- **THEN** the subject SHALL have them replaced by one space, and the email SHALL be sent

#### Scenario: Name with a direction override
- **WHEN** an automation name contains U+202E or U+2028
- **THEN** each SHALL be replaced by a space in the subject and the body

#### Scenario: Very long name
- **WHEN** an automation name has 300 characters
- **THEN** the email SHALL use its first 80 characters

#### Scenario: Automation without a name
- **WHEN** an automation has no name
- **THEN** the email SHALL call it "Untitled automation"
