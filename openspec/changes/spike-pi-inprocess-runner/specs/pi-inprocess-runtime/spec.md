# Pi in-process runtime

## Purpose

Run many Pi sessions inside one runner process, fast to start and isolated from each other.

## ADDED Requirements

### Requirement: Select the in-process provider per run

The runner SHALL accept `inprocess` as a sandbox provider id, enabled through the existing provider settings. It SHALL accept only the Pi harness on this provider and refuse others with a clear error.

#### Scenario: Claude asks for inprocess

- **WHEN** a run asks for harness `claude` on provider `inprocess`
- **THEN** the run fails before start with a message naming the supported harness.

### Requirement: Start answering without waiting for a sandbox

A Pi session on `inprocess` SHALL send the first model request without waiting for a sandbox to be ready.

#### Scenario: First message

- **WHEN** a user sends the first message of a new session
- **THEN** the model call starts while the sandbox, if any, is still starting.

### Requirement: Isolate sessions that share a process

Each session SHALL have its own Pi session, model runtime, credential store, tool set and extension state. Nothing one session holds SHALL be readable by another. Provider keys MUST NOT be placed in the runner's process environment.

#### Scenario: Two users in one runner

- **WHEN** user A and user B run sessions at the same time in the same runner process
- **THEN** A's model calls use only A's credentials, and A's tools act only on A's files and connections.

### Requirement: Survive a bad session

A failure in one session SHALL not end other sessions. The runner SHALL bound memory per session and report a session that exceeds it.

#### Scenario: One session throws

- **WHEN** one session's tool throws an unexpected error
- **THEN** that turn fails and every other session keeps running.

### Requirement: Scale past one runner

Sessions SHALL be able to run on more than one runner. A later turn MAY land on a different runner than the one before.

#### Scenario: Turn moves to another runner

- **WHEN** turn 2 of a session lands on a different runner than turn 1
- **THEN** the session continues from its saved state with the same files and history.

### Requirement: Keep tracing

Every turn SHALL produce the same trace structure in Agenta as a Pi run on the `daytona` provider: model calls, tool calls, usage and cost.

#### Scenario: Compare traces

- **WHEN** the same prompt runs on `daytona` and on `inprocess`
- **THEN** both traces show the same span types and usage fields.

### Requirement: Sub-agents are not broken

The spike SHALL NOT build sub-agents. It SHALL record whether the in-process design blocks the sub-agent design. NOT IMPLEMENTED.

#### Scenario: Findings note

- **WHEN** the spike ends
- **THEN** the findings say whether a parent Pi session could start a child Pi session in the same process, and what would block it.
