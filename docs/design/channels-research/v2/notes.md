# Channels: notes

Working notes that do not belong in the state documents. Two kinds live here:

- **Replaced designs** — a shape that was proposed, found wrong, and superseded.
  Kept because the failure is instructive: a reader who arrives at the same idea
  independently should find out here why it does not work, rather than rediscovering
  it. If a replacement is load-bearing enough to constrain future work, it is a
  decision instead (`decisions.md`).
- **Open questions and observations** — things noticed while designing that have no
  home yet: platform quirks, risks, work the design assumes but does not specify.

Everything else — the model, the flow, the plan — is stated as *what is*, in
`entities.md`, `architecture.md`, `capabilities.md`, `channels.md`, `contract.md`
and `plan.md`. Those documents carry no history.

---

## 1. Replaced designs

### The inbox as a per-agent queue

**Was:** one `channel_inbox_events` row per agent present per message, each carrying
`is_trigger` true or false, plus `turn_id`, `thread_id` and `status` on that row.

**Why it failed:** three separate ways.

- **N rows per message** in a space with N agents, most of them recording that
  nothing happened.
- **`is_trigger` was never meaningfully false.** If a row is written only when an
  agent is addressed, every row is a trigger and the flag carries no information.
- **It made fill per-agent when fill is per-place.** Two agents in one Slack thread
  see the same history because it *is* the same history; copying it per agent
  asserted they could disagree.

**Replaced by:** a log per space plus a consumer offset per agent (D26).

### `log_index`, and faking `created_at`, for backfill ordering

**Was:** two attempts at ordering backfilled messages, which are inserted after
pushed rows in wall-clock terms but represent older messages.

**Why both failed:** `log_index` is a maintained counter, contended on insert, and
needs a writer nobody wanted to own. Writing platform timestamps into `created_at`
overloads a house column that means *ingest time* everywhere else in the codebase,
and platform clocks are not comparable across channels anyway.

**Replaced by:** `origin` partitioning the log with `uuid7` ordering within each
partition, so `ORDER BY origin, id` is the true sequence at no upkeep (§2.4 of
`entities.md`).

### `backfill_state` on the thread

**Was:** `backfill_state: attempted | unavailable | denied` on `channel_threads`.

**Why it failed:** per-thread when history is per-space, so two agents in one thread
could disagree about the same history. And an enum encoding *why* an attempt failed,
read by callers who only ever ask *whether* to fetch.

**Replaced by:** D30 — a flag on the space, with the three values scattered to the
capability declaration, `Status`, and a per-turn flag.

### `default_agent_id`, then `default_agent_slug`, on the space

**Was:** the space naming its default agent, first by id and then by slug.

**Why it failed:** it needed a write-time check that the named agent was actually
granted in that space — an invariant enforced by code that structure could enforce
instead. The slug variant additionally stored the same fact twice in two forms,
which is how a space ends up pointing at an agent that no longer exists.

**Replaced by:** D29 — `flags.is_default` on the grant.

### `operation`, and a version suffix on the outbox key

**Was:** an `operation: create | update` column, and keys shaped
`interaction:<id>:rendered:v2`.

**Why it failed:** `operation` duplicates what the lifecycle columns already carry.
The version suffix put the version in the **row identity**, so every re-render became
a new row and therefore a new posted message — the exact failure D27 and D28 exist to
prevent. The suffix existed only to support re-rendering approval cards through this
table, which is not a concern here.

**Replaced by:** D27's four identifiers and D28's one-row-for-its-whole-life.

### A null slug marking the default agent

**Was:** one row per connection with a null `slug`, marked as the default by that
null plus a partial unique index.

**Why it failed:** `SlugDBA` makes the column not-null, so it cannot be expressed —
and it should not be revived even where it could. Encoding "this is the default" as
the absence of a name is a clever trick standing in for a statement that deserves to
be made.

**Replaced by:** `flags.is_default` at two scopes (D29).

### An always-on gateway service

**Was:** channels as its own long-lived service, justified on two grounds — that
Socket Mode requires holding outbound WebSockets open, and that per-thread queues
need a single owner.

**Why it failed:** neither ground holds. Agenta already accepts public inbound
webhooks (the Composio and Stripe receivers are live, public, exempt from auth
middleware and routed by the standard proxy), so an egress-only posture was never
Agenta's posture and Socket Mode is not forced. And the queue belongs to the runner,
not to channels.

**Replaced by:** an ingress route plus two workers plus a domain, on machinery that
already exists (`architecture.md` §2).

### A dial-out WebSocket as the bridge transport

**Was:** the wire contract specified a dial-out WebSocket, justified by an
egress-only posture.

**Why it failed:** the same reason as above — that posture was never Agenta's, since
public webhook receivers already exist and are already routed. With the justification
gone, HTTP is the simpler default.

**Replaced by:** HTTP (`contract.md` §3).

### Two other third-party adapter distribution models

Both were considered for how someone outside the team ships an adapter, and both were
rejected in favour of the wire contract. Worth recording because each will be
re-proposed by someone who has not weighed the cost:

- **In-tree contributions** — they send a pull request adding an adapter. Rejected:
  it couples them to our release train and puts maintenance of code we cannot test on
  us. The studied precedent died of accumulated adapter rot across thirty protocols.
- **In-process plugins** — a package our process loads. Technically workable, and
  there is an existence proof of a vendor-maintained plugin for exactly the WeCom
  case. Rejected because a loaded plugin is code execution inside the process holding
  every platform token: RCE-equivalent trust. The cautionary tale is a plugin
  registry incident involving hundreds of malicious packages.

### Two security claims that were not true

**Was:** an "egress-only, no inbound ports" posture, and a promise that an agent
ingests only the conversation it is part of.

**Why both failed:** the first is not true of Agenta and would not have been true of
channels — public webhook receivers already exist. The second is in direct tension
with the behaviour users actually want (an agent that can read the thread it was
invited into) and with the permission model every platform offers.

**Replaced by:** the posture stated in `architecture.md` §8, which claims neither.

### A message bus between core and the adapters

**Was:** implied by an exception named `ChannelBusNotSupported`.

**Why it failed:** no bus was ever designed or needed — core calls the adapter port
directly. The name was the only trace it left, and it sent readers looking for a
component that does not exist.

**Replaced by:** `ChannelNotSupported`, which names the actual condition: this channel
key has no registered adapter.

---

## 2. Open questions and observations

### The Slack rate-limit split is a support problem, not a design one

`conversations.history` and `conversations.replies` are Tier 1 (roughly 15 objects
per minute) for commercially distributed apps outside the Marketplace, and 50+
requests per minute with a 1,000-object limit for internal or custom apps. The same
adapter code faces both, and which one an install gets depends on **how the operator
registered their app** — something no per-channel constant can express.

The design accommodates it by asking for `AGENTA_CHANNELS_BACKFILL_LIMIT` and taking
what it gets. The open part is user-facing: an operator on the tight cap will see
short backfills and needs to be told why, in the product rather than in a doc.

### Retention will be forced by channels

Agenta has no operational retention today. A busy space with forwardfill on ingests
every message whether or not an agent was addressed, which is a volume profile
unlike any existing operational table. `entities.md` §10 states the position; the
observation worth keeping is that this is the domain likely to make retention
urgent, and the `raw` payload field is the part that makes it urgent soonest.

### Input sequencing during an active turn

A message arriving while a turn is running is appended to the log and picked up by
the next trigger. Whether the runner should instead accept it into the active turn is
a real question, deliberately left out of scope: channels ships against plain retry,
and taking the runner's input-sequencing work is a product call recorded in
`plan.md`.
