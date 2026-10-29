# Design

## Context

Every inbound message is stored in the channels inbox and attached to its space, including messages that start no turn. `ChannelsService.resolve` then decides whether the message starts a turn. The decision is made by `_is_trigger`, the trigger gate.

Before this change, the gate admitted a message in three cases:

1. The space is a 1:1 DM (`ChannelSpaceKind.PRIVATE`).
2. A `channel_threads` row for this thread and agent exists and is active.
3. The effective policy's triggers match: a mention or sigil (`MENTION`), or a parsed command (`COMMAND`).

Case 2 caused the bug. The first mention in a thread creates an active thread row, and only `!new` closes it. So after one mention, every message in the thread passed the gate.

The approval flow relied on case 2 as well. A typed answer to a pending choice, such as "Approve" or "2", is not a mention. It was admitted only because a pending choice exists only on an active thread.

The input for a turn comes from `compose_input`. It calls `select_forwardfill_range`, which reads the thread's latest trigger row through `fetch_latest_trigger` and returns every space event after that trigger's event. `_filter_thread_events` then keeps only events under the same thread key. With case 2 in place, every message was its own trigger, so the range usually held a single message.

## Decisions

### Remove the active-thread admission

`_is_trigger` no longer looks at the thread row. For a space that is not PRIVATE, only an addressed message, a command, or an answer to a pending choice passes.

Alternatives considered:

- Keep the admission behind a new `reply` trigger kind that a team can opt into. Mahmoud ruled this out of scope. It needs an enum change, a client regeneration and a UI switch.
- Fetch the thread from Slack with `conversations.replies` at turn time. It would see edits and other bots' posts, but it adds a Slack call per turn under tight rate limits for non-Marketplace apps, and it would still need the inbox as a fallback.

### Admit an answer to a pending choice explicitly

`resolve` already computes `resolved_token` from the thread's pending choice before the gate runs. The gate now takes `resolved_token` in place of the thread and admits the message when it is set. A click (an `ACTION` event) never reached the gate, so it is unchanged. A typed label or number now passes the gate for its own reason, not because the thread happened to be active.

### Keep the 1:1 DM rule and the specialist routing

A PRIVATE space still admits every message. A Slack group DM (`mpim`) is classified as GROUP and a Telegram group as GROUP, so both follow the shared-space rule. `_agent_holding_thread` still selects the agent that holds the thread for a message without a sigil. It only picks the agent; the gate decides whether the message starts a turn.

### Context since the last turn needs no new mechanism

Unaddressed messages are already stored and attached to the space. Once they stop being triggers, the range between two trigger rows holds exactly the messages posted since the previous turn. Mention M1, five messages, mention M2, three messages, mention M3: the turn for M2 receives the five and M2, and the turn for M3 receives the three and M3. The session holds the earlier turns, so nothing is sent twice.

### Only turns that provably never ran leave the offset in place

`fetch_latest_trigger` skips two kinds of trigger:

- REFUSED. The dispatcher settles a trigger REFUSED only after the runner refused the start on every attempt with `session_turn_in_use` and the message could not queue. Nothing ran.
- FAILED with status code `never_sent` (`CHANNEL_TRIGGER_NEVER_SENT`). The dispatcher records that code only when the invoke raised `WorkflowDetachedStartNeverSent`, which the workflow client raises when the response proves the workflow service never saw the request.

Every other trigger counts, including any other FAILED one. An invoke that raised after the request landed (a connection reset while reading the start frame) may have run the turn. Replaying its input on the next mention could repeat the agent's actions, so the offset moves past it as it did before this change. STARTED counts because a turn in flight has taken its input. A queued turn settles as SETTLED, so it counts too.

Alternative considered: skip every FAILED trigger. Codex's review showed this replays input that may already have run.

### The range stops at the addressing message

Before, `select_forwardfill_range` had only a lower bound. A message stored between a mention's `resolve` and its `compose_input` went out with that mention and again with the next one. The range is now `(offset, addressing event]`: `query_events_since` takes `through_event_id`, and the offset is the latest counted trigger on an event before the addressing event (`before_event_id`), ordered by event rather than by trigger id.

### Every addressed message gets its own turn; context under concurrency is best effort

Dispatch tasks run concurrently, and an event joins its space only inside `resolve`, so a turn's range sees only events that were already dispatched. Three Codex review rounds found races in that. The fixes kept adding machinery: a per-conversation advisory lock, a step that attached late arrivals, time windows, and a record of which events each turn carried. Each fix exposed the next case. Under the simplify guidance, the design now removes the one rule that could lose a turn instead of guarding it.

The rule that was removed: an addressed message could be skipped because a later turn "already carried" it. That skip was the only way a mention could vanish. Every observed drop came from a wrong "carried" inference (a DM filter, a cutoff, dispatch order). Now every addressed message opens its own turn. The only dedupe is the unique `(thread, event)` trigger, which also makes a redelivered event a no-op. Anything that can still fail (the sender's identity lookup) runs before that trigger is claimed, because a claimed trigger makes the task retry return early. A `!new` between a task retry and its first attempt moves the retry to a new thread row, where it can run again; that is rare, already happens on the base branch, and is tracked in #7131. Nothing is locked or serialised, and there is no late-attach step and no record.

What remains is simple and local to one turn: the range is `(latest counted trigger on an earlier event, this event]`.

**Deliberate limit.** When messages in one thread arrive within about a second of each other and their dispatches run out of order, a message can reach two turns as context, or no turn (it was not yet attached to its space when a later turn read its range). No turn is dropped, and no turn runs twice in the same thread. Context is recoverable (mention the bot again); a lost or doubled turn is not, so the guarantees go there. The known cases:

- A later mention runs first: it carries the earlier mention and the messages before it, and the earlier mention then runs with the messages before it again.
- An unaddressed message dispatched after a later mention composed may never appear as context.
- In a DM, a message dispatched after a later one runs as its own turn after it.
- An approval answer in flight at the moment another mention composes can appear once as text in that turn.
- A handled answer that is re-dispatched after its pending choice cleared runs once as an ordinary turn. The ingress dedupes platform redeliveries on the event's external id; this needs a task retry after the answer was admitted.

Serialising dispatch per conversation (an ordered queue or a single consumer keyed at ingress) would remove the limit. It is new infrastructure, and it would fix context only; it is worth adding if users report missing or repeated context.

### Answers to a parked choice are marked consumed

`_answer_interaction` sends only the decision to the parked interaction. Before, the answer event stayed in the inbox as an ordinary message, so the next mention received "Approve" again, or a button's raw token. The dispatcher sets `flags.is_consumed` on the answer event before it sends the decision. If the mark fails, the task retries with nothing admitted yet. The mark is idempotent, so a retry repeats it harmlessly. `compose_input` drops consumed events and every `ACTION` event (a click is a token, not words) unless it is the addressing event itself. The offset does not move, so unrelated messages around the answer still reach the next turn.

## Risks

- A user who got used to chatting with the bot in a thread without mentioning it now has to mention it. This is the intended behavior and matches the product copy.
- Stored messages are sent as they arrived. An edited or deleted message is sent with its original text. This was already true. It matters more now that turns carry more context. Edits and deletes remain out of scope.
- Posts from other bots are never stored, so they never appear as context.
- REFUSED means only "the runner refused an overlapping turn". Its text reaches the next turn as ordinary input, so a request that was refused for being busy can be acted on during the next mention. This is the approved behavior.

## Verification

- Unit tests in `api/oss/tests/pytest/unit/channels/test_channels_service_routing.py` cover the gate per space kind, a typed approval without a mention, the specialist routing, Telegram groups through the real Telegram adapter's parse, and the context range (M1, five, M2, three, M3) and the failed-turn carry-over through `resolve`, `compose_input`, `open_turn` and `settle_turn`.
- `api/oss/tests/pytest/unit/channels/test_channels_turn_context.py` drives the real service and the real `InboxDispatcher` over an in-memory inbox (`turn_harness.py`): a message arriving mid-compose, the queued M2 and M3 payloads, a response lost after delivery, a start never sent, a refused turn, a failure after a later turn began, forwardfill after typed, numbered, clicked and stale answers, and every dispatch order Codex found (concurrent mentions with a redelivery, an earlier mention dispatched late, a DM message dispatched after a later one, a mention delayed for hours). Each asserts that every mention runs exactly once.
- Integration tests against Postgres in `test_channels_service_routing_dao.py`, `test_channels_dao_triggers.py` and `test_channels_dao_inbox.py` pin the offset rules, the event ordering, the range bound and the consumed flag, and run the context scenarios and real concurrent dispatches through the real DAO.
