# Notifications

## Purpose

A small, generic base that records what happened and delivers it to people on a channel. v1 has one
kind (`automation_failing`) and one channel (`email`). A new kind or channel adds code, not tables.

## ADDED Requirements

### Requirement: Notification storage
The system SHALL store notifications in `notifications` (`project_id`, `id`, `kind`, `dedup_key`,
`state` `open` or `resolved`, `data`, `resolved_at`, and the six lifecycle columns) and notification
deliveries in `notification_deliveries` (`project_id`, `id`, `notification_id`, `user_id`,
`channel`, `state` `created`, `sent`, `failed` or `skipped`, `attempt_count`, `sent_at`, and the six
lifecycle columns). Both SHALL have the primary key `(project_id, id)` and one foreign key,
`project_id` to `projects.id` with `ON DELETE CASCADE`. They SHALL be created in the shared
`core_oss` chain. They SHALL NOT store an email address.

#### Scenario: Project deleted
- **WHEN** a project is deleted
- **THEN** its notifications and notification deliveries SHALL be deleted with it

#### Scenario: One notification delivery per recipient and channel
- **WHEN** a notification is opened for two recipients
- **THEN** it SHALL have exactly two `email` notification deliveries, and a second insert for the same recipient and channel SHALL fail

### Requirement: Notification kinds
Each kind SHALL declare its template and the permission a recipient needs, and SHALL be registered
with the notifications service at startup by the domain that owns it. The template SHALL render from
the notification's `data` and the recipient's email only. The notifications code SHALL NOT import or
read the domain that opened the notification.

#### Scenario: Automation deleted after the open
- **WHEN** an automation's notification is open and its email is not sent yet, and the automation is soft-deleted by a person
- **THEN** the delete SHALL resolve the notification, and the send pass SHALL skip its notification deliveries without reading the automation

### Requirement: Email switch
The system SHALL read `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` (default `true`) as
`env.agenta.notifications.email_enabled` on each send pass. When it is `false`, or when neither SMTP
nor SendGrid is set up, the send pass SHALL mark `created` email notification deliveries `skipped`.
Notifications SHALL still be recorded.

#### Scenario: Switch off
- **WHEN** `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` is `false` and an automation fails
- **THEN** a notification SHALL be opened, its email notification delivery SHALL become `skipped`, and no email SHALL be sent

#### Scenario: Switch turned off with emails not sent
- **WHEN** notification deliveries are `created`, and the switch is turned off
- **THEN** the next send pass SHALL mark them `skipped`

#### Scenario: No email provider
- **WHEN** the switch is on, and SMTP and SendGrid are both not set up
- **THEN** email notification deliveries SHALL become `skipped`

### Requirement: Send pass
The system SHALL send `created` email notification deliveries in a pass behind the admin route
`POST /admin/notifications/send`, which cron calls every minute. The pass SHALL hold a guard lock
that it renews with its owner token after each send, SHALL stop when renewal fails or after 45
seconds of work, and SHALL send at most 100 per pass and at most 10 per project per pass, oldest
first. Before it sends, it SHALL mark a notification delivery
`skipped` if its notification is resolved, `AccessService.check_human` no longer allows the kind's
permission for the recipient, or the recipient has no email (deleted user). A success SHALL set `sent` and `sent_at`. A failure SHALL add 1 to
`attempt_count`, and at 5 SHALL set `failed`. Logs SHALL carry ids and the exception type only.
A send SHALL NOT run in a user's request.

#### Scenario: Provider down for three minutes
- **WHEN** the email provider fails for three minutes and then works
- **THEN** the notification delivery SHALL be tried on each pass and SHALL end as `sent`

#### Scenario: Provider always fails
- **WHEN** every send of a notification delivery fails
- **THEN** after 5 attempts it SHALL be `failed`, and the error log SHALL contain no email address

#### Scenario: Provider hangs
- **WHEN** the provider does not answer
- **THEN** the client timeout of 15 seconds SHALL end the call, and the pass SHALL count a failed attempt

#### Scenario: Provider hangs for a long time
- **WHEN** every send waits for its timeout, and cron calls the route again while a pass is still running
- **THEN** the second request SHALL find the guard held and return at once, and no notification delivery SHALL be sent twice

#### Scenario: Rendering fails
- **WHEN** rendering a notification delivery raises an error
- **THEN** it SHALL count as a failed attempt, and after 5 the notification delivery SHALL be `failed`

#### Scenario: Recipient removed before the send
- **WHEN** a recipient is removed from the project while the notification delivery is not sent yet
- **THEN** the send pass SHALL mark it `skipped`

#### Scenario: One large project
- **WHEN** one project has 2,000 unsent notification deliveries and another project has 1
- **THEN** the next send pass SHALL send the other project's email, and at most 10 of the large project's

#### Scenario: Platform outage
- **WHEN** 300 automations fail at the same time
- **THEN** the send pass SHALL send at most 100 emails per pass, and the rest on the next passes

### Requirement: Email sender
`emailing.py` SHALL provide `send_rendered_email(to_email, subject, html, text)`. It SHALL send a
plain-text part and an HTML part through SMTP if it is set up, else SendGrid, with a 15-second client
timeout. It SHALL raise when no provider is set up, when the SendGrid client cannot be built, and
when the provider fails. It SHALL NOT log the recipient's address. The invitation emails SHALL keep their content and their behavior.

#### Scenario: Plain-text part
- **WHEN** a notification email is sent through SMTP or SendGrid
- **THEN** the message SHALL contain a plain-text part and an HTML part

#### Scenario: SendGrid client cannot be built
- **WHEN** SendGrid is set up but its client fails to build
- **THEN** `send_rendered_email` SHALL raise, and the notification delivery SHALL NOT be marked `sent`

#### Scenario: Invitation unchanged
- **WHEN** an organization invitation is sent and no provider is set up
- **THEN** `send_email` SHALL return `True` without sending, as today
