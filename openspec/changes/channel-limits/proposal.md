# Channel limits (M10)

## Why

An agent owner cannot fully choose where an agent answers in Slack or Telegram, or whom it answers. Most of the backend exists in v0.125.0, and the gaps are in the screen and in a few rules:

- The "Who can message it" control shows only for Telegram. Slack has the same backend check, and the screen hides it.
- The Slack "Add channel" picker adds a channel to the list, and it does not limit the agent to that channel.
- The people list is stored on the installation, and one installation can hold several agents. The hosted Agenta Slack app is one shared app with one installation per workspace, so a list set in one agent's panel applies to every agent on that installation.
- Slack people are stored as member ids. The owner cannot pick them by name.
- A person the agent does not answer gets no reply, so they cannot tell a refusal from a fault.

Priority: low (owner decision, 2026-10-26). It comes after the channel bug fix that lets members write to channel chats in `/m` and lets a private agent be in a channel.

## What Changes

All seven questions were decided by the owner on 2026-10-26.

- Where it answers: today's "Answers in" switches stay. A new Advanced row "Channels it answers in" ("Groups it answers in" on Telegram) offers "All channels the bot is in" (default) or "Only these channels", a multiple choice of the channels the bot is in. The "Add channel" picker gets a search field and adds several channels at once.
- Whom it answers: "Who can message it" (Everyone, default, or Specific people) shows for Slack too. Slack people are found by name or email search. Telegram keeps numeric ids, plus "People who messaged the bot".
- The people list moves from the installation to the agent binding. Existing Telegram lists are copied once.
- A person the agent does not answer gets a short private note, at most once a day per person and place.
- Messages from people outside the list stay out of the stored context, as today.
- Group DMs count as channels.
- Only the owner changes a private agent's limits.
- No special rule for guests or Slack Connect people.
- Fix three bugs in today's screen: a Telegram "@name" is accepted and never matches; an empty "Specific people" list means everyone while the screen says "Specific people"; the switches read back only kind denies.

## Capabilities

### New Capabilities

- `channel-limits`: where an agent answers, whom it answers, the refusal note, who may change the limits.

### Modified Capabilities

None.

## Non-goals

- A required "who can talk to it" setup before a private agent goes into a channel.
- People lists per channel, Slack user groups, limits by Slack role or guest status.
- Adding people from the Agenta project member list (a possible later shortcut).
- Changing who reads channel chats in Agenta. The sharing rules (CONTRACT.md sections 4 and 7) own that.
- Account linking for Slack.

## Dependencies

Independent of the change that lets a private agent be in a channel. Either can ship first. Draft copy needs owner approval before it ships.
