# Channel agent tool settings delta

## Purpose

Give admins per-bot controls over what a connected agent may do with the channel tools, with permissive defaults.

## ADDED Requirements

### Requirement: Two settings per connected bot
Each connected bot SHALL store the settings "Can post outside the conversation" (default on) and "Channels it can search and read" (default: every channel the bot is in), in the `tools` block of `ChannelAgentData`. A bot saved before this change SHALL read as having the defaults.

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

#### Scenario: Switching off a send tool the author added
- **WHEN** an admin wants a connected agent never to post outside the conversation, and the send tool is in the agent's tools
- **THEN** turning posting off SHALL make every send refused, even though the tool stays in each run.

#### Scenario: Replies still work
- **WHEN** posting is off and someone mentions the agent in a Slack thread
- **THEN** the agent SHALL still answer in that thread.

### Requirement: Readable channels setting
"Channels it can search and read" SHALL default to every channel the bot is in. An admin SHALL be able to narrow it to chosen channels or to none. The setting SHALL be stored as `readable_space_keys`: `null` for every channel the bot is in, a list of space keys for chosen channels, and an empty list for none. It SHALL store space keys, not space row IDs, so that an admin can choose a Slack channel that has no stored space row yet. `read_channel_messages` and `search_channel_messages` SHALL serve only channels in the effective list. Narrowing the list SHALL take effect on the next call, even for messages already stored.

#### Scenario: Admin narrows the list
- **WHEN** an admin limits reading to #support and #releases
- **THEN** reads and searches SHALL cover only those two channels, and a read of #finance SHALL be refused.

#### Scenario: Admin picks a channel Agenta has not seen yet
- **WHEN** the bot is a member of a Slack channel where nobody has posted since the bot joined, and the admin chooses it
- **THEN** the setting SHALL save it, and the channel SHALL be readable once the agent reaches it.

#### Scenario: Channel added later under the default
- **WHEN** the setting is the default and the bot is invited to a new Slack channel
- **THEN** that channel SHALL become readable without an admin action.

#### Scenario: Reading turned off
- **WHEN** the admin selects no channels
- **THEN** read and search SHALL refuse every destination, and the list SHALL report no readable channel.

### Requirement: Controls in the Advanced section
The Channels settings panel for each connected bot SHALL show its channel tool controls in a collapsible section named "Advanced", collapsed by default, on desktop and on `/m`. The section SHALL sit after "Behavior" and the Telegram allow-list, above the Disconnect footer. The posting switch SHALL save when flipped. Choosing "Only these channels" SHALL show a checklist and a Save button. On Slack the checklist SHALL hold the discovered channels the bot is a member of. On Telegram it SHALL hold the stored group chats. On Telegram, the controls SHALL explain that the bot can read only messages it received. A failed save SHALL show the error and re-read the stored value.

#### Scenario: Admin opens the Advanced section
- **WHEN** an admin opens a connected Slack bot's Advanced section for the first time
- **THEN** the posting switch SHALL be on and the channel choice SHALL show "All channels the bot is in".

#### Scenario: Admin picks channels
- **WHEN** the admin chooses "Only these channels", checks some channels, and saves
- **THEN** the panel SHALL list the channels the bot is a member of and save only the checked ones.

#### Scenario: Save fails
- **WHEN** the backend rejects a settings change
- **THEN** the panel SHALL show the error and display the value the backend still holds.

### Requirement: Posting allow-list is out of scope
Version one SHALL NOT offer a per-channel posting allow-list. The settings model SHALL leave room to add one later without changing the existing settings.

#### Scenario: Admin looks for a posting allow-list
- **WHEN** an admin opens the Advanced section in version one
- **THEN** the panel SHALL NOT show a control that limits which channels the agent may post to.
