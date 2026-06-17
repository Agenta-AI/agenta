# Ports and adapters

The [architecture](architecture.md) page showed the relay of programs. This page shows the
seam that keeps that relay swappable. It explains why the seam exists, what shapes it
defines, and how the service picks an engine and a transport at run time.

## The problem the seam solves

We want three things at once. We want to run more than one coding agent (Pi today, Claude
Code today, others later). We want to run them in more than one place (local today, Daytona
today, other sandboxes later). And we never want either choice to leak into the workflow
code that sits above it.

A neutral port solves this. The Python service talks to one small interface. Everything
agent-specific and place-specific lives in adapters behind that interface. Rivet, which
does most of the heavy lifting, is one adapter behind the port, not the port itself. That
keeps the door open for a future agent that rivet cannot drive (see the
[Claude Code adapter](adapters/claude-code.md) page for how a non-rivet engine would slot
in).

We learned the shape of this port by studying the rivet SDK. Rivet splits its surface into
three planes, and that split is the main lesson:

| Plane | What it covers | In our port? |
| --- | --- | --- |
| Runtime / sandbox | Where the agent runs, and its lifecycle | Yes, as the **Environment** seam |
| Agent session | The prompt, the config, the event stream | Yes, as the **Harness** and **AgentSession** seams |
| System | Filesystem, process, desktop control | No. This is provisioning, used only inside an adapter, never shown to the workflow author |

The first two planes became our two seams. The third we keep out of the port on purpose: a
workflow author configures an agent, not a filesystem.

## Seam one: the Environment (where it runs)

The `Environment` seam answers one question: where does the harness process run? The
`LocalEnvironment` runs it as a subprocess on this host. It has a `start` and a `dispose`
lifecycle and one real method, `exec`, which runs a command and feeds it the request on
stdin.

Daytona does not need a separate Python `Environment`. The rivet engine selects the Daytona
sandbox inside the TypeScript runner, below the port, so "run on a cloud machine" is an
adapter detail rather than a second Python class. The `Environment` seam stays thin on
purpose.

## Seam two: the Harness and the AgentSession (the conversation)

The `Harness` seam is the heart of the port. It is the agent engine, and rivet and the
legacy Pi path are both adapters behind it.

```python
class Harness(ABC):
    async def setup(self) -> None: ...
    async def shutdown(self) -> None: ...
    async def invoke(self, request, *, on_event=None) -> AgentResult: ...
    async def destroy_session(self, session_id) -> None: ...   # cold: a no-op
    def create_session(self, config) -> AgentSession: ...
```

`invoke` is the single transport call: one cold run in, one structured result out. On top of
it sits the `AgentSession`, the first-class abstraction borrowed from rivet:

```python
class AgentSession:
    async def prompt(self, messages, *, on_event=None) -> AgentResult: ...
    async def destroy(self) -> None: ...
```

The workflow handler always works through the session: `create_session(config)`, then
`session.prompt(messages)`, then `session.destroy()`. Under the cold model the session
holds no warm daemon, so each `prompt` is a fresh `invoke` that replays the supplied
history. The abstraction is real and stable even though the lifecycle behind it is cold.
[Sessions](sessions.md) explains why we kept it cold and what a warm session would change.

## The engine is config, not a class

A reader expecting three Python classes (one per agent) will be surprised. There are two
*transports*, and the *engine* is a value they pass, not a class hierarchy.

The two transports differ only in how they reach the TypeScript runner:

- **`SubprocessHarness`** spawns the runner's CLI through an `Environment` and hands it the
  request on stdin. This is the local, no-Docker path.
- **`HttpHarness`** sends a `POST /run` to the sidecar. This is the deployed path.

Each transport carries a `backend` value (`rivet` or `pi`) that tells the runner which
engine to use. So the choice of *agent engine* is one string on the wire, and the choice of
*how Python reaches the runner* is the transport. Collapsing the engine into config is what
replaced the old `PiHarness` / `PiHttpHarness` / `RivetHarness` trio with two transports
and one wire contract.

## How the service picks an engine and a transport

The handler makes both choices on every request, in `agent/app.py`.

It picks the **engine** with `select_backend(harness, sandbox)`. The rule is simple: use
`rivet` when `AGENTA_AGENT_RUNTIME=rivet` is set, or when the harness is anything other than
`pi`, or when the sandbox is anything other than `local`. The legacy in-process Pi engine
only knows how to run Pi locally, so any Claude or Daytona selection forces `rivet` rather
than silently dropping the choice.

It picks the **transport** with `build_harness(backend)`. If `AGENTA_AGENT_PI_URL` is set
(the Docker deployment), it uses `HttpHarness` against the sidecar. If it is unset (a local
checkout), it uses `SubprocessHarness` and spawns the runner directly.

Engine and transport are deployment concerns. Harness and sandbox are workflow config. The
seam keeps the two kinds of choice from tangling.

## The wire contract: one `/run` shape

Both transports send the same camelCase JSON and parse the same result back. The shape
lives once in `harness/wire.py` on the Python side and `protocol.ts` on the TypeScript
side. This contract is the actual boundary of the system.

**Request** (the `SessionConfig` plus the conversation):

| Field | Meaning |
| --- | --- |
| `harness`, `sandbox` | The two swap axes |
| `sessionId` | Continue a prior run by replaying its history |
| `agentsMd` | The agent's instructions, written as `AGENTS.md` |
| `model` | The requested model id |
| `messages` | The conversation so far; the runner sends the latest turn and replays the rest |
| `secrets` | Provider API keys as env vars, resolved from the project vault |
| `tools`, `customTools`, `toolCallback` | The resolved runnable tools and where they call back |
| `permissionPolicy` | `auto` or `deny` for a permission-gating harness |
| `trace` | The Agenta trace context, so the run nests under the `/invoke` span |

**Result** (the reply plus structured run metadata):

| Field | Meaning |
| --- | --- |
| `output` | The final assistant text (what the playground renders) |
| `messages` | The structured assistant messages |
| `events` | The structured event log for the turn (see below) |
| `usage` | Token and cost totals, rolled onto the workflow span |
| `stopReason` | Why the turn ended |
| `capabilities` | What the harness was probed to support this run |
| `sessionId`, `model`, `traceId` | Identifiers for the run |

## The shared vocabulary: capabilities, content blocks, events

Three neutral types travel on that wire. They are ours, not rivet's, so a non-rivet adapter
implements them too.

**Capabilities** describe what a harness can do: `mcpTools`, `images`, `usage`,
`streamingDeltas`, `permissions`, and the rest. The rivet engine probes them live from the
daemon and returns them in the result. This is what removed the brittle `if harness == "pi"`
branches: the runner now branches on a flag, where the live answer is. For example, it
delivers tools over MCP only when the harness reports `mcpTools`, instead of guessing from
the name.

**Content blocks** mirror ACP: a message's content is either a plain string or a list of
`text` / `image` / `resource` blocks. Today the playground sends only text. The image and
resource kinds are plumbed through the types so an image-capable harness can take them once
the playground sends them.

**Events** are the structured stream. Each event is one of `message`, `thought`,
`tool_call`, `tool_result`, `usage`, `error`, or `done`. The runner builds this log from the
harness as the run proceeds and returns it on the result. An `on_event` sink can also
receive the events. Today the transports deliver the whole log at once after the run, since
`/run` is request-and-response; live streaming over the HTTP edge is a documented follow-on.
This event vocabulary is also what makes a Vercel-AI-style stream easy to add later, because
the event kinds line up with that protocol's parts almost one to one.

## Why this shape

The port mirrors rivet's vocabulary but keeps the types ours. That gives us rivet's rich
session, capability probe, and event stream without making the port a rivet wrapper. The
single neutral seam carries two engines today (rivet over ACP, legacy in-process Pi) and has
room for a third tomorrow. The cost of that flexibility is one extra hop and one wire
contract to keep in sync across two languages, which the `wire.py` / `protocol.ts` pairing
contains in one place each.
