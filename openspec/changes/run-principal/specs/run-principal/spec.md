# Run principal

## Purpose

Give every request and every run a typed principal, an authority, a provenance and a sender, built at a small fixed set of places.

## ADDED Requirements

### Requirement: Every authenticated request carries its principal
The auth middleware SHALL set `request.state.principal` (CONTRACT.md section 3): `human` for a Bearer session, `api_key` for an ApiKey, the `principal` claim for a Secret. It SHALL set `request.state.credential_kind` (`RequestCredentialKind`: `bearer_session`, `api_key` or `run_credential`). `request.state.user_id` SHALL hold the record's `acting_user_id`.

#### Scenario: API key request
- **WHEN** a request authenticates with an API key
- **THEN** `request.state.principal` SHALL be `api_key` with the key id, and `request.state.user_id` SHALL be the key creator

#### Scenario: Run credential of a human run
- **WHEN** a request authenticates with a Secret whose `principal` claim is `human`
- **THEN** `request.state.principal` SHALL be `human` and `request.state.credential_kind` SHALL be `run_credential`

### Requirement: Principals are built only at fixed places
Only the auth middleware (including `request_run_envelope`), the channel inbox, the channel adapters entry point, `AccessService.check_human` and the one-time migration backfill SHALL build a principal. Every other path SHALL copy a stored or received envelope.

#### Scenario: Scheduled run
- **WHEN** a schedule whose principal is an API key fires
- **THEN** the run's principal SHALL be that API key, and its origin SHALL be `schedule`

#### Scenario: Evaluation started by an API key
- **WHEN** an API key starts an evaluation and the worker invokes the workflow
- **THEN** the invoked run SHALL carry principal `api_key` and origin `evaluation`

### Requirement: Evaluation principal changes only on an explicit start or rerun
An evaluation run's principal SHALL be set to the caller by the create routes, `POST /simple/evaluations/{id}/start` and `POST /simple/evaluations/{id}/process`. Edits, including the restart inside `PATCH /simple/evaluations/{id}`, and maintenance routes SHALL keep the stored principal. A run without a principal SHALL fail with `missing_principal`.

#### Scenario: Edit keeps the evaluation principal
- **WHEN** Bob edits Alice's evaluation and the edit restarts it
- **THEN** the run SHALL keep principal Alice

#### Scenario: Start by another user
- **WHEN** Bob starts Alice's evaluation with the start route
- **THEN** the run principal SHALL become Bob

### Requirement: Channel turns record the installation and keep today's authority
A channel turn SHALL have principal `installation` with the binding id, origin `installation` with the binding id as `origin_id`, and the linked user, if any, as sender. Its authority SHALL be the linked user's own role when the Slack user is linked, else the binding creator's role.

#### Scenario: Linked Slack user
- **WHEN** a Slack user linked to an Agenta viewer sends a message to a binding that an admin created
- **THEN** the run's principal SHALL be the installation, the turn's sender SHALL be the viewer, and the run SHALL have the viewer's role
