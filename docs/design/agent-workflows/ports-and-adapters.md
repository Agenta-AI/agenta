# Ports and adapters

The [architecture](architecture.md) page showed the relay of programs. This page shows the
seam that keeps that relay swappable: the ports, where they live, and the adapters behind
them.

## Where the runtime lives

The neutral runtime is part of the published Python SDK, at
`sdks/python/agenta/sdk/agents/`. An SDK user gets it as `agenta.sdk.agents` (with the main
types re-exported as `ag.AgentConfig`, `ag.RivetBackend`, and so on). The Agenta service
(`services/oss/src/agent/`) is a thin consumer of it: it resolves tools and secrets
server-side, threads a trace context, and runs a turn through the same ports. Nothing in the
SDK runtime calls the Agenta API, so the same code runs an agent standalone, with no Agenta
backend at all.

The package follows Agenta's hexagonal vocabulary, the same words the `api/` domains use:

| Layer | File | What it holds |
| --- | --- | --- |
| DTOs | `dtos.py` | data contracts (Pydantic): `AgentConfig`, `SessionConfig`, `Message`, events, capabilities, the per-harness configs |
| Ports | `interfaces.py` | the abstract contracts: `Backend`, `Environment`, `Sandbox`, `Session`, `Harness` |
| Adapters | `adapters/` | the implementations: the backends and the harnesses |
| Utils | `utils/` | shared plumbing for the runner-backed adapters (the `/run` wire and the transports) |

## The three layers

The runtime is three ports stacked, lowest to highest.

### Backend (the engine)

A `Backend` is the engine. It declares which harnesses it can drive, owns the sandbox and
session lifecycle, and is pure plumbing: it takes an already-harness-shaped config and
launches it. It carries no "how this harness works" logic.

```python
class Backend(ABC):
    supported_harnesses: ClassVar[FrozenSet[HarnessType]] = frozenset()
    def supports(self, harness) -> bool: ...
    async def create_sandbox(self) -> Sandbox: ...
    async def create_session(self, sandbox, config, *, harness, secrets, trace, session_id) -> Session: ...
```

Each backend is its own class and hard-codes what makes it that engine. There is no shared
base beyond the ABC. Three exist:

- **`RivetBackend`** drives a harness over ACP through the TypeScript rivet runner. It
  supports Pi and Claude. Its `sandbox` axis (`local` or `daytona`) is a constructor
  argument, because it is a real runtime choice.
- **`InProcessPiBackend`** drives Pi in-process through the runner, with no rivet daemon. Pi
  only, local only. It was the first backend and stays as the simplest one, the reference to
  read when writing a new backend.
- **`LocalBackend`** runs a harness on the user's own machine for standalone SDK use (Pi via
  a bundled JS runner, Claude via the Python `claude-agent-sdk`). See
  [`scratch/sdk-local-backend/status.md`](scratch/sdk-local-backend/status.md) for its build
  state.

`RivetBackend` and `InProcessPiBackend` are different engines that happen to share the
`utils` wire and transport helpers; neither subclasses the other.

### Environment (where it runs)

An `Environment` wraps a backend and owns the sandbox policy: by default a fresh sandbox per
session (the cold model, strong isolation). Share one `Environment` across harnesses to
share its sandbox, or use one per harness to isolate them. The workflow handler builds an
`Environment(backend)` and never touches the backend's sandbox calls directly.

### Harness (the conversation, per harness type)

A `Harness` wraps an `Environment` for one harness type (`PiHarness`, `ClaudeHarness`). It
does two jobs. First, it validates at construction that the environment's backend can drive
it; if not, it raises `UnsupportedHarnessError` immediately:

```python
ClaudeHarness(Environment(InProcessPiBackend()))
# UnsupportedHarnessError: InProcessPiBackend cannot drive harness 'claude'; it supports: pi
```

Second, it holds the per-harness adaptation logic, the part that used to live in the
TypeScript runner. `Harness._to_harness_config` maps the neutral `SessionConfig` into the
harness's own config, and the two harnesses genuinely differ:

- **`PiHarness`** keeps built-in tool names, delivers resolved tools natively (Pi has no
  MCP), and forces the permission policy to `auto` because Pi does not gate tool use.
- **`ClaudeHarness`** drops Pi built-ins (Claude has none), delivers tools over MCP, and
  honors the permission policy because Claude gates tool use.

Both normalize the resolved tool specs (a name, a description, a JSON-Schema `inputSchema`,
the `callRef`). The backend below stays pure plumbing; this layer owns the harness knowledge.

A `make_harness(harness_type, environment)` factory maps the playground's harness string to
the right class.

The workflow handler runs a turn through these ports:

```python
backend = select_backend(selection)          # RivetBackend or InProcessPiBackend
harness = make_harness(selection.harness, Environment(backend))
await harness.setup()
result = await harness.prompt(session_config, messages)
await harness.cleanup()
```

## The configs

`AgentConfig` is the one neutral config the platform and playground speak: instructions
(written as `AGENTS.md`), model, and provider-agnostic tool references.
`AgentConfig.from_params` parses a downloaded config dict (the `agent` element, a `prompt`
prompt-template, or a flat shape) so a standalone user runs exactly what the playground
stores. `RunSelection` carries the run-time choices stored alongside it (harness, sandbox,
permission policy); the caller reads it to pick a backend and a harness class.

`SessionConfig` bundles everything one run needs except where it runs: the `AgentConfig`,
the provider secrets, the permission policy, the trace context, and the resolved tool
delivery (built-in names, custom specs, the `/tools/call` callback). Sandbox is deliberately
not in it; that is a backend and environment concern.

The per-harness configs (`PiAgentConfig`, `ClaudeAgentConfig`) are what a backend plumbs.
Each shapes its own tool and permission fields for the wire, so the difference between Pi's
native tools and Claude's MCP tools lives in the config types, not in a runtime branch.

## How the service picks a backend

The handler chooses on every request, in `services/oss/src/agent/app.py`. `select_backend`
returns a backend instance: `InProcessPiBackend` for Pi running locally, and `RivetBackend`
otherwise (any other harness, a non-local sandbox, or `AGENTA_AGENT_RUNTIME=rivet`). The
in-process Pi engine only knows how to run Pi locally, so anything else routes to rivet
rather than silently dropping the choice.

The transport to the runner is a deployment detail each backend takes as a constructor
argument: `AGENTA_AGENT_PI_URL` set (the Docker deployment) means HTTP to the sidecar; unset
(a local checkout) means spawn the runner CLI from the wrapper directory.

## The wire contract: one `/run` shape

Both transports send the same camelCase JSON to the TypeScript runner and parse the same
result back. The shape lives once in `utils/wire.py` on the Python side and `protocol.ts` on
the TypeScript side. This contract is the actual boundary of the system.

**Request** (the harness-shaped config plus the conversation):

| Field | Meaning |
| --- | --- |
| `backend` | The engine the runner uses (`rivet` or `pi`), set by the backend |
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

Three neutral types travel on that wire. They are ours, not any one engine's, so a non-rivet
adapter implements them too.

**Capabilities** describe what a harness can do: `mcp_tools`, `images`, `usage`,
`streaming_deltas`, `permissions`, and the rest. The rivet runner probes them live from the
daemon and returns them in the result. This is what removed the brittle `if harness == "pi"`
branches in the runner: it now branches on a flag, where the live answer is. For example, it
delivers tools over MCP only when the harness reports `mcp_tools`.

**Content blocks** mirror ACP: a message's content is either a plain string or a list of
`text` / `image` / `resource` blocks. Today the playground sends only text. The image and
resource kinds are plumbed through the types so an image-capable harness can take them.

**Events** are the structured stream. Each event is one of `message`, `thought`,
`tool_call`, `tool_result`, `usage`, `error`, or `done`. The runner builds this log from the
harness as the run proceeds and returns it on the result. An `on_event` sink can also
receive them. Today the transports deliver the whole log at once after the run, since `/run`
is request-and-response; live streaming over the HTTP edge is a documented follow-on.

## Why this shape

The port mirrors rivet's vocabulary but keeps the types ours, so rivet is one adapter behind
the seam, not the seam itself. The same ports carry two working engines (rivet over ACP,
in-process Pi) and have room for a standalone local engine. Making the engine a real
`Backend` class, rather than a string the transport carries, is what lets a backend hard-code
its own identity and lets a standalone SDK user construct one directly. The cost of the
flexibility is one extra hop and one wire contract to keep in sync across two languages, which
the `utils/wire.py` and `protocol.ts` pairing contains in one place each.
