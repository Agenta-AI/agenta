# Channels: decisions (v2)

Supersedes `../decisions.md`. Each entry states what is decided, and — where it
changed — what it replaces and why. Evidence for the reversals is in
`../scratchpad.md`, which cites the code and platform documentation behind each.

Decisions carried forward keep their original numbers. New ones continue the
sequence.

---

## Carried forward

**D1. Group conversations are shared.** **One thread is one session**, written
into by everyone present, with speaker attribution per message. The *thread* is
the unit the design names — a thread row points at exactly one session, and
where a platform has no native thread the unit degenerates to the space. The companion
safety rule — a reply visible to the group must never use resources only one
member may access — stays out of scope, and stays cheap to add later because all
credentials and tools enter a run through one resolution point.

*New surface to watch:* D6 introduces a per-agent-per-space restriction, so if
refusal is silent a user can probe which agents exist where. Minor, but it did
not exist when D1 was written.

**D2. The agent acts with the invoking user's permissions.** Unchanged. Channel
identity is linked to an Agenta account; the two deferred modes
(agent-own-identity, admin-provisioned service accounts) remain expressible
without schema change.

*Note from the research:* Linear solves the same problem differently — assigning
an issue to an agent makes it the **delegate, not the assignee**, so the human
keeps ownership. Worth knowing as an alternative if D2 ever proves heavy.

**D4. DMs are personal, spaces are shared.** Unchanged in substance; becomes the
`private | group | topic` taxonomy in D8.

**D6 (old). Continuity rides on the existing session subsystem.** Confirmed by
the codebase audit, and now **halved**: of the two gaps it named, only
server-side history hydration remains. See D11 — the `sender` field does not
land.

---

## Reversed

**D3. One platform app is one agent — REVERSED.**

The app is a **transport**, not an identity. One connection may front many
agents, addressed by slug; one-agent-per-app is the degenerate case of the same
schema, not a different mode.

*Why:* D3 as written forbids the gateway-bot shape (one shared `@Agenta` bot
fronting many agents) that the product explicitly wants alongside the
dedicated-bot shape. Both must be expressible, and they are — an empty roster
plus a default agent *is* the dedicated case.

*Cost:* nothing structural. The single-agent configuration behaves exactly as
D3 described.

**D5. Session lifetime is configuration — REVERSED.**

There is no idle TTL and no timer. Session lifetime is a **scope**
(`thread` or `message`) plus an explicit **user gesture** (`!new`).

*Why:* an idle timer silently forks a conversation into a new session at a moment
nobody chose, which is neither "always reuse" nor "always new" but an
unpredictable middle. The `generation` column existed only to implement that
middle.

*Note:* this reverses an explicit first-pass review call, and is flagged as a
reversal rather than presented as a gap.

---

## New

**D8. Spaces are `private | group | topic`.**

- **private** — a 1:1 conversation (Slack DM, Telegram private chat, Discord DM).
- **group** — an ad-hoc set of people with no identity of its own (Slack mpim,
  Discord group DM, Teams group chat, WhatsApp group).
- **topic** — a named persistent place whose membership outlives any
  conversation (Slack channel, Discord guild channel, Teams channel, Telegram
  supergroup).

The group/topic distinction is real and load-bearing: a topic outlives its
participants; a group *is* its participants. One-way broadcast surfaces are out
of scope.

**D9. Fill is not trigger.**

- **Trigger** — what starts a turn. Only explicit addressing: a mention, a
  command, a button, a delegation.
- **Fill** — everything else, which becomes conversation content without
  starting a turn.

"Always on" therefore means the agent **hears** everything, not that it
**answers** everything. This generalises D1's note about unlinked users into the
general rule.

Consequence: concurrency is a non-problem, since only triggers contend for a
turn and triggers are far rarer than messages. How fill is carried is D21.

**D10. Capability is static; permission is dynamic.**

- **Capability** — what a platform can do at all. Declared by the adapter, known
  in advance. Telegram has no history API; that is never a permission question.
- **Permission** — whether this install is currently allowed to. Changes in
  either direction at any time, discoverable mainly by trying.

So: **always attempt what the capability allows, and record failure per
thread, not per install.** A permission granted tomorrow starts working
without re-running setup; one revoked degrades without breaking. A one-time check
at install is wrong in both directions.

**D11. No `sender` field.**

Attribution splits: the displayed part is **formatting**, composed by the adapter
at the external→internal boundary; the structured part is **`created_by_id`**,
already recorded on the turn. Neither needs a new field on the wire, in storage,
or in replay.

*Cost:* the model sees `"Alice: …"` as text rather than metadata, and the web app
cannot render speaker chips for channel messages. Reversible if it matters.

**D12. Latest row wins; no generation counter.**

A thread's session history is append-only. The current session is the most
recent row. `!new` appends; `!use:` appends pointing at an earlier session. No
counter column, no index to maintain, and old rows keep their foreign keys.

**D13. Commands are triggers, with a channel-declared sigil.**

Core vocabulary: `!new`, `!stop`, `!sessions`, `!use:<id>`. Grammar is
`!command[:arg]` —
colon rather than space, so the command token stays self-contained and everything
after it is the message the agent receives.

The sigil characters are declared per channel, because `@` is destroyed by Slack's
autocompletion and `/` collides with native command surfaces on Slack, Discord
and Telegram. Where a platform has a native command mechanism, it may register
aliases producing the same internal command — core sees one command event either
way.

*Why a text convention at all:* no platform offers a usable native command inside
a conversation. Slack forbids slash commands in threads outright; Telegram's
command scopes cannot address a topic; Teams has no native gesture. Dify, Coze
and Lark all reached the same answer independently.

**D14. `!sessions` lists this thread's own history.**

Not the project's sessions and not the user's. This makes the authorisation
question trivial — every entry already belongs to a thread the user is
present in — and matches what someone actually wants ("what were we talking
about here"). Pulling a session in from elsewhere is a different feature with a
harder authorisation story, deferred.

**D15. Cross-channel shared sessions are not supported.**

Agenta ↔ one channel continuity is free and valuable (both are surfaces on one
session). Channel ↔ channel is not: two groups in two places writing into one
conversation, each seeing replies to messages they cannot see, is confusing
rather than continuous.

The genuine want in that neighbourhood — mirroring a discussion across surfaces —
is **outbound fan-out**, which the outbox already supports as N rows for one
source event. It needs no shared session.

**D16. Nothing platform-specific in core.** Core stores opaque values and reads a
capability declaration; adapters translate in both directions. First-party and
bridge adapters differ only in how they are reached (process call vs wire call) —
same interface, same declaration, same core.

---

**D17. Refusal names what was asked for, never why it failed.**

When someone addresses an agent that is unavailable, the reply is *"No agent
named `finance` is available in this space"* — identical whether the slug does
not exist at all, exists but is not in this connection's roster, or is in the
roster but not granted here. One sentence for all three, so nothing is
enumerable.

Echoing the requested name back is not a leak: the user just typed it. What
would leak is *differentiating* — "not granted here" versus "no such agent" is
exactly what tells someone which agents exist where. Naming the slug also makes
the common case useful, since a typo is reflected back rather than met with a
generic refusal.

**D18. The default posture is configuration, not architecture.**

Whether a new space starts mention-only or with follow-ups enabled is a global
setting naming one of the enum's values, applied as the default when a space row
is created. Per-space overrides work regardless, and the default can change
later without a migration.

This was carried for a while as an open product question. It is not one: it is a
default value.

**D19. The contract carries fetch from the start, whether or not any channel uses
it.**

"Does history fill ship in the first pass" is a contract-completeness question,
not a feature question. The flows are the same shape whether an adapter is
reached in-process or over the wire, so the fetch operation belongs in the
contract from the beginning — adding an operation to a published contract later
is the expensive move. Whether a given adapter *implements* it is what the
capability declaration answers, and Telegram simply declares it unsupported.

**D21. Fill accumulates in the inbox; a trigger drains it.**

Unaddressed messages are not written into the session as they arrive. They stay
as inbox rows. When a trigger arrives, the worker collects everything for that
thread since the previous trigger and invokes **once**, with all of them as
new messages in a single turn.

This is simpler than streaming fill into the session, and it removes a
constraint: there is no ordering race between filling and triggering, because the
session only ever advances on a turn. It also means fill costs nothing until
someone actually addresses the agent.

**D22. Invoke is detached, which makes published session events a hard
dependency.**

An attached call would block a worker for the length of a turn and lose it on
restart. Detached invoke already exists and runs genuinely survive the caller
disconnecting.

The consequence is that nothing is watching the turn, so everything the channel
renders must be pushed — and today nothing is. Neither turn completion nor
interaction creation publishes anything, and the platform's event vocabulary
contains no session events at all. **Publishing them is the one dependency this
design cannot ship around.** Polling is the interim fallback.

**This is the first pass's build-plan step 1, retained** — that design named the
event types, sized the work at days, and listed it first precisely because it
unblocks push delivery to any surface. Two corrections.

**The events are turn-started and turn-ended, not interaction-created and
turn-completed.** A batch response is a fold over a turn's events:
`sdk/agents/fold.py` is a pure function over an iterable, returning
`{messages, stop_reason, pending_interaction}`. It already decides which events
count, and already surfaces a pending approval when the turn paused. So there is
no separate interaction signal to design — approvals and answers come out of one
function. What is genuinely needed twice is the *start*, so a surface can show a
working indicator, and the *end*, so it can be replaced by the result.

**It is an internal queue, not the webhook subsystem.** Webhooks deliver to
customer URLs, with subscriptions, signing, retries and delivery logs — none of
which an in-process consumer needs. The turns service publishes to an internal
queue of the kind records and tracing already use. Whether these later also
become customer-facing webhook types is a separate decision.

Net: two publishes and a consumer.

**D23. Loop hygiene is `!stop`, not an exchange counter.**

A bot-to-bot counter guesses at intent and is wrong in both directions: it blocks
legitimate agent-to-agent work, and does not help when a human-driven loop runs
away. An explicit stop command is visible to whoever is watching and maps onto
the runtime's existing cancel. Adapters still mark bot-authored messages so the
domain never treats its own posts as input.

**D24. A reset mid-turn lets the running turn finish.**

`!new` while a turn is in flight appends a new thread row; the running turn
completes and posts against its own session. Cancellation is a different gesture
and stays that way. The transcript remains coherent even though the thread will
briefly show a reply belonging to the previous session.

**D25. Policy is stated at three levels and intersected, never overridden.**

The same optional `policy` document hangs off `channel_agents` (rules about the
agent wherever it runs), `channel_spaces` (rules about the space whoever acts
there) and `channel_grants` (rules about that pair only). Fields absent at a
level mean *no opinion*, not false.

Resolution starts from the **channel defaults** — supplied by the adapter, not by
the generic `gateway_connections` row, which carries no routing policy — and lets
every level that spoke constrain the result: a stated `false` wins, sets
intersect, the narrower enum wins. **A thing happens only if every level that spoke about it allows it.**

*Why:* the alternative — a precedence order where the most specific level wins —
makes it possible for a narrow rule to re-enable something an operator disabled
broadly, which is the failure a policy system exists to prevent. There is no
override flag, deliberately: an escape hatch is what makes a policy system
unable to explain its own behaviour.

*Cost, accepted:* you cannot re-permit narrowly what was denied broadly. The fix
for an over-blunt global rule is to unstate it and state it per space — a
configuration change, not a semantics change.

Resolution is a pure function computed at routing time and never stored; it
returns which level decided each field, so the configuration UI can explain a
setting rather than showing a checkbox that silently does nothing.

**D26. The inbox is a log per space, plus a consumer offset per agent.**

`channel_inbox_events` is the **log**: what was said in a space, in order, deduped
on `(connection_id, external_id)`, carrying nothing agent-specific. Every agent in
the space reads the same rows.

`channel_inbox_triggers` are the **offsets**: one row each time an agent is
*actually addressed*, keyed `(thread_id, event_id)` and carrying the `turn_id` it
started. Append-only, so the latest row is that agent's position (D12).

*Why:* two agents in one space do not share a session (D1). Mention `~triage`, then
`~deploy`, in one Slack thread: `~deploy` starts and runs; `~triage` is undisturbed
and will see the `~deploy` message next time *it* is addressed. Each needs its own
position in one shared history — a consumer-group offset, not a queue.

*Fill is derived, never stored.* What an agent has yet to see is
`WHERE space_id = :space AND (origin, id) > :offset`. An unaddressed message
writes **nothing** beyond its log row.

*Backfill extends the log backwards, per space.* The first agent addressed in a
space fetches the platform's history and appends it with
`origin = PULLED`; every later agent reads those same rows rather than
refetching. A Slack thread has one history.

*`origin` carries the ordering.* Backfilled rows are inserted after pushed
rows but represent older messages, so `uuid7` alone sorts them wrongly. The enum
partitions the log and `id` orders within each partition — no maintained counter, no
platform timestamps written into `created_at`.

*Consequence:* **agent-to-agent conversation works with no special path.** An
agent's post is an ordinary outbox delivery, echoed back as an ordinary log row; if
it addresses another agent, that agent gets a trigger row and runs. Safeguards are
the existing ones: adapters mark bot-authored messages, and `!stop` is the hygiene
mechanism (D23).

*Replaces an earlier draft of this design* that wrote one row per agent present per
message, flagged `is_trigger` true or false. That was N rows to record mostly
nothing; the flag was true in every row that mattered; and it made fill per-agent
when fill is per-place. The outbox needs no equivalent — it is already per-thread.
Inbound is *one log, many readers*; outbound is *one intention, one post*.

**D27. Four identifiers around a delivery, never conflated.**

| identifier | minted by | read by | stable across | job |
| --- | --- | --- | --- | --- |
| `id` (uuid7) | us | us | the row's whole life | identify the **row** |
| `key` (uuid5, stored) | us | us | the row's whole life | identify the **item** |
| `idempotency_key` (uuid5, not stored) | us | **the platform** | retries of one send | identify one **request** |
| `external_locator` | **the platform** | us | once posted | address the message to edit it |

```python
key      = uuid5(_CHANNELS, f"{thread_id}:{turn_id}:{item}")   # item not stored
idempotency_key = uuid5(_CHANNELS, f"{key}:{updated_at.isoformat()}")
```

*Row, item, request are three different questions.* The row is where we keep state;
the item is what we are sending; the request is one attempt to send it. Collapse any
two and something breaks:

- A **moving row id** → at turn end we cannot find the row, have no receipt, and
  post a second message. "working…" stranded above a duplicate answer.
- A **static wire token** → the edit carries the same `Idempotency-Key` as the
  original post, and a platform honouring the header drops it as a duplicate. The
  message stays "working…" forever.
- **No item key** → the natural key spreads across three columns, and nothing can
  look up "item 2 of this turn" without reconstructing a recipe.

*Row ids are plain `uuid7`, like every other non-special id.* `trigger_deliveries`
does exactly this. The derived id in `webhooks` is the exception, and it works
*only* because a webhook delivery is insert-only and posts **once**, so its id can
serve as its single wire token. An outbox row makes at least two distinct calls —
`chat.postMessage` then `chat.update` — so the roles must separate.

**This is the shape the existing delivery tables should have used**: a `uuid7` id,
an explicit derived key column for the item, and the wire token built from that key.

*The token is derived rather than stored, and that is safe because both inputs are
committed columns.* A worker crashing between composing and sending re-derives the
identical token on restart.

*The receipt is a locator, not an id.* Editing needs `(channel, ts)` on Slack,
`(channel_id, message_id)` on Discord and Telegram. Only Slack's is a lone string,
and modelling on that accident would make every other adapter concatenate and
re-split. Same structured-truth argument as `external_locator` on spaces and
threads.

Where a new **item** is correct: three messages from one turn are items
0/1/2 — three keys, three rows, three posts, each independently editable.

*The item index is not a column.* It exists only as the loop index while the worker
walks `fold()`'s output, which is the only moment a key needs computing. Ordering
does not need it — the `uuid7` id is time-ordered and `created_at` is explicit — and
`key` covers the one question that ordering cannot answer: *does this item
exist yet?*, asked on a re-run about a row that may never have been written.

**D28. One posted message is one outbox row, for its whole life.**

There is no `attempts` column anywhere. TaskIQ owns retrying — `retry_count`
travels as a task parameter, bounded by `WEBHOOK_MAX_RETRIES` — and retries write
nothing; only the terminal attempt records anything. `Status` carries the code,
message and error.

*Where channels diverges from `webhook_deliveries`:* that table is insert-only,
because a webhook is fire-and-forget. A channel delivery has a **receipt**, and
editing a progress message into the final answer means calling the platform's
update API with the message id it gave us. So the outbox row is **updated in
place**: `PENDING` → `SENT` + `external_locator` → edited content, same row
throughout, found by its stored `key` (D27) — never by re-deriving the id, which is
an arbitrary `uuid7` precisely so that it does not move when the row does.

**An edit is therefore not a second outbox event.** Two rows appear only when a
turn emits two genuinely distinct messages — items 0 and 1, each
independently editable. The test is *"a different thing, or the same thing
later?"* Different thing → new row; same thing later → same row.

*Why not append a row per version:* every version would be a new identity, so
every version would post a new Slack message instead of editing the existing one.
That is the same defect as the first cut's `:rendered:v2` key suffix.

**D29. The default agent is a flag on the grant.**

*"Which agent answers here when nobody is named"* is a fact about an agent **in a
space**, which is exactly what a `channel_grants` row is. So it is
`flags.is_default` on the grant, with a partial unique index giving at most one
default per space. The connection-wide fallback is the same flag on
`channel_agents`, scoped per connection.

*Replaces:* `default_agent_id`, then `default_agent_slug`, on `channel_spaces`.

*Why:* the space version needed a write-time check that the named agent was
actually granted there — an invariant enforced by code. On the grant it is enforced
by structure: the grant's existence *is* the permission, so an ungranted default
cannot be expressed. It also removes a duplicate identifier, since the grant
already carries `agent_id`.

Resolution reads: sigil → the space's default grant → the connection's default
agent. One mechanism at two scopes, instead of a slug on one table and a flag on
another.

**D30. The one-time history fetch is guarded by a flag on the space, not by a row
count.**

`flags.is_backfilled` on `channel_spaces` records that the platform's history API has
been asked, once, for that space. It is set only after a fetch the platform actually
answered — including one that answered with nothing — and a refusal leaves it false.

*Replaces:* `backfill_state: attempted | unavailable | denied` on `channel_threads`,
and the intermediate idea that *"does this thread have a trigger row"* answers the
question.

*Why not a row count:* a successful fetch can legitimately return nothing — a brand
new thread whose first message is the mention has no history. Counting `PULLED` rows
cannot tell *fetched and empty* from *not fetched*, so every later agent's first
trigger would refetch, against a platform that may be capped at 15 objects per
minute, and get nothing every time.

*Why per space rather than per thread:* history belongs to the place. Two agents in
one Slack thread read the same backfilled rows and must not be able to disagree
about what was said.

*Why a refusal must not set it:* D10 requires that a permission granted later starts
working without re-running setup. The flag remembers *"we have the history"*, which
is durable; it must not remember *"we were not allowed to ask"*, which was true only
at one moment. The refusal is recorded on the trigger row's `Status` as diagnosis.

The same flag name appears on the trigger row at a different grain, recording whether
*that turn's* input included fetched history. Both are needed: the space flag stays
true forever after the first fetch, while only the first turn carries the record.

**D31. The four layers follow the house conventions literally, including the ones
that look like boilerplate.**

The stack sections were first written as sketches — `create_agent(...)`, a bare
`class X(Exception)`, a list of route paths. Held against `triggers`, each sketch was
missing something that carries meaning rather than ceremony:

- **DAO methods** are `@abstractmethod`, keyword-only, and take `project_id: UUID`
  first. Tenant scope is structural rather than a filter someone remembers. The one
  unscoped method (`get_project_and_connection_by_external_id`) is unscoped because
  an inbound platform event carries no tenant, and it says so in its docstring —
  exactly as `get_project_and_subscription_by_trigger_id` does.
- **Exceptions** derive from one domain base and set `self.message` plus the
  identifying attribute. The router reads `.message` at the boundary, so an exception
  without one loses its diagnosis on the way out.
- **Wire models** wrap the core DTO in a named envelope (`{"agent": {...}}`) rather
  than posting it bare, so a later sibling field is additive. Responses always carry
  `count` alongside the entity.
- **Routes** name an `operation_id` — it becomes the generated SDK method name, so it
  is API surface — and a `response_model` with `response_model_exclude_none=True`.
- **`*Create` drops `Identifier` and `Lifecycle`**, so a caller can neither choose an
  id nor backdate a row. **`*Edit` drops the immutable columns**, so reparenting an
  agent to another connection is unexpressible rather than merely discouraged.

*Why record this as a decision:* three tables here are written only by routing and by
workers, and the conventions are what make that structural. Threads, inbox events and
outbox events get no `*Create` wire model and no create route, so there is no way to
forge a conversation through the API — a property that comes from following the
pattern, not from a check.

---

## Open — product calls

*(none outstanding — P1 became D18, P2 became D19, P3 became D17, P4 became
D24.)*

The remaining judgement calls are recorded inline where they arise rather than
held as a separate list: which channels to build first, and how much of the runner's
input-sequencing work to take before channels ships against plain retry.
