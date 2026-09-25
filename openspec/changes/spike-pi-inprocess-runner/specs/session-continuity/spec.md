# Session continuity

## Purpose

Sessions behave as today: they continue, resume after a pause, can be cancelled, and survive a runner restart.

## ADDED Requirements

### Requirement: Continue a warm session

If the next message arrives while the session is still in memory, the runner SHALL continue it without reloading anything.

#### Scenario: Quick reply

- **WHEN** the user replies 30 seconds after the last turn
- **THEN** the turn starts with no reload and no sandbox wait.

### Requirement: Resume a cold session

The runner SHALL save the Pi transcript at every turn end outside the process. A later turn SHALL rebuild the session from it, on any runner.

#### Scenario: Runner restarted

- **WHEN** the runner restarts between two turns
- **THEN** the next turn continues with the full history, and its commands run in a fresh sandbox restored from the drive (see sandbox-lifecycle).

### Requirement: Cancel a turn

Stopping a turn SHALL stop the model call and any running command in the sandbox.

#### Scenario: Stop during a long command

- **WHEN** the user presses stop while `npm install` runs
- **THEN** the command is killed in the sandbox and the turn ends as cancelled.

### Requirement: Live events

Streaming text, tool events and the turn-end signal SHALL reach the client in the same format as today.

#### Scenario: Same UI

- **WHEN** a user watches an `inprocess` session in the chat UI
- **THEN** it looks the same as a `daytona` session.
