# Agent version freshness

## Purpose

How a playground session learns about, shows, and adopts a newer version of its agent.

## ADDED Requirements

### Requirement: The session in view follows its own agent's commit
When the agent in the session the user is watching commits a new revision during that session's
turn, the playground SHALL show the new revision in the configuration pane and the version chip,
and SHALL send the next message against it. This SHALL hold on /m and on /w, for every send path.
(Decision 1, Option A. Open with Mahmoud.)

#### Scenario: Durable send on /m
- **WHEN** a user on /m asks the agent to change its instructions and the agent commits v6 while the chip shows v5
- **THEN** the chip SHALL show v6, the instructions SHALL show the new text without a reload, and the next message SHALL be sent against v6.

#### Scenario: Commit mid-turn
- **WHEN** the agent commits and keeps working
- **THEN** the view SHALL move when the commit's tool result is recorded, not when the turn ends.

#### Scenario: One reaction per commit
- **WHEN** a commit is seen both as a stream part and as a tool record
- **THEN** the playground SHALL adopt it once.

### Requirement: Views the user is not watching never upgrade by themselves
A session SHALL NOT switch to a newer version unless the user asks, except in the case above. When
a newer version of its agent exists, the session SHALL show a pill next to the version chip that
reads "vN available · Update". Update SHALL switch that session to the latest version. There SHALL
be no banner and no popup.

#### Scenario: Another session of the same agent
- **WHEN** the agent commits v6 in session A and the user then switches to session B, which is on v5
- **THEN** session B SHALL stay on v5 and SHALL show "v6 available · Update".

#### Scenario: Hidden tab
- **WHEN** the agent commits while the playground tab is hidden, and the user returns to the tab
- **THEN** the tab SHALL show the pill and SHALL NOT change the configuration it shows.

#### Scenario: Another tab, or /m next to /w
- **WHEN** a commit happens in one tab and another tab on the same agent becomes visible
- **THEN** the other tab SHALL show the pill.

#### Scenario: Manual save elsewhere
- **WHEN** the user saves the config in one tab
- **THEN** that tab SHALL move to the new version, and other open sessions SHALL show the pill at their next check.

#### Scenario: Update
- **WHEN** the user clicks Update
- **THEN** the session SHALL switch to the latest version, the next message SHALL be sent against it, and the pill SHALL disappear.

### Requirement: A newer version is detected with one check at defined moments
The playground SHALL check for a newer version with one request when the tab becomes visible, when
a session becomes the active session, and when the version drawer opens. It SHALL NOT poll, and
SHALL NOT send the check while the tab is hidden.

#### Scenario: Tab stays hidden
- **WHEN** the tab is hidden for ten minutes while the agent commits several times
- **THEN** the playground SHALL send no version check during that time, and SHALL send one when the tab becomes visible.

### Requirement: New sessions start on the latest version
A new session SHALL start on the agent's latest version as the server reports it at creation.

#### Scenario: Commit from a channel
- **WHEN** the agent commits during a Slack run and the user then opens a new playground session
- **THEN** the new session SHALL start on that committed version.

### Requirement: The version drawer is current when it opens
The version drawer SHALL re-fetch the version list each time it opens. Versions newer than the
session's version SHALL be listed at the top, each with an Update action.

#### Scenario: Drawer after a commit
- **WHEN** the agent commits v6 and the user opens the drawer on a session that shows v5
- **THEN** the drawer SHALL list v6 at the top with Update.

### Requirement: A failed commit changes nothing
A `commit_revision` call that fails or answers `no_change` SHALL NOT move the view or raise the pill.

#### Scenario: Validation refusal
- **WHEN** the agent's commit is refused for invalid arguments
- **THEN** the tool card SHALL show the error and the view SHALL stay on the current version.

## Deferred (NOT IMPLEMENTED in this change)

- Protecting an unsaved local edit from an agent commit (case 6). Today the later write wins silently.
- A project-watch event for revision commits (Decision 3 option).
