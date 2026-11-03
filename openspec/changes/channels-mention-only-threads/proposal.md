# Proposal

## Why

In v0.121.0, one mention of the Agenta bot in a Slack thread made the bot answer every later message in that thread, including messages that did not mention it. A thread became "engaged" as soon as the bot answered once, and it stayed engaged until someone sent `!new`. Every message after that started a paid turn. A Telegram group behaved the same way, because Telegram keys the whole chat as one thread.

The product copy already promises the opposite: "Answers when mentioned." Mahmoud approved the behavior below in review on 2026-09-24.

Status: Implemented in PR #7128.

## What Changes

- In a shared space (a Slack channel thread, a Slack group DM, a Telegram group), a message starts a turn only when it is addressed: it mentions the bot or carries a `~agent` sigil, it is a command such as `!new`, or it answers a choice the agent has pending in that thread. Typing "Approve", "Deny" or the choice's number works without a mention, and so does clicking the button.
- An earlier turn in the thread no longer admits later messages.
- Messages that start no turn are still stored. When the bot is next addressed in that thread, its input carries every message posted since its last turn, and only those.
- A turn's input stops at its own addressing message. Anything posted after the mention belongs to the next turn.
- Every mention gets a turn, at most once per thread, whatever order the dispatches run in (a `!new` between a task retry and its first attempt can run it again: #7131). When messages arrive within about a second, context can repeat or be missing; that limit is deliberate and documented.
- A turn that provably never ran (REFUSED, or FAILED because the start never reached the workflow service) does not move the "since last turn" starting point, so the next turn still sees its messages. A failed turn that may have run does move it, so its input is never replayed.
- An answer to a pending choice (typed or clicked) goes to the parked interaction only. It is not sent again as conversation on the next mention.
- A 1:1 DM (Slack `im`, Telegram private chat) still answers every message.
- A mention in a thread a specialist agent holds still goes to that specialist.

## Out of scope

- No opt-in setting to restore "reply to every follow-up" behavior.
- No change to how edits, deletes, or other bots' messages are handled. The stored copy of a message stays as it arrived.
- No change to backfill.

## Capabilities

### New Capabilities

- `channel-turn-triggers`: Which inbound messages start an agent turn, per space kind, and what context that turn receives.

### Modified Capabilities

- `slack-agent-routing`: The specialist-continuation scenario now describes an addressed message. Selecting an agent no longer implies that the message starts a turn.

## Impact

Backend only: the trigger gate and `compose_input` in `api/oss/src/core/channels/service.py`, the range read in `fill.py`, the offset, range and consumed-flag methods in `api/oss/src/dbs/postgres/channels/dao.py`, and the inbox dispatcher in `api/oss/src/tasks/asyncio/channels/inbox.py`. The consumed marker is a new key in the existing `flags` JSONB column. No schema change, no migration, no API or client change, no frontend change.

Cost goes down. N chatty replies used to be N turns; now they are zero turns plus one larger input on the next mention. No new Slack or Telegram API calls.
