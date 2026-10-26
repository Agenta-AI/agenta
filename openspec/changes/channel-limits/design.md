# Design: channel limits (M10)

## Context

Code read from v0.125.0. Today:

| Table | Holds |
| --- | --- |
| `channel_connections` | One row per installation (one Slack app, one Telegram bot). `data.allowed_senders` holds today's people list. |
| `channel_agents` | An agent bound to an installation. `data` is typed as `ChannelAgentData`. |
| `channel_spaces` | One row per conversation the bot has seen. `kind`: `private` (DM), `group` (group DM, Telegram group), `topic` (Slack channel). |
| `channel_grants` | Allow or deny rules for an agent, by kind or by one space. Any deny wins over any allow (`core/channels/utils.py:210-221`). If an agent has rules and none matches, the message is dropped. |

`ChannelsService.resolve` (in the inbox worker) reads the installation, checks `allowed_senders` in memory, finds or creates the space, finds the agent (waiting agent, thread agent, sigil, space default rule, installation default), reads the agent's rules, and then checks the trigger (a DM always starts a turn; in a channel only a mention, a command or a choice answer does). A refused message ends silently.

Owner decisions (2026-10-26):

| # | Question | Decision |
| --- | --- | --- |
| 1 | Reply to a refused person | A short private note ships in this package |
| 2 | Refused senders as context | Stay dropped, as today |
| 3 | Where the people list lives | On the agent binding (`channel_agents.data.audience`), with a one-time copy of Telegram lists |
| 4 | How Slack people are picked | Search by name or email |
| 5 | Group DMs | Count as channels |
| 6 | Who changes a private agent's limits | Only the owner |
| 7 | Guests and Slack Connect | No special rule now |

UI decisions: keep today's add and remove channel UI, with search and multi-add in the picker; the channel limit is an Advanced, multiple-choice setting; no "New" tags; no private-agent notice card.

## Decisions

### D1. Settings

| Control | Choices | Default |
| --- | --- | --- |
| Direct messages (today) | On, Off | On |
| Channels, or Group chats on Telegram (today) | On, Off | On |
| Channels it answers in, or Groups it answers in (Advanced, new) | All channels the bot is in; Only these channels (checklist) | All channels the bot is in |
| Who can message it (Slack is new) | Everyone; Specific people | Everyone |

- The mention rule does not change.
- An unchecked channel stays in the list, marked Off. A channel the bot joins later stays off until it is checked.
- A group DM has no name in the picker, so "Only these channels" turns group DMs off. The help text says "Channels and group DMs".
- Telegram cannot list chats, so a group appears once the bot is mentioned there. The hosted Telegram bot works in private chats only and gets only the people setting.
- "Specific people" with an empty list cannot be saved. Removing the last person returns the screen to Everyone.
- "Only these channels" with nothing checked can be saved. The checklist then says that the agent answers in no channel.

### D2. Storage of where it answers

Channel limits are `channel_grants` rows. No new table.

```text
All channels the bot is in    -> today's kind rules, unchanged
Only these: #support, #ops     -> allow kind=private (if DMs are on)
                                  allow space=#support, allow space=#ops
Only these, DMs off            -> allow space=#support
Only these, nothing checked    -> allow kind=private (if DMs are on)
DMs on, Channels off           -> allow private, deny group, deny topic (today)
```

"Only these channels" never writes a deny for channels, because any deny wins. Other channels match no rule while rules exist, so they are refused. The "Answers in" switches and the Advanced row write one rule set through one function (`writeBehavior` and the new save share it). `readBehavior` reads single-channel allow rules, so a chosen-channels state reads back as chosen. The checklist lists only channels with a `channel_spaces` row.

### D3. Storage of whom it answers

`ChannelAgentData.audience`, a typed block defaulted when missing:

```text
audience.senders: list[str]                          # Slack member ids or Telegram user ids
audience.labels:  dict[str, {name, email | None}]    # display only; the check never reads it
```

An empty `senders` list means everyone. The check compares ids only, so a stale label never lets the wrong person in. A one-time data step copies each installation's `allowed_senders` to every agent binding of that installation. New pods read `audience`; until every pod runs the new code, the installation field stays written, and then it stops being read.

### D4. Where the check runs

In `ChannelsService.resolve`, in today's order. A refusal returns a reason instead of a bare `None`:

1. Read the installation (today).
2. Find or create the space and attach the event (today).
3. Find the agent (today).
4. Agent people check on `agent.data.audience.senders`, in memory. Reason `sender_not_allowed`.
5. Place check from the rules (reads done today). Reason `place_off`, with the kind.
6. Trigger check (today). A message that does not address the agent ends here silently, for everyone.
7. If step 4 or 5 refused, and the message addressed the agent (a DM, or a mention or command in a channel), the worker sends one note (D5).

A refused sender's message is not stored as context, as today. Settings take effect on the next message; nothing caches them.

### D5. Refusal note

| Case | Slack | Telegram |
| --- | --- | --- |
| Message that does not address the agent | Silent | Silent |
| Person not on the list mentions or DMs the agent | Ephemeral note in a channel; normal reply in a DM | Reply in a private chat; silent in a group |
| Mention in a channel that is off, or a DM while DMs are off | Same as above | Same as above |
| How often | At most once per person, per place, per day | Same |

- The inbox worker posts the note like today's fixed notices (busy, unsupported, opt-out), keyed by a UUID v5 of person, place, reason and date. The outbox worker sends only turn output, so it is not used.
- A Slack channel note uses `chat.postEphemeral`. The adapter interface gains an ephemeral send. If Slack refuses it, the worker logs and drops it; a note is never retried in a loop.
- The copy names no agent and no owner, so no lookup is added. Draft copy (not approved): "This agent only answers chosen people. Ask its owner in Agenta to add you.", "This agent does not answer in this channel.", "This agent does not answer direct messages. Mention it in a channel instead."
- A refusal never starts a turn, never opens a session and never charges credits.

### D6. People picker

Slack has no search method for apps. The picker uses three sources:

| Source | Freshness | Cost |
| --- | --- | --- |
| People who wrote to the bot (stored inbox events) | Current | One read when the picker opens. Also the only list for Telegram |
| Cached Slack people list (`users.list`, paged, in a background task) | Loaded on first open, kept 24 hours in the shared cache (Redis), "Refresh" reloads it | Slack calls only when loading or refreshing |
| Exact email lookup (`users.lookupByEmail`) | Live | One call per full email typed |

New settings-time routes on the connection: `POST /channels/connections/{id}/people/query` and `POST /channels/connections/{id}/people/refresh`. The people list is saved through the existing agent binding edit route. The app manifest already has `users:read`, `users:read.email`, `channels:read`, `groups:read` and `channels:join`; an older app without a scope shows a reinstall prompt. The cached list is removed with the installation. People from other companies in Slack Connect channels are added from the first source once they wrote to the bot. A person who left the workspace stays listed as "No longer in Slack" until removed.

### D7. Who may change the limits

- A shared agent: the people who manage its channels today (`EDIT_CHANNELS`).
- A private agent: only its owner (M3). Project admins can still turn the installation off.

### D8. Private agents

The limits work the same way for private and shared agents and are optional for both. With no limits, everyone in the channel may talk to a private agent (CONTRACT.md section 4). The limits never change who reads the chats in Agenta.

## Latency

| Path | Added reads | Added network calls | Added writes |
| --- | --- | --- | --- |
| Allowed message, with or without limits | 0 | 0 | 0 |
| Refused by place, not addressed | 0 | 0 | 0 |
| Refused sender (list on the agent row) | 1 to 2 (space and agent lookups that today's early check skips) | 0 | 1 (event attach, sometimes a space insert) |
| Refused and addressed, first time per day per person and place | 1 (note key) | 1 send | 1 notice row |
| Refused and addressed, repeat the same day | 1 (note key) | 0 | 0 |

Every allowed message costs exactly what it costs today. Extra cost appears only on refusal paths.

## Migration and mixed-version behavior

No table migration. One data step copies `allowed_senders` into `audience.senders` of each binding. Old pods read the installation list, which stays written until every pod runs the new code; new pods read the binding list. The note key and the ephemeral send are new code paths with no stored state beyond today's notice rows.

## Risks

- Moving the people check after the agent lookup adds reads and a write for refused senders. Accepted (question 3).
- The cached Slack list can be up to 24 hours old. A new person can be added at once by email.
- Telegram groups get no note, because Telegram has no private message inside a group.

## Open questions

None. All seven questions are decided. The draft copy needs owner approval.
