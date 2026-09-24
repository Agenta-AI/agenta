# Channel agent tool settings delta

## Purpose

Give admins per-bot controls over what a connected agent may do with the channel tools, with permissive defaults.

## ADDED Requirements

### Requirement: Three settings per connected bot
Each connected bot SHALL store the settings "Can post outside the conversation" (default on) and "Channels it can search and read" (default: every channel the bot is in). It SHALL also store "Can message people directly" (default on) if direct messages stay in version one, which is pending a decision. A bot saved before this change SHALL read as having the defaults.

#### Scenario: New Slack connection
- **WHEN** an admin connects a Slack workspace and binds it to an agent
- **THEN** the agent SHALL be allowed to post to every channel the bot is in and read and search every channel the bot is in.

#### Scenario: Existing bot
- **WHEN** a bot bound before this change is loaded
- **THEN** its settings SHALL read as the defaults without a data migration step by the admin.

### Requirement: Posting setting
When "Can post outside the conversation" is off, `send_channel_message` SHALL refuse every destination, and `list_channel_destinations` SHALL report that no destination accepts posts. The agent's normal replies inside the conversation that woke it SHALL NOT be affected.

#### Scenario: Posting turned off
- **WHEN** posting is off and the agent calls the send tool for a channel
- **THEN** Agenta SHALL refuse the send and SHALL NOT call the provider.

#### Scenario: Switching off the automatically added send tool
- **WHEN** an admin wants a connected agent never to post outside the conversation
- **THEN** turning posting off SHALL make every send refused, even though the tool is still added to each run.

#### Scenario: Replies still work
- **WHEN** posting is off and someone mentions the agent in a Slack thread
- **THEN** the agent SHALL still answer in that thread.

### Requirement: Direct message setting
Pending decision: this setting exists only if direct messages to people stay in version one. If they are left out, this requirement is removed and the Advanced section SHALL show only the other two controls. If they stay, "Can message people directly" SHALL gate sends to a person. A send to a person SHALL need both this setting and the posting setting. When either is off, the list SHALL omit people and the send tool SHALL refuse person destinations.

#### Scenario: Direct messages turned off
- **WHEN** direct messages are off and posting is on
- **THEN** the agent SHALL be able to post to channels, the list SHALL contain no people, and a send to a person SHALL be refused.

### Requirement: Readable channels setting
"Channels it can search and read" SHALL default to every channel the bot is in. An admin SHALL be able to narrow it to chosen channels or to none. `read_channel_messages` and `search_channel_messages` SHALL serve only channels in the effective list. Narrowing the list SHALL take effect on the next call, even for messages already stored.

#### Scenario: Admin narrows the list
- **WHEN** an admin limits reading to #support and #releases
- **THEN** reads and searches SHALL cover only those two channels, and a read of #finance SHALL be refused.

#### Scenario: Channel added later under the default
- **WHEN** the setting is the default and the bot is invited to a new Slack channel
- **THEN** that channel SHALL become readable without an admin action.

#### Scenario: Reading turned off
- **WHEN** the admin selects no channels
- **THEN** read and search SHALL refuse every destination, and the list SHALL report no readable channel.

### Requirement: Controls in the Advanced section
The Channels settings panel for each connected bot SHALL show its channel tool controls in a collapsible section named "Advanced", on desktop and on `/m`. "Can message people directly" SHALL be disabled while "Can post outside the conversation" is off. On Telegram, the controls SHALL explain that the bot can read only messages it received, and, if direct messages stay, that it can message only people who wrote to it first. A failed save SHALL show the error and re-read the stored value.

#### Scenario: Admin opens the Advanced section
- **WHEN** an admin opens a connected Slack bot's Advanced section for the first time
- **THEN** every switch SHALL be on and the channel list SHALL show "All channels the bot is in".

#### Scenario: Admin picks channels
- **WHEN** the admin chooses "Only these channels"
- **THEN** the panel SHALL list the channels the bot is a member of and save only the checked ones.

#### Scenario: Save fails
- **WHEN** the backend rejects a settings change
- **THEN** the panel SHALL show the error and display the value the backend still holds.

### Requirement: Future per-person allow-list is out of scope
Version one SHALL NOT offer a per-person or per-channel posting allow-list. The settings model SHALL leave room to add one later without changing the existing settings.

#### Scenario: Admin looks for a people allow-list
- **WHEN** an admin opens the Advanced section in version one
- **THEN** the panel SHALL NOT show a control that limits which people the agent may message.
