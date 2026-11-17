# Discord connection

## Purpose

Let a project connect its own Discord bot to Channels from the agent page in /m, check that the bot can read messages, invite it to a server, and disconnect it.

## ADDED Requirements

### Requirement: Bring-your-own bot connection
Agenta SHALL let a project editor connect a Discord bot by pasting its bot token. Agenta SHALL check the token with Discord before it stores anything, SHALL store the token in the project vault, and SHALL key the connection on the bot's `application_id`.

#### Scenario: Valid token with the Message Content intent on
- **WHEN** an editor pastes a bot token that Discord accepts, and the application has `GATEWAY_MESSAGE_CONTENT` (`1 << 18`) or `GATEWAY_MESSAGE_CONTENT_LIMITED` (`1 << 19`) set
- **THEN** Agenta SHALL store the connection with the `application_id`, the bot user id and the bot name read from `GET /applications/@me`
- **AND** the connection SHALL be active and verified

#### Scenario: Token rejected
- **WHEN** Discord rejects the bot token
- **THEN** Agenta SHALL refuse the connection with a setup error and SHALL store nothing

#### Scenario: Bot already connected elsewhere
- **WHEN** a bot with the same `application_id` is already connected to another project on the same deployment
- **THEN** Agenta SHALL refuse the connection with an identity conflict

### Requirement: Message Content intent check
Agenta SHALL refuse a Discord connection whose application has neither Message Content flag set, and SHALL tell the editor to turn on the Message Content intent in the Discord Developer Portal.

#### Scenario: Intent off at setup
- **WHEN** an editor pastes a valid bot token and the application flags have neither `1 << 18` nor `1 << 19` set
- **THEN** Agenta SHALL refuse the connection, SHALL name the Message Content intent in the setup error, and SHALL store nothing

#### Scenario: Intent turned on, then the editor tries again
- **WHEN** the editor turns the intent on and pastes the same token again
- **THEN** Agenta SHALL store the connection

### Requirement: Invite link with exact permissions
After a Discord connection is stored, Agenta SHALL show an invite link that adds the bot to a server with scope `bot` and exactly the permissions View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Read Message History, Add Reactions, Attach Files and Embed Links.

#### Scenario: Invite link shape
- **WHEN** a Discord connection with `application_id` 123 is stored
- **THEN** the setup document SHALL contain `https://discord.com/oauth2/authorize?client_id=123&scope=bot&permissions=309237763136`

#### Scenario: Invite link after reload
- **WHEN** the editor opens the connection again later
- **THEN** Agenta SHALL show the same invite link, built from the recorded `application_id`

### Requirement: Setup flow on the agent page
The /m agent page SHALL offer Discord as a channel with a setup flow that explains how to create an application and a bot in the Discord Developer Portal and turn on the Message Content intent, takes the bot token, and then shows the invite link.

#### Scenario: Editor connects Discord from the agent page
- **WHEN** an editor opens the agent's Channels card and chooses Discord
- **THEN** the page SHALL show the create-a-bot step, the token field and, after a successful check, the invite link

#### Scenario: Wording
- **WHEN** the setup steps and errors are built
- **THEN** their wording SHALL be approved by Mahmoud before M3 ships, because this spec does not fix the copy

### Requirement: Connection states on the agent page
The agent page SHALL show a Discord connection in the same states as a custom Telegram bot: not connected, connected to this agent, connected to another agent, and the existing states for a connection that answers as no agent or whose token was revoked.

#### Scenario: Connected to another agent
- **WHEN** the project's Discord connection answers as a different agent
- **THEN** the agent page SHALL show it as connected to that agent and SHALL offer to connect it here

#### Scenario: Not connected
- **WHEN** the project has no Discord connection
- **THEN** the agent page SHALL offer to connect Discord

### Requirement: Disconnect
Archiving a Discord connection SHALL stop routing its events and SHALL close its socket on the next connection reload. Agenta SHALL NOT remove the bot from any Discord server.

#### Scenario: Socket after archive
- **WHEN** an editor archives the Discord connection
- **THEN** the socket loop SHALL close that connection's socket within one reload interval

#### Scenario: Event after archive
- **WHEN** an event for an archived connection is already in the queue
- **THEN** Agenta SHALL NOT start a turn for it
