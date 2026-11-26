# Channel limits

## Purpose

Let an agent owner choose where an agent answers in Slack and Telegram and whom it answers, and tell a refused person why, without adding cost to any message the agent answers.

## ADDED Requirements

### Requirement: Defaults keep today's behavior
With no limit changed, an agent SHALL answer direct messages, SHALL answer in every channel it is in when someone mentions it, and SHALL answer everyone, as today. A saved limit SHALL apply to the next message, with no cache to clear.

#### Scenario: Defaults
- **WHEN** anyone DMs or mentions an agent with no limits
- **THEN** the agent SHALL answer, as today

### Requirement: Only chosen channels
The owner SHALL be able to choose "All channels the bot is in" or "Only these channels" with a checklist of the channels the bot is in. "Only these channels" SHALL be stored as allow rules (kind `private` when direct messages are on, and one rule per checked channel), with no deny rule for channels. A channel that is not checked, and a channel the bot joins later, SHALL get no turn. Group DMs SHALL count as channels, so "Only these channels" SHALL turn group DMs off. The screen SHALL read a chosen-channels state back as chosen.

#### Scenario: Mention in a chosen channel
- **WHEN** the agent answers only in `#support` and a person mentions it in `#support`
- **THEN** the agent SHALL answer

#### Scenario: Mention in another channel
- **WHEN** the agent answers only in `#support` and a person mentions it in `#random`
- **THEN** no turn SHALL start, and the person SHALL get one ephemeral note in `#random`

#### Scenario: Nothing checked
- **WHEN** the owner saves "Only these channels" with no channel checked and direct messages on
- **THEN** the setting SHALL be saved, the agent SHALL answer direct messages, and SHALL answer in no channel

### Requirement: Only chosen people
The owner SHALL be able to choose "Everyone" or "Specific people" for Slack and for Telegram. The list SHALL be stored on the agent binding (`channel_agents.data.audience`) and SHALL apply only to that agent, in direct messages and channels alike. The check SHALL compare platform user ids only. "Specific people" with an empty list SHALL NOT be saved, and removing the last person SHALL return the setting to "Everyone". A message from a person outside the list SHALL start no turn and SHALL NOT be stored as context.

#### Scenario: Person not on the list mentions the agent
- **WHEN** the agent answers only Ana, and Ben mentions it in a channel
- **THEN** no turn SHALL start, and Ben SHALL get one ephemeral note

#### Scenario: Two agents on the hosted Slack app
- **WHEN** agents A and B share one hosted Slack installation, only agent A has a people list without Ben, and Ben mentions agent B
- **THEN** agent B SHALL answer

#### Scenario: Message without a mention from a person not on the list
- **WHEN** the agent answers only Ana, and Ben writes in Ana's thread without a mention
- **THEN** no turn SHALL start, no note SHALL be sent, and the message SHALL NOT be stored

#### Scenario: Person removed mid-thread
- **WHEN** the owner removes Ana from the list while a thread with Ana is running
- **THEN** Ana's next message SHALL be refused

#### Scenario: Telegram username
- **WHEN** the owner types "@ana" as a Telegram person
- **THEN** the screen SHALL refuse it with an error, because the check needs a numeric user id

### Requirement: People are picked by name or email
For Slack, the owner SHALL find people by name or email, from people who wrote to the bot, a cached copy of the workspace people list (kept 24 hours, with a Refresh action), and a live lookup of a full email. The server SHALL store the member id and a display label; the check SHALL NOT read the label. For Telegram, the owner SHALL pick from people who messaged the bot or type a numeric id.

#### Scenario: Add a person by email
- **WHEN** the owner types the full email of a Slack member who is not in the cached list
- **THEN** the picker SHALL find that member by email and the server SHALL store the member id

### Requirement: A refused person gets one private note a day
When a message that addresses the agent (a direct message, or a mention or command in a channel) is refused by the people limit or the place limit, the system SHALL send one short private note: an ephemeral message in a Slack channel, a normal reply in a Slack direct message or a Telegram private chat, and nothing in a Telegram group. The system SHALL send at most one note per person, per place, per day. A refusal SHALL NOT start a turn, open a session or charge credits. The note SHALL name no agent and no owner.

#### Scenario: Direct messages off
- **WHEN** direct messages are off and a person DMs the agent twice in an hour
- **THEN** no turn SHALL start, the first message SHALL get one note, and the second SHALL get none

#### Scenario: Telegram group
- **WHEN** a person not on the list replies to the bot in a Telegram group
- **THEN** no turn SHALL start and no note SHALL be sent

### Requirement: Allowed messages cost nothing more
An allowed message SHALL run the same number of database statements and network calls as before this change. Extra cost SHALL appear only on refusal paths.

#### Scenario: Statement count
- **WHEN** an allowed message is handled with limits set
- **THEN** the number of statements SHALL equal the number for the same message before this change

### Requirement: Who may change the limits
Only the owner of a private agent SHALL change its limits. For a project-visible agent, a member with `EDIT_CHANNELS` SHALL change them. No special rule SHALL apply to Slack guests or Slack Connect people.

#### Scenario: Admin edits a private agent's limits
- **WHEN** a project admin who is not the owner changes the people list of a private agent
- **THEN** the system SHALL refuse the change

### Requirement: Existing lists move to the agent binding
A one-time data step SHALL copy each installation's `allowed_senders` to every agent binding of that installation. After the copy, a binding with no list SHALL answer everyone.

#### Scenario: Telegram list copied
- **WHEN** a Telegram installation with two agent bindings has a list of three ids before the change
- **THEN** after the change both bindings SHALL hold those three ids
