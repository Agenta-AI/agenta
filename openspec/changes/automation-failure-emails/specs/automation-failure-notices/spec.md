# Automation failure notices

## Purpose

Tell the right person, once, when an automation starts failing, and stay quiet until it is fixed.

## ADDED Requirements

### Requirement: What opens a notification
The system SHALL open an `automation_failing` notification with key `automation:<automation_id>`
when a delivery of a live automation gets `data.outcome` `failed` or `skipped`. The system SHALL NOT
open one for `succeeded`, `cancelled` or `paused`, for a delivery with status `409`, or for a test
capture.

#### Scenario: First failed run
- **WHEN** an automation with no open notification has a delivery decided as `failed`
- **THEN** the system SHALL open one notification for the automation, with the delivery's `outcome_code` as `reason_code` and its `created_at` as `failed_at`

#### Scenario: Platform pauses the automation
- **WHEN** the dispatcher writes a `403` delivery with code `agent_deleted` and pauses the automation
- **THEN** the system SHALL open one notification with `reason_code` `agent_deleted`

#### Scenario: Model needs setup
- **WHEN** a schedule writes a `422 skipped` delivery on each fire because its agent's model needs setup
- **THEN** the system SHALL open one notification, and later `422` deliveries SHALL open none while it is open

#### Scenario: Run waits for a person
- **WHEN** a delivery is decided as `paused`
- **THEN** the system SHALL NOT open a notification

#### Scenario: Subscription revoked
- **WHEN** a subscription that a person revoked writes a `409` delivery for an event already in flight
- **THEN** the system SHALL NOT open a notification

#### Scenario: Deleted automation
- **WHEN** a delivery is decided as `failed`, and its automation was deleted
- **THEN** the system SHALL NOT open a notification

### Requirement: One open notification per automation
The database SHALL allow at most one `open` notification per `(project_id, dedup_key)`. While one
is open, more failures of the automation SHALL send nothing.

#### Scenario: Ten failed runs in a row
- **WHEN** ten runs of one automation fail one after another
- **THEN** exactly one notification SHALL be open, and one email SHALL be sent per recipient

#### Scenario: Concurrent opens
- **WHEN** two transactions try to open a notification for the same automation at the same time
- **THEN** exactly one SHALL insert a row, and only that one SHALL insert delivery rows

#### Scenario: Three automations fail for one cause
- **WHEN** three automations fail because of the same expired model sign-in
- **THEN** the system SHALL open three notifications, one per automation

### Requirement: What closes a notification
The system SHALL close the open notification of an automation when one of its deliveries is decided
as `succeeded`, or after a successful edit, start, stop, refresh or delete of the automation by a
person. The system SHALL NOT close it on a revoke, on a schedule stopped by its end time, or on a
pause by the dispatcher. Closing SHALL set `status` `resolved` and `resolved_at`, and SHALL set its
`pending` deliveries to `skipped`.

#### Scenario: Success after failure
- **WHEN** an automation has an open notification and its next run is decided as `succeeded`
- **THEN** the notification SHALL be resolved and no email SHALL be sent about the fix

#### Scenario: Fail, fix, fail
- **WHEN** an automation fails, then a person edits it, then it fails again
- **THEN** the system SHALL send two emails in total

#### Scenario: Edit before the email is sent
- **WHEN** a notification opens, and a person edits the automation before the send pass runs
- **THEN** its deliveries SHALL be `skipped` and no email SHALL be sent

#### Scenario: Schedule reaches its end time
- **WHEN** an automation with an open notification is stopped by `refresh_schedules` because its end time passed
- **THEN** the notification SHALL stay open

#### Scenario: Close fails
- **WHEN** a person edits an automation, and closing its notification raises an error
- **THEN** the edit SHALL succeed and the error SHALL be logged

### Requirement: Failures older than the last fix
The system SHALL NOT open a notification for a failed delivery whose `created_at` is earlier than
the `resolved_at` of a resolved notification with the same key.

#### Scenario: Run started before the edit
- **WHEN** an automation has an open notification, a person edits it, and a run that started before the edit is decided as `failed` after the edit
- **THEN** the system SHALL NOT open a new notification

#### Scenario: Known limit with nothing open
- **WHEN** an automation has no open notification, a person edits it, and a run that started before the edit is decided as `failed` after the edit
- **THEN** the system SHALL open a notification

### Requirement: Recipients
When a notification opens, the system SHALL choose its recipients in this order, and the first step
that gives at least one user SHALL win: (1) the automation's creator, if `MembershipsService.is_member`
is true for the project and the user is not deleted; (2) the project members with role `owner` or
`admin` from `MembershipsService.query_project_members`, without deleted users; (3) the
organization owner, if not deleted. The system SHALL NOT read `project_members` directly. It SHALL
insert one `email` delivery per recipient.

#### Scenario: Creator is a member
- **WHEN** an automation's creator is still a member of the project
- **THEN** the creator SHALL be the only recipient

#### Scenario: Creator left
- **WHEN** an automation's creator is no longer a member of the project, and the project has one owner and two admins
- **THEN** the three of them SHALL be the recipients

#### Scenario: OSS project
- **WHEN** the edition is OSS and the creator left the organization
- **THEN** the recipients SHALL be the organization's owners and admins

#### Scenario: No recipient
- **WHEN** no step gives a user
- **THEN** the notification SHALL open with no delivery, and a warning SHALL be logged

### Requirement: Email content
The email SHALL have the subject `Your automation "<name>" is failing`, and SHALL give the
automation name, the agent name when it can be read, the time of the first failure in UTC, a plain
reason and action from the reason catalog, an "Open automation" link to
`<AGENTA_WEB_URL>/m/w/<organization_id>/p/<project_id>/automations/<automation_id>`, and the line
"You will not get another email about this until it is fixed." It SHALL have an HTML part with
every value escaped and a plain-text part. It SHALL NOT contain the raw error text.

#### Scenario: Unknown error code
- **WHEN** a run fails with a code that is not in the reason catalog
- **THEN** the email SHALL say "The agent's run ended with an error." and "Open the automation to see the run and its error."

#### Scenario: Name with markup
- **WHEN** an automation is named `<b>Daily</b>`
- **THEN** the HTML part SHALL show the name as text, not as markup

#### Scenario: Automation without a name
- **WHEN** an automation has no name
- **THEN** the email SHALL call it "Untitled automation"
