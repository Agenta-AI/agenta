# Agent moves delta

## Purpose

Share an agent with a team by moving it into the team project.

## ADDED Requirements

### Requirement: Move scope
A move SHALL go from the caller's personal project to a team project of the same organization. The caller SHALL own the agent, SHALL have `EDIT_WORKFLOWS` in the target, SHALL choose the target visibility, and SHALL stay the owner.

#### Scenario: Not the owner
- **WHEN** Bob tries to move an agent that he does not own
- **THEN** the move SHALL be refused.

#### Scenario: Team to team
- **WHEN** a user tries to move an agent whose source is a team project
- **THEN** the move SHALL be refused.

### Requirement: Move order satisfies the foreign keys
In one transaction, with the source artifact locked, the move SHALL insert the target artifact and variant rows with the same ids, move every revision, the M3 access row and the agent mounts, and then delete the source variants and artifact. `folder_id` SHALL be null. Mount prefixes SHALL NOT change and files SHALL NOT be copied.

#### Scenario: Revisions move
- **WHEN** an agent with 12 revisions moves
- **THEN** all 12 SHALL be in the target, none SHALL remain in the source, and no foreign-key error SHALL occur.

### Requirement: Schedules on a move
Every schedule on the agent SHALL stay in the source, paused, with its deliveries. For each schedule whose principal is a human member of the target and has no source, the move SHALL create a new paused schedule in the target with the same principal, input and cadence. Subscriptions SHALL stay in the source and pause.

#### Scenario: Member schedule
- **WHEN** Alice, a Sales member, has a schedule with 30 deliveries on the agent
- **THEN** the old schedule SHALL stay paused in her personal project with its 30 deliveries, and a new paused schedule SHALL exist in Sales.

### Requirement: Stay set
Sessions, turns, records, session mounts, attachments, deliveries, usage records and spans SHALL stay in the source. Old sessions SHALL stay private to the owner.

#### Scenario: Old chats stay
- **WHEN** Alice moves her agent to Sales
- **THEN** her earlier sessions SHALL stay in her personal project, unreadable by Sales members.

### Requirement: Move refusals
The move SHALL be refused, with every reason listed, on each refusal named in the design. The checks SHALL run again inside the transaction.

#### Scenario: Slug clash
- **WHEN** the target already has an agent with the same slug
- **THEN** the move SHALL be refused and nothing SHALL change.

#### Scenario: Running session
- **WHEN** a session of the agent is running
- **THEN** the move SHALL be refused.

#### Scenario: Stale session
- **WHEN** a session of the agent has a turn without an end time but its stream is no longer alive
- **THEN** that session SHALL NOT block the move.

#### Scenario: Deployed agent
- **WHEN** the agent is deployed to an environment in the source
- **THEN** the move SHALL be refused and the deployment SHALL NOT be deleted.

#### Scenario: Old storage prefix
- **WHEN** an agent mount still uses `mounts/<project_id>/<mount_id>/`
- **THEN** the move SHALL be refused.

### Requirement: Connections chosen again
The preflight SHALL list every connection reference in the latest revision. The request SHALL map each to a target connection or to removal. The move SHALL commit one new target revision with the chosen references and SHALL NOT carry a source connection into the target.

#### Scenario: Rebind
- **WHEN** Alice maps her Gmail reference to the Sales Gmail connection
- **THEN** the latest revision in Sales SHALL reference the Sales connection only.

### Requirement: Disclosure and event
The preflight SHALL show the revisions that become visible, the agent file count and size, and the schedules and subscriptions that pause or are recreated. It SHALL state that issued storage credentials stay valid until they expire. Every move SHALL write one `agents.moved` event.

#### Scenario: Preflight
- **WHEN** Alice opens the share step for Sales
- **THEN** she SHALL see the revisions and files that Sales members will be able to read.

#### Scenario: Move event
- **WHEN** a move completes
- **THEN** one `agents.moved` event SHALL exist for it.
