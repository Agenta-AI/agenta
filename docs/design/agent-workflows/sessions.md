# Sessions: today and tomorrow

A session is how a multi-turn conversation holds together across runs. This page explains
what a session is in the PoC today, why we built it the simple way on purpose, and the two
paths open to us tomorrow.

## What a session is today

Today a session is a `session_id` and the message history that goes with it. It is not a
live process kept warm between turns. Every turn is a fresh, cold run: the runner starts the
daemon, the adapter, and the harness, runs one turn, and tears all three down.

Because nothing stays warm, the conversation has to be rebuilt on each turn. This works by
**replay**. The playground holds the full message history and sends it back with every turn.
The runner takes that history, flattens the prior turns into a short transcript, and puts
the transcript in front of the new message before it prompts the harness:

```
Conversation so far:
user: what is the capital of France?
assistant: Paris.

Continue the conversation. The user now says:
and of Germany?
```

The transcript is capped (by `AGENTA_AGENT_HISTORY_MAX_CHARS`) so the replayed tokens stay
bounded on long conversations. The `session_id` rides along on the trace (as `session.id`
and `gen_ai.conversation.id`) and comes back on the result, so a follow-up turn can carry
it forward.

## The session is already a first-class object

Even though the lifecycle is cold, the port models a session as a real object. The workflow
handler does not call `invoke` directly. It calls:

```python
session = harness.create_session(config)
result = await session.prompt(messages)
await session.destroy()
```

`AgentSession` is the rivet-shaped abstraction described on the
[ports and adapters](ports-and-adapters.md) page. Under the cold model, `prompt` is a fresh
`invoke` that replays history and `destroy` is a no-op. The abstraction is stable. Only the
mechanism behind it is cold. This matters because it gives a future session store a clean
place to attach, with no change to the handler above it.

## Why we kept it cold on purpose

Rivet can do real, warm sessions. Its SDK has `createSession`, `resumeSession`, and the ACP
`session/load` call, all backed by a persistence driver. The usual way to continue a
conversation is to keep one daemon warm and replay events into it with `session/load`.

We chose not to do that yet. A warm daemon shared across runs reopens hard questions that
the cold model sidesteps: a per-session channel for secrets and trace context, and a
filesystem jail so two tenants sharing a daemon cannot read each other's files. The cold
model gives strong isolation for free, because each run is born and dies alone. For a PoC
that proves the agent workflow end to end, that trade is the right one.

The cost is the replay above. Replay spends tokens re-sending history, and it cannot restore
in-harness state that a transcript does not capture (a partly built plan, a tool's cached
result). For short conversations this is invisible. For long or stateful ones it is the
thing a warm model would fix.

## Tomorrow: two paths

There are two ways to grow past cold replay, and they are not the same.

**Path one: a server-side session store, still cold.** Keep one daemon per turn, but move
the history out of the playground and into the platform. A `SessionStore` (backed by the
backend database, or by a file for a standalone run) holds the event history. To continue,
the service replays the persisted history into a fresh cold sandbox, exactly as today, but
the platform owns the record instead of the client. This keeps the strong isolation of the
cold model and still gives durable, server-owned sessions. It is the smaller step, and the
`AgentSession` object is already the place it attaches.

**Path two: a warm daemon with `session/load`.** Keep a daemon alive between turns and use
the ACP `session/load` call to restore the real in-harness session, no transcript replay.
This is the richer model. It restores state a transcript cannot, and it opens the door to
`session/fork` for trying several variations of a turn. It also requires the per-session
secret channel and the filesystem jail we deferred, so it is the larger step.

The likely order is path one first, then path two if and when stateful, long-running agents
need it. Path one is an additive feature behind the existing port. Path two is a change to
the runtime model.

## The open question

Path one leaves one decision for the team: where the event history lives. The default
assumption is the backend database on the platform and a file for a standalone run, which
mirrors how the rest of Agenta splits platform storage from local runs. Settling that is the
first step whenever session persistence moves from "documented" to "built."
