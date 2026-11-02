# Project doors delta

## Purpose

Let a personal agent find, run and read team agents and files with its user's own permissions.

## ADDED Requirements

### Requirement: Door eligibility
A run SHALL get the three doors at start only if its principal is `human`, its authority has no source, its origin is `web`, and its project is that human's personal project. Every other run SHALL get no doors.

#### Scenario: API key
- **WHEN** a run started with a personal or service API key calls a door
- **THEN** the door SHALL be refused.

#### Scenario: No chaining
- **WHEN** a child run started through a door calls a door
- **THEN** the door SHALL be refused.

#### Scenario: Team project run
- **WHEN** an agent in a team project, run by a human, calls a door
- **THEN** the door SHALL be refused.

### Requirement: Door check
Each door call SHALL be allowed only if the parent run's door limits allow it, the principal has current access in the target (membership read without the permission cache), and the M3 resource policy allows it.

#### Scenario: User left the target
- **WHEN** Alice was removed from Sales one second before her personal agent calls a Sales door
- **THEN** the door SHALL be refused.

#### Scenario: Private agent of another user
- **WHEN** Alice's personal agent searches Sales and Bob has a private agent there
- **THEN** Bob's agent SHALL NOT appear.

### Requirement: Child run
A run-an-agent door SHALL run the target agent in the target project with the parent's principal and restrictions, no doors, no source, `origin = child` and `parent_run_id` set. Its trace, files and usage SHALL land in the target, in a session private to the principal. The result SHALL be stored only in the personal session.

#### Scenario: Run a Sales agent
- **WHEN** Alice's personal agent runs the Sales report agent
- **THEN** the child run SHALL be in Sales with principal Alice and `parent_run_id` equal to the personal run id, and Bob, a Sales member, SHALL NOT see the child session or its result.

#### Scenario: No capability beyond the principal
- **WHEN** Alice is a Sales viewer without `RUN_WORKFLOWS`
- **THEN** the run-an-agent door SHALL be refused.

### Requirement: Run-an-agent activation gate
The run-an-agent door SHALL stay off until M9 trace privacy enforcement runs on every pod. The find-agents and read-files doors SHALL NOT wait for M9.

#### Scenario: Before M9
- **WHEN** M9 enforcement is not yet on every pod
- **THEN** a run-an-agent door call SHALL be refused.

### Requirement: Read files without storage credentials
The read-files door SHALL list and read files through the server, read-only, with a size limit per call, and SHALL NOT sign storage credentials.

#### Scenario: Session mount of another user
- **WHEN** Alice's personal agent reads a mount of Bob's private Sales session
- **THEN** the door SHALL be refused.

### Requirement: Door events and routes
Every door call SHALL write one `doors.crossed` event, allowed or refused, with the refusing part when refused. The door routes SHALL accept only run credentials. The agent service SHALL offer the `find_agents`, `run_agent` and `read_files` ops only to runs whose limits contain them.

#### Scenario: Refused door
- **WHEN** a door is refused by the resource policy
- **THEN** one `doors.crossed` event SHALL record the refusal with part `resource`.
