# Sandbox lifecycle

## Purpose

Use a Daytona sandbox only for commands, keep it ready when the agent needs it, and stop paying for it when idle.

## ADDED Requirements

### Requirement: Commands run in the sandbox

Every shell command the agent runs SHALL run in the session's Daytona sandbox, never on the runner host.

#### Scenario: Agent runs bash

- **WHEN** the agent calls `bash` with `ls -la`
- **THEN** the command runs in the sandbox and the runner host runs no process for it.

### Requirement: Start on the first tool call

The runner SHALL start (or resume) the sandbox on the first tool call that needs it (every file tool and command), and not before: no early or predictive start (decided 2026-09-24). A start SHALL mount the drive before the call runs.

#### Scenario: Command on turn one

- **WHEN** the model asks for its first tool call 5 seconds into the first turn
- **THEN** the sandbox starts then, the drive is mounted, and the call runs (about 2.7 s for a new sandbox, 1.8 s for a stopped one).

### Requirement: Stop when idle, resume on demand

After an idle period the runner SHALL stop the sandbox without deleting it. The next command on the same runner SHALL start the same sandbox again, with its local disk intact.

A runner SHALL use only the command sandboxes it created. When a conversation continues on another runner (after a restart, a crash or a reroute), the next tool call SHALL get a fresh sandbox that mounts the drive and restores `.tools/`, and the old sandbox SHALL never be used again and SHALL be deleted. The drive holds the only copy of the files; the sandbox's own disk outside the drive, such as `/tmp`, does not carry over to another sandbox. A sandbox whose mount of the drive died SHALL be replaced the same way.

#### Scenario: User returns after a break

- **WHEN** the user sends a message 20 minutes later and the agent runs a command on the same runner
- **THEN** the stopped sandbox starts again, and files the agent left in `/tmp` are still there.

#### Scenario: The conversation moves to another runner

- **WHEN** the runner that held the conversation restarts or crashes, and the next turn runs a command on another runner
- **THEN** the command runs in a new sandbox that mounts the drive, the old sandbox is never touched by the new runner, and it is deleted once its runner is gone.

### Requirement: No sandbox for sessions that never need one

A session whose agent runs no tool call SHALL NOT create a sandbox. The sandbox starts on the first tool call; there is no early or predictive start (decided in round 7).

#### Scenario: Pure chat and tools session

- **WHEN** a session only chats and calls Composio tools
- **THEN** no sandbox is created, and no sandbox time is billed.

### Requirement: Measure time and cost

The spike SHALL record: time to first model token, time from command request to command start (cold, stopped, running), and sandbox running seconds per session.

#### Scenario: Report

- **WHEN** the spike ends
- **THEN** a table compares these numbers for `daytona` and `inprocess` on the same prompts.
