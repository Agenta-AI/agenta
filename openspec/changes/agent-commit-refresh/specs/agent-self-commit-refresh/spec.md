# Agent self-commit refresh

## Purpose

When an agent commits a new revision of itself, every playground view of that session follows the
new revision without a reload.

## ADDED Requirements

### Requirement: The session in view follows the agent's commit
When the agent in the open session commits a new revision with `commit_revision`, the playground
SHALL invalidate its cached copy of the agent's latest revision. It SHALL show the new revision in
the configuration pane and the version chip, and it SHALL send the next message against that
revision. This SHALL hold on /m and on /w, and for every send path, including durable sends.

#### Scenario: Durable send on /m
- **WHEN** a user on /m asks the agent to change its instructions and the agent commits v6 while the pane shows v5
- **THEN** the version chip SHALL show v6, the instructions SHALL show the new text without a reload, and the next message SHALL be sent against v6.

#### Scenario: Same behavior on /w
- **WHEN** the same happens on /w
- **THEN** /w SHALL behave the same way and SHALL show its "Agent updated this configuration in vN" notice.

#### Scenario: One reaction per commit
- **WHEN** a commit is seen both as a `data-committed-revision` stream part and as a `commit_revision` tool record
- **THEN** the playground SHALL adopt that revision once.

### Requirement: The view follows the commit when it happens
A commit made during a long turn SHALL be applied when its tool result is recorded, not when the turn ends.

#### Scenario: Commit mid-turn
- **WHEN** the agent commits and then keeps working for several minutes
- **THEN** the pane SHALL show the new revision within one records re-read of the `tool.completed` event.

### Requirement: A hidden tab catches up
A tab that was hidden or minimized while the agent committed SHALL show the new revision when it
becomes visible again, without a reload.

#### Scenario: Tab comes back
- **WHEN** the agent commits while the playground tab is in the background, and the user returns to the tab
- **THEN** the tab SHALL re-read the session records and SHALL adopt the committed revision.

### Requirement: Other views of the same session follow the commit
Every open view of the same session, including another tab and /m next to /w, SHALL follow the commit.

#### Scenario: Two tabs on one session
- **WHEN** the same session is open in two tabs and the agent commits during a turn sent from one of them
- **THEN** both tabs SHALL show the new revision.

### Requirement: A failed commit changes nothing
A `commit_revision` call that fails, or that answers `no_change`, SHALL NOT move the configuration pane or the version chip.

#### Scenario: Validation refusal
- **WHEN** the agent's commit is refused for invalid arguments
- **THEN** the tool card SHALL show the error and the pane SHALL stay on the current revision.

### Requirement: A commit made outside the playground shows on next open
A revision the agent commits from Slack, Telegram or an automation SHALL be what a newly opened, unpinned playground session shows.

#### Scenario: Open after a channel run
- **WHEN** the agent commits during a Slack run and the user later opens the agent's playground
- **THEN** a new session SHALL show the committed revision.

## Deferred (NOT IMPLEMENTED in this change)

- A different session of the same agent, in the same tab or another tab, learning about the commit (case 3).
- Other tabs learning about a manual save (case 5). This needs a project-watch event for revision commits.
- Protecting an unsaved local edit from an agent commit: today the later write wins silently (case 6).
- The /m "Agent updated this configuration" notice and the changed-section markers.
