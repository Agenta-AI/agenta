# Automation failure notifications

## Purpose

Tell the right people, once, when an automation starts failing, and stay quiet until it is fixed.

## ADDED Requirements

### Requirement: What opens a notification
The system SHALL open an `automation_failing` notification with `dedup_key`
`automation:<automation_id>` when a trigger delivery of a not-deleted automation is settled as
`failed` or `skipped`, no notification for that key is open, and the failure ended less than 1
hour before the pass. It SHALL NOT open one for `completed`, `cancelled` or `needed_approval`, or for a
trigger delivery that is not settled.

#### Scenario: First failed run
- **WHEN** an automation with no open notification has a trigger delivery settled as `failed`
- **THEN** the system SHALL open one notification, with its `reason_code` and its `created_at` as `first_failure_started_at` and `last_failure_started_at`

#### Scenario: Platform pauses the automation
- **WHEN** the dispatcher writes a `403` trigger delivery with `error_details.code` `agent_deleted` and pauses the automation
- **THEN** the system SHALL open one notification with `reason_code` `paused_agent_deleted`

#### Scenario: Run waits for a person
- **WHEN** a trigger delivery is settled as `needed_approval`
- **THEN** the system SHALL NOT open a notification

#### Scenario: Subscription revoked
- **WHEN** a subscription that a person revoked writes a `409` trigger delivery for an event already in flight
- **THEN** the system SHALL NOT open a notification

#### Scenario: Deleted automation
- **WHEN** a trigger delivery is settled as `failed`, and its automation is deleted or no longer exists
- **THEN** the system SHALL NOT open a notification

#### Scenario: First pass after the deploy
- **WHEN** the feature is deployed, and an automation failed 6 hours earlier
- **THEN** the pass SHALL settle that trigger delivery and SHALL NOT open a notification

### Requirement: One open notification per automation
The database SHALL allow at most one `open` notification per `(project_id, dedup_key)`. While one is
open, each new failure SHALL update `data.last_failure_started_at` to the newest start, and SHALL send
nothing.

#### Scenario: Ten failed runs in a row
- **WHEN** ten runs of one automation fail one after another
- **THEN** exactly one notification SHALL be open, and one email SHALL be sent per recipient

#### Scenario: Concurrent opens
- **WHEN** two requests try to open a notification for the same automation at the same time
- **THEN** exactly one SHALL insert a row, and only that one SHALL insert notification deliveries

#### Scenario: Three automations fail for one cause
- **WHEN** three automations fail because of the same expired model sign-in
- **THEN** the system SHALL open three notifications, one per automation

### Requirement: What resolves a notification
The system SHALL resolve the open notification of an automation when a trigger delivery of the
automation that started at or after `data.last_failure_started_at` is settled as `completed` or `needed_approval`,
and after a person's successful start or delete of the automation, or an edit after which the
automation is active. It SHALL NOT
resolve it on a stop, a refresh, a revoke, a schedule stopped at its end time, or a pause by the dispatcher.
No email SHALL be sent about the fix. After a resolve, the next failure SHALL open a new
notification, also when its run started before the fix.

#### Scenario: Success after failure
- **WHEN** an automation has an open notification and its next run is settled as `completed`
- **THEN** the notification SHALL be resolved and no email SHALL be sent

#### Scenario: Runs that wait for approval
- **WHEN** a `422` opened a notification, a person sets up the model, and the next run ends by asking for an approval
- **THEN** the notification SHALL be resolved

#### Scenario: Older run succeeds after a newer failure
- **WHEN** a long run starts at 10:00, a `403` at 10:10 opens or updates the notification, and the long run then completes
- **THEN** the notification SHALL stay open

#### Scenario: Re-claimed start succeeds
- **WHEN** a `500` opened a notification, and a repeated event claims the same trigger delivery again and its run completes
- **THEN** the notification SHALL be resolved

#### Scenario: Failure and newer success in one page
- **WHEN** run D of an automation starts at 10:00 and fails, run S of the same automation starts at 10:05 and completes, and both are in the same page
- **THEN** D SHALL open the notification, S SHALL resolve it, and no email SHALL be sent

#### Scenario: Fail, fix, fail
- **WHEN** an automation fails, then a person edits it, then it fails again
- **THEN** the system SHALL send two emails in total

#### Scenario: Known limit with a run in flight during the fix
- **WHEN** an automation has an open notification, a person edits it, and a run that started before the edit fails after the edit
- **THEN** the system SHALL open a new notification and send one email

#### Scenario: Edit before the email is sent
- **WHEN** a notification opens, and a person edits or deletes the automation before the send step
- **THEN** the send step SHALL skip its notification deliveries

#### Scenario: Rename of a paused automation
- **WHEN** a `403` paused an automation and opened a notification, and a person renames it without turning it on
- **THEN** the notification SHALL stay open

#### Scenario: Agent archived
- **WHEN** a person archives an agent, which pauses an automation bound to it directly, and another automation bound through an environment fires next and writes `403 agent_deleted`
- **THEN** no email SHALL be sent for the first automation, and one email SHALL be sent for the second

#### Scenario: Person stops the automation
- **WHEN** an automation with an open notification is stopped by a person, or reaches its end time
- **THEN** the notification SHALL stay open

#### Scenario: Resolve fails
- **WHEN** a person edits an automation, and resolving its notification raises an error
- **THEN** the edit SHALL succeed and the error SHALL be logged with ids only

### Requirement: Recipients
When a notification opens, the system SHALL choose recipients in this order, and the first step that
gives at least one user SHALL win: (1) the automation's creator; (2) the project members with role
`owner` or `admin` from `MembershipsService.query_project_members`; (3) the organization owner.
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

#### Scenario: No recipient
- **WHEN** no step gives a user
- **THEN** the notification SHALL open with no notification delivery, and a warning with ids only SHALL be logged

### Requirement: Email content
The email SHALL have the subject `Automation "<name>" in <project> is failing`. It SHALL give the
automation name, the project name, the time of the first failure in UTC, a plain reason and action
from the reason catalog, an "Open automation" link to
`<AGENTA_WEB_URL>/m/w/<organization_id>/p/<project_id>/automations/<automation_id>`, and the line
"You will not get another email about this until it is fixed." It SHALL have a plain-text part and
an HTML part with every value escaped. It SHALL give the run's own error message as the reason, with technical prefixes removed, on one line, cut to 300 characters; a message with nothing readable SHALL give way to the reason catalog. It SHALL NOT contain an agent field. The automation name MAY hold the agent's name.
In the automation and project names, every character in the Unicode categories Cc, Cf, Zl and Zp
SHALL become a space, and each name SHALL be cut to 80 characters.

#### Scenario: Run with an error message
- **WHEN** a run fails with the record message `Internal agent error: Internal error: There's an issue with the selected model (x).`
- **THEN** the email SHALL say "There's an issue with the selected model (x)."

#### Scenario: Unknown error code with no message
- **WHEN** a run fails with no readable message, and its code is not in the reason catalog
- **THEN** the email SHALL say "The agent's run ended with an error." and "Open the automation to see the run and its error."

#### Scenario: Recipient in several projects
- **WHEN** an admin of two projects gets the email for an automation that someone else created
- **THEN** the subject and the body SHALL name the project

#### Scenario: Name with markup, a line break or a direction override
- **WHEN** an automation is named `<b>Daily</b>`, or its name contains CR, LF, U+202E or U+2028, or it has 300 characters
- **THEN** the HTML part SHALL show the name as text, the subject SHALL have one line with no control or direction characters, and the name SHALL be cut to 80 characters

#### Scenario: Automation without a name
- **WHEN** an automation has no name
- **THEN** the email SHALL call it "Untitled automation"
