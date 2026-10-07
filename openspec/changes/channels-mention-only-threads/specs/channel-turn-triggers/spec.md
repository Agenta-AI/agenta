# Channel turn triggers delta

## Purpose

Decide which inbound Slack and Telegram messages start an agent turn, and what the agent receives when one does.

## ADDED Requirements

### Requirement: Shared spaces answer only when addressed
In a shared space, a message SHALL start a turn only if at least one of these holds: it mentions the bot or carries a `~agent` sigil; in a Telegram group, it replies to one of the bot's messages; it is a command, such as `!new`; or it resolves a choice the agent has pending in that thread. A shared space is a Slack channel thread, a Slack group DM, or a Telegram group. An earlier turn in the same thread SHALL NOT admit a later message. A message that starts no turn SHALL still be stored.

#### Scenario: Unaddressed reply after the bot answered
- **WHEN** the bot has answered a mention in a Slack channel thread, and someone posts a reply in that thread that does not mention the bot
- **THEN** the reply SHALL be stored and SHALL NOT start a turn.

#### Scenario: Mention in a thread the bot already answered in
- **WHEN** someone mentions the bot in a Slack channel thread where the bot already answered
- **THEN** the message SHALL start a turn in the same thread and session.

#### Scenario: Command without a mention
- **WHEN** someone posts `!new` in a Slack channel thread without mentioning the bot
- **THEN** the command SHALL run.

#### Scenario: Unaddressed message in a group DM
- **WHEN** the bot has answered a mention in a Slack group DM, and someone then posts a message there that does not mention the bot
- **THEN** the message SHALL be stored and SHALL NOT start a turn.

### Requirement: Answers to a pending choice need no mention
When the agent has a choice pending in a thread, a message in that thread that resolves the choice SHALL be admitted without a mention. Typing the choice's label, such as "Approve" or "Deny", or its number SHALL resolve it. Clicking the choice's button SHALL resolve it too.

#### Scenario: Typed approval
- **WHEN** the agent has posted an Approve/Deny choice in a Slack channel thread, and someone types "Approve" there without mentioning the bot
- **THEN** the message SHALL resolve the pending choice and SHALL be delivered to the agent that asked.

#### Scenario: Numbered answer
- **WHEN** the agent has a pending choice and someone types "2" without a mention
- **THEN** the message SHALL resolve to the second choice.

#### Scenario: Text that is not an answer
- **WHEN** the agent has a pending choice and someone posts unrelated text without a mention
- **THEN** the message SHALL be stored and SHALL NOT start a turn.

### Requirement: 1:1 direct messages answer every message
In a 1:1 direct message (a Slack `im` or a Telegram private chat), every human message SHALL start a turn, mentioned or not.

#### Scenario: Plain DM message
- **WHEN** someone sends the bot a Slack direct message that does not mention it
- **THEN** the message SHALL start a turn.

#### Scenario: Telegram private chat
- **WHEN** someone sends the bot a message in a Telegram private chat
- **THEN** the message SHALL start a turn.

### Requirement: Telegram groups answer only when addressed
In a Telegram group, a message SHALL start a turn only if it mentions the bot, replies to one of the bot's messages, or is a command. An earlier turn in the group SHALL NOT admit a later message.

#### Scenario: Plain group chatter after a mention
- **WHEN** the bot has answered a mention in a Telegram group, and someone then posts a message that neither mentions the bot nor replies to it
- **THEN** the message SHALL be stored and SHALL NOT start a turn.

#### Scenario: Reply to the bot
- **WHEN** someone in a Telegram group replies to one of the bot's messages
- **THEN** the message SHALL start a turn.

### Requirement: A turn receives the messages since the agent's last turn
When a message starts a turn in a thread, the agent's input SHALL contain every message posted in that thread since the agent's last turn there, in order, ending with the addressing message. It SHALL NOT contain messages that an earlier turn already received. It SHALL NOT contain messages that arrived after the addressing message; those belong to the next turn.

#### Scenario: Three mentions with messages in between
- **WHEN** a thread receives mention M1, then five unaddressed messages, then mention M2, then three unaddressed messages, then mention M3
- **THEN** the turn for M2 SHALL receive exactly the five messages and M2, and the turn for M3 SHALL receive exactly the three messages and M3, with none of the five and neither M1 nor M2.

#### Scenario: A message arrives while the mention is being processed
- **WHEN** message `a` and mention M2 are posted after M1's turn, and message `b` arrives after M2 but before M2's input is composed
- **THEN** the turn for M2 SHALL receive `a` and M2, and the next mention SHALL receive `b`.

#### Scenario: Mentions queued behind a running turn
- **WHEN** mentions M2 and M3 arrive while M1's turn is still running, so both queue behind it
- **THEN** the queued input for M2 SHALL hold the messages between M1 and M2 and M2 itself, and the queued input for M3 SHALL hold the messages between M2 and M3 and M3 itself.

### Requirement: Every mention runs, at most once per thread
Every addressed message SHALL start a turn, whatever order its dispatch runs in and however late it runs, and at most one turn per thread. No addressed message SHALL be skipped because another turn carried it, and a failure before its invoke SHALL NOT keep its retry from running it. A redelivered event SHALL NOT start a second turn in the same thread. A `!new` between a task retry and its first attempt can run it again in the new thread; this is a known limit (#7131). When messages in one thread arrive within about a second and are dispatched out of order, a message MAY reach two turns as context, or none; this is a deliberate limit.

#### Scenario: A failure before the invoke
- **WHEN** looking up the sender's linked account fails while mention M1 is being dispatched, and the task is retried
- **THEN** the retry SHALL run M1.

#### Scenario: Two mentions dispatched at the same time
- **WHEN** mentions M2 and M3 are processed at the same time, and M2 is also redelivered
- **THEN** M2 and M3 SHALL each start exactly one turn.

#### Scenario: The later mention is dispatched first
- **WHEN** mention M3 is dispatched before mention M2
- **THEN** M3 and M2 SHALL each start one turn.

#### Scenario: A delayed mention after a backlog
- **WHEN** mention M2 is still undispatched hours after it arrived, and mention M3 is dispatched first
- **THEN** M2 SHALL still start its own turn.

#### Scenario: A DM message dispatched after a later one
- **WHEN** in a 1:1 DM, message M2 is dispatched before an earlier message M1
- **THEN** both M1 and M2 SHALL start one turn each.

### Requirement: Answers to a pending choice are not conversation
An answer that resolved a parked interaction (a typed label or number, or a button click) SHALL be sent to that interaction only. A later turn SHALL NOT receive it again as conversation. A button click's token SHALL never be sent as conversation, including the token of a stale click. The other messages around the answer SHALL still reach the next turn.

#### Scenario: Typed approval, then a mention
- **WHEN** someone posts "side note", types "Approve" to answer a pending approval, posts "after", and then mentions the bot
- **THEN** the turn SHALL receive "side note", "after" and the mention, and SHALL NOT receive "Approve".

#### Scenario: Stale button click
- **WHEN** someone clicks a button whose choice is no longer pending, and later mentions the bot
- **THEN** the turn SHALL NOT receive the click's token.

### Requirement: Only a turn that provably never ran keeps its context
A turn's messages SHALL carry into the next turn only when that turn provably never reached the agent: it was REFUSED (the runner turned the start away on every attempt, because the session was busy and the message could not queue), or it FAILED because its start never reached the workflow service. Any other FAILED turn may have run, for example when the response was lost after the request landed. Its messages SHALL NOT be sent again, so the agent does not repeat what it already did.

#### Scenario: Start never sent
- **WHEN** the start for mention M2 never reaches the workflow service, and a later mention M3 starts a turn
- **THEN** the turn for M3 SHALL receive the messages from before M2, M2 itself, and the messages after M2, followed by M3.

#### Scenario: Refused turn
- **WHEN** the turn for mention M2 is refused, and a later mention M3 starts a turn
- **THEN** the turn for M3 SHALL receive the messages M2 would have carried, M2, the messages after it, and M3.

#### Scenario: Response lost after delivery
- **WHEN** the start for mention M2 reaches the runner but the response is lost, so the turn is recorded as failed
- **THEN** the turn for the next mention SHALL NOT receive M2 or the messages before it again.

#### Scenario: A later turn began before the failure was known
- **WHEN** mention M3's input was composed while M2's start was still in flight, and M2's start then turns out never to have been sent
- **THEN** M3 SHALL NOT receive M2's messages, later turns SHALL NOT replay them, and the chat SHALL show the failed-start notice for M2.
