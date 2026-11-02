# Authority propagation

## Purpose

Keep a run's principal, restrictions, provenance and sender through every token mint, queue, child run and resume, so authority never widens.

## ADDED Requirements

### Requirement: Every mint takes the trusted authority
Every mint of design D5 SHALL write the trusted envelope: `_prepare_invoke` and `invoke_workflow(_detached)` SHALL require `envelope`; the gateway and MCP mints SHALL copy all claims; the exchange SHALL never upgrade a principal.

#### Scenario: Invoke under a key
- **WHEN** `_prepare_invoke` runs for a request authenticated by an API key
- **THEN** its Secret SHALL carry principal `api_key`

#### Scenario: Runner refresh
- **WHEN** the runner refreshes a Secret through the exchange
- **THEN** the new Secret SHALL carry the same principal, authority, run context and sender

### Requirement: Durable work stores its authority
Each durable work type SHALL store its authority as in design D6, written by the server. Each consumer SHALL rebuild the envelope from it and call `require` before it runs.

#### Scenario: Queued API send
- **WHEN** an API key queues a message and a worker dispatches it later
- **THEN** the run SHALL carry principal `api_key`

#### Scenario: Principal lost access while queued
- **WHEN** a queued input's principal loses access before dispatch
- **THEN** the worker SHALL NOT start the run and SHALL settle the command and its execution terminally (outcome `failed`) with `access_denied`, and SHALL NOT retry it
- **AND** the next queued input of the session SHALL proceed

### Requirement: New work never falls back to a human
A consumer with no stored authority SHALL refuse the work and SHALL NOT build `human(created_by_id)`. Only the M2 migration backfill SHALL build it, for rows that exist at migration time. Queued inputs, commands and parked approvals with no envelope SHALL be cancelled with `missing_envelope`, as a committed terminal state, not as a transport retry. A Secret without `principal` SHALL answer 401 `missing_principal`.

#### Scenario: Item queued before the deploy
- **WHEN** a worker on the new release reads a pending command that was queued before the deploy, with a null `run_envelope`
- **THEN** it SHALL cancel the command with `missing_envelope` and SHALL NOT start a run

### Requirement: Heartbeat-first creation receives the trusted authority
The heartbeat route SHALL pass the run credential's envelope to `SessionStreamsService.heartbeat`. A heartbeat that would create a session without a run credential SHALL be refused with 403 `session_requires_run_credential`.

#### Scenario: Headless invoke creates its session
- **WHEN** a headless run's first heartbeat creates the session
- **THEN** `_heartbeat_locked` SHALL receive the run's authority and sender

### Requirement: Child runs inherit and stay in the project
A tool-started run SHALL carry the parent's authority and sender, `origin = child` and the parent run id, in the parent's project, and SHALL be checked with `require` before it starts.

#### Scenario: Agent as a tool
- **WHEN** a human's run calls another agent of the same project as a tool
- **THEN** the child credential SHALL carry the parent's principal and name the parent run

### Requirement: Approval resume keeps the original authority and sender
The resume SHALL use the interaction's envelope (authority, origin, sender), a new `run_id` and `approved_by` with the approving principal, and SHALL recheck first.

#### Scenario: API key run approved by a human
- **WHEN** Bob approves a tool call in a run that Alice's API key started
- **THEN** the resumed run SHALL carry principal `api_key`, the original sender, and `approved_by` with principal `human` Bob

#### Scenario: Original principal removed
- **WHEN** the original principal lost access before the approval
- **THEN** the resume SHALL NOT start, and the interaction SHALL report `access_denied`

### Requirement: Agent-visible failures use the error envelope
New failures that an agent or a client sees SHALL use `{code, message, retryable, next_step?, details?}` with the codes of design D9.

#### Scenario: Child run refused
- **WHEN** a child run is denied
- **THEN** the tool result SHALL carry `code` `access_denied`, `retryable` false, and the decision reason in `details.reason`
