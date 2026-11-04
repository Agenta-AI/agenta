# Notifications

## Purpose

A small, generic base that records what happened and delivers it to people on a channel. v1 has
one kind (`automation_failing`) and one channel (`email`). A new kind or channel adds code, not
tables.

## ADDED Requirements

### Requirement: Notification storage
The system SHALL store notifications in a `notifications` table with `id`, `project_id`, `kind`,
`dedup_key`, `status` (`open` or `resolved`), `data`, `resolved_at` and the six lifecycle columns,
and SHALL store deliveries in a `notification_deliveries` table with `id`, `project_id`,
`notification_id`, `user_id`, `channel`, `status` (`pending`, `sent`, `failed` or `skipped`),
`attempts`, `sent_at` and the six lifecycle columns. Each table SHALL have one foreign key,
`project_id` to `projects.id` with `ON DELETE CASCADE`. The schema SHALL be created in the shared
`core_oss` chain, so OSS and EE get the same tables.

#### Scenario: Project deleted
- **WHEN** a project is deleted
- **THEN** its notifications and deliveries SHALL be deleted with it

#### Scenario: One delivery per recipient and channel
- **WHEN** a notification is opened for two recipients
- **THEN** it SHALL have exactly two `email` deliveries, and a second insert for the same recipient and channel SHALL fail

### Requirement: Email switch
The system SHALL read `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` (default `true`) through
`env.agenta.notifications.email_enabled`. When it is `false`, or when neither SMTP nor SendGrid is
set up, new email deliveries SHALL be created with status `skipped`, and notifications SHALL still
be recorded.

#### Scenario: Switch off
- **WHEN** `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` is `false` and an automation fails
- **THEN** a notification SHALL be opened, its email delivery SHALL be `skipped`, and no email SHALL be sent

#### Scenario: No email provider
- **WHEN** the switch is on, and SMTP and SendGrid are both not set up
- **THEN** email deliveries SHALL be `skipped`

### Requirement: Send pass
The system SHALL send `pending` email deliveries in a pass that runs every 60 seconds in the API, on
at most one replica at a time under a Redis lease, and sends at most 100 per pass, oldest first.
Before it sends, it SHALL mark the delivery `skipped` if its notification is resolved, its user is
deleted, or (for `automation_failing`) its automation is deleted. Each send SHALL time out after
30 seconds. A success SHALL set `sent` and `sent_at`. A failure SHALL add 1 to `attempts`, and at
5 attempts SHALL set `failed` and log an error. A send SHALL NOT run in a web request.

#### Scenario: Provider down for three minutes
- **WHEN** the email provider fails for three minutes and then works
- **THEN** the delivery SHALL be retried on each pass and SHALL end as `sent`

#### Scenario: Provider always fails
- **WHEN** every send of a delivery fails
- **THEN** after 5 attempts the delivery SHALL be `failed` and an error SHALL be logged

#### Scenario: Provider hangs
- **WHEN** a send does not return within 30 seconds
- **THEN** the pass SHALL count it as a failed attempt and continue with the next delivery

#### Scenario: Platform outage
- **WHEN** 300 automations fail at the same time
- **THEN** the send pass SHALL send at most 100 emails per pass

### Requirement: Email sender
`emailing.py` SHALL provide a function that sends a given subject, HTML body and plain-text body
through SMTP if it is set up, else SendGrid, and SHALL raise when neither is set up or the provider
fails. The existing invitation emails SHALL keep their content and their behavior when no provider
is set up.

#### Scenario: Plain-text part
- **WHEN** a notification email is sent through SMTP or SendGrid
- **THEN** the message SHALL contain a plain-text part and an HTML part

#### Scenario: Invitation unchanged
- **WHEN** an organization invitation is sent and no provider is set up
- **THEN** `send_email` SHALL return `True` without sending, as today
