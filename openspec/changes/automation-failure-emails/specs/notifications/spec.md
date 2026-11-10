# Notifications

## Purpose

A small, generic base that records what happened and delivers it to people on a channel. v1 has one
kind (`automation_failing`) and one channel (`email`). A new kind or channel adds code, not tables.

## ADDED Requirements

### Requirement: Notification storage
The system SHALL store notifications in `notifications` (`project_id`, `id`, `kind`, `dedup_key`,
`state` `open` or `resolved`, `data`, and the six lifecycle columns) and notification deliveries in
`notification_deliveries` (`project_id`, `id`, `notification_id`, `user_id`, `channel`, `state`
`created`, `sent`, `failed` or `skipped`, `attempt_count`, `sent_at`, and the six lifecycle columns).
Both SHALL have the primary key `(project_id, id)` and one foreign key, `project_id` to
`projects.id` with `ON DELETE CASCADE`. They SHALL be created in the shared `core_oss` chain. They
SHALL NOT store an email address.

#### Scenario: Project deleted
- **WHEN** a project is deleted
- **THEN** its notifications and notification deliveries SHALL be deleted with it

#### Scenario: One notification delivery per recipient and channel
- **WHEN** a notification is opened for two recipients
- **THEN** it SHALL have exactly two `email` notification deliveries, and a second insert for the same recipient and channel SHALL fail

### Requirement: Template of a kind
The domain that opens a kind of notification SHALL pass its template to the notifications service as
a constructor argument, in the composition root, and SHALL check recipients' permissions itself
when it opens a notification. The template SHALL render from the notification's `data`, the
recipient's email and `env.agenta.web_url` only. The notifications code SHALL NOT import or read the
domain that opened the notification.

#### Scenario: Automation deleted after the open
- **WHEN** an automation's notification is open and its email is not sent yet, and a person deletes the automation
- **THEN** the delete SHALL resolve the notification, and the send step SHALL skip its notification deliveries without reading the automation

### Requirement: Email switch
The system SHALL read `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` (default `true`) as
`env.agenta.notifications.email_enabled` on each send step. When it is `false`, or when neither SMTP
nor SendGrid is set up, the send step SHALL mark `created` email notification deliveries `skipped`.
Notifications SHALL still be recorded.

#### Scenario: Switch off
- **WHEN** `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` is `false` and an automation fails
- **THEN** a notification SHALL be opened, its email notification delivery SHALL become `skipped`, and no email SHALL be sent

#### Scenario: Switch turned on again
- **WHEN** a notification opened while email was off, and email is turned on while the automation still fails
- **THEN** no email SHALL be sent until the automation is fixed and fails again

#### Scenario: No email provider
- **WHEN** the switch is on, and SMTP and SendGrid are both not set up
- **THEN** email notification deliveries SHALL become `skipped`

### Requirement: Send step
The system SHALL send `created` email notification deliveries in the same request as the settle
pass, after settling, under the same guard lock, at most 100 per request, oldest first. A provider-wide
error SHALL stop the send loop for that request (a rejected recipient SHALL NOT), and no new send SHALL start 5 minutes after the
request began. Before it sends, it SHALL mark a delivery `skipped`
if its notification is resolved or the recipient has no email. A success SHALL set `sent` and
`sent_at`. A failure, or an error before the send, SHALL add 1 to `attempt_count`, and at 5 SHALL set
`failed`. Logs SHALL carry ids and the exception type only.

#### Scenario: Provider down for three minutes
- **WHEN** the email provider fails for three minutes and then works
- **THEN** the notification delivery SHALL be tried on each request and SHALL end as `sent`

#### Scenario: Slow provider
- **WHEN** every send succeeds but takes 60 seconds
- **THEN** the request SHALL start no new send after 5 minutes, end inside the 600-second lock, and leave the rest for the next request

#### Scenario: Provider always fails
- **WHEN** every send of a notification delivery fails
- **THEN** after 5 attempts it SHALL be `failed`, and the error log SHALL contain no email address

#### Scenario: Provider hangs
- **WHEN** a send times out
- **THEN** the request SHALL count one failed attempt, stop sending, and leave the other deliveries for the next request, and no notification delivery SHALL be sent twice

#### Scenario: Provider rejects one recipient
- **WHEN** the provider rejects one recipient's address
- **THEN** the request SHALL count one failed attempt for that delivery and go on to the next one


### Requirement: Email sender
`emailing.py` SHALL provide `send_rendered_email(to_email, subject, html, text)`. It SHALL send a
plain-text part and an HTML part through SMTP if it is set up, else SendGrid, with a timeout on each
socket operation: `SMTP_TIMEOUT`, else 15 seconds, for SMTP; 15 seconds for SendGrid. It SHALL raise when no provider is set up, when the SendGrid client
cannot be built, and when the provider fails. It SHALL NOT log the recipient's address. The
invitation emails SHALL keep their content and their behavior.

#### Scenario: Plain-text part
- **WHEN** a notification email is sent through SMTP or SendGrid
- **THEN** the message SHALL contain a plain-text part and an HTML part

#### Scenario: SendGrid client cannot be built
- **WHEN** SendGrid is set up but its client fails to build
- **THEN** `send_rendered_email` SHALL raise, and the notification delivery SHALL NOT be marked `sent`

#### Scenario: Invitation unchanged
- **WHEN** an organization invitation is sent and no provider is set up
- **THEN** `send_email` SHALL return `True` without sending, as today
