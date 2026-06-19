> Superseded by the as-built design in [the design pages](../../README.md) and [scratch/sdk-local-backend/status.md](../sdk-local-backend/status.md). Kept for history.

# Research: our ports vs the rivet SDK

Source verified June 2026 against the installed `sandbox-agent@0.4.2` SDK
(`services/agent/node_modules/.pnpm/sandbox-agent@0.4.2.../dist/index.d.ts`), the
`acp-http-client@0.4.2` client, the `@agentclientprotocol/sdk` schema, and our own code
(`services/oss/src/agent_pi/ports.py`, `services/agent/src/runRivet.ts`,
`services/oss/src/agent.py`). Method and type names below are copied from those files.

## 1. Our current ports

### `Harness` (`services/oss/src/agent_pi/ports.py`)

```python
class Harness(ABC):
    async def setup(self) -> None: ...
    async def invoke(self, request: HarnessRequest) -> HarnessResult: ...
    async def shutdown(self) -> None: ...
```

`HarnessRequest`: `agents_md`, `model`, `prompt`, `messages`, `session_id`, `tools`,
`custom_tools`, `tool_callback`, `trace`.
`HarnessResult`: `output` (one string), `session_id`, `model`.

Properties of this port:

- **One shot and blocking.** One turn in, one string out. No incremental events.
- **Session is a string.** `session_id` is threaded through; "continue" means replaying
  prior turns as transcript text inside the prompt (`buildTurnText` in `runRivet.ts`),
  not loading an ACP session.
- **No capability model.** The service branches on `harness == "pi"` to decide tools
  delivery and tracing (see `runRivet.ts`).
- **Text only.** `prompt` is a string; `messages` are `{role, content: str}`.
- **No permissions, modes, thought level, plan, usage, tool call surfacing.**

### `Runtime` (`services/oss/src/agent_pi/ports.py`)

```python
class Runtime(ABC):
    async def start(self) -> None: ...
    async def shutdown(self) -> None: ...
    async def pause(self) -> None: ...            # no-op default
    async def connect_volume(self, ...) -> None:  # no-op default
    async def exec(self, command, input_bytes, *, cwd, env, timeout) -> ExecResult: ...
```

This is a generic "run a subprocess and feed it stdin" port. It predates rivet. The rivet
path only uses `exec` for the local subprocess transport; the real "where it runs" choice
(local vs daytona) now lives in `runRivet.ts` as the rivet provider. So this port is now
half vestigial.

### The wire contract (`AgentRunRequest` / `AgentRunResult` in `runPi.ts`)

Mirrors `HarnessRequest`/`HarnessResult` plus `harness`, `sandbox`, `traceId`. Also one
shot. `/run` returns the final result; no streaming endpoint exists.

## 2. The rivet SDK surface

Rivet splits cleanly into three planes.

### Plane A. Runtime / sandbox: `SandboxAgent`

The control plane and the environment.

- Construct and connect: `SandboxAgent.start({ sandbox, persist, replayMaxEvents, replayMaxChars, token, signal })`, `SandboxAgent.connect({ baseUrl })`.
- **Lifecycle:** `dispose()`, `destroySandbox()`, `pauseSandbox()`, `killSandbox()`.
- **Session registry:** `createSession`, `resumeSession`, `resumeOrCreateSession`,
  `destroySession`, `listSessions`, `getSession`, `getEvents`.
- **Capability discovery:** `listAgents`, `getAgent` (returns `AgentInfo` with
  `capabilities`, `configOptions`, `installed`, `credentialsAvailable`), `installAgent`.
- **Config plane (per directory):** `getSkillsConfig`/`setSkillsConfig`/`deleteSkillsConfig`
  and `getMcpConfig`/`setMcpConfig`/`deleteMcpConfig`.

The sandbox is chosen by a provider passed to `start`: `local`, `daytona`, `e2b`,
`docker`, `vercel`, `cloudflare`, `modal`, `computesdk`, `sprites`. This is the real
environment seam, and it is richer than our `Runtime.exec`.

### Plane B. Agent session: `Session`

The agent conversation. This is the heart of what we should adopt.

```ts
class Session {
  prompt(prompt: ContentBlock[]): Promise<PromptResponse>;
  setModel(model): ...; setMode(modeId): ...; setThoughtLevel(level): ...;
  setConfigOption(id, value): ...;
  getConfigOptions(): ...; getModes(): ...;
  onEvent(listener): () => void;
  onPermissionRequest(listener): () => void;
  respondPermission(permissionId, reply): ...;   // reply: "once" | "always" | "reject"
  rawSend(method, params): ...;                   // escape hatch
}
```

- **Multimodal input.** `prompt` takes ACP content blocks. The block `type` is one of
  `text`, `image`, `audio`, `resource`, `resource_link`. Attachments and images ride here.
- **Live structured events.** `onEvent` delivers ACP `session/update` notifications.
  The variants (verified in the ACP schema):

  | `sessionUpdate` | Meaning |
  | --- | --- |
  | `agent_message_chunk` | assistant text delta or snapshot |
  | `agent_thought_chunk` | reasoning / thinking |
  | `user_message_chunk` | echoed user content |
  | `tool_call` / `tool_call_update` | a tool started / progressed / finished |
  | `plan` | the agent's plan (plan mode) |
  | `available_commands_update` | slash commands available |
  | `config_option_update` / `current_mode_update` | config or mode changed mid run |
  | `usage_update` | token usage |
  | `session_info_update` | session metadata |

- **Permissions / human in the loop.** `onPermissionRequest` + `respondPermission`.
  Today `runRivet.ts` auto approves these; the policy is hardcoded, not expressed in the
  port.

### Plane C. System: filesystem, process, desktop

`SandboxAgent` also exposes the sandbox internals: `readFsFile`, `writeFsFile`, `mkdirFs`,
`moveFs`, `uploadFsBatch`; `runProcess`, `createProcess`, `followProcessLogs`,
`connectProcessTerminal`; and a full desktop API (mouse, keyboard, screenshot, recording,
WebRTC stream). These are **not** part of the agent config contract. We use a few of them
(`writeFsFile`, `mkdirFs`) only to provision a Daytona sandbox in `runRivet.ts`. They
belong to the runtime/sandbox adapter, never to the agent author.

### Persistence and replay

`SandboxAgent.start({ persist })` takes a `SessionPersistDriver`:

```ts
interface SessionPersistDriver {
  getSession(id): Promise<SessionRecord | undefined>;
  listSessions(req?): Promise<ListPage<SessionRecord>>;
  updateSession(session): Promise<void>;
  listEvents(req): Promise<ListPage<SessionEvent>>;
  insertEvent(sessionId, event): Promise<void>;
}
```

`InMemorySessionPersistDriver` ships; Postgres is wired in the daemon. A `SessionEvent`
carries `eventIndex`, `sender` ("client" | "agent"), and the ACP `payload`. Replay is
bounded by `replayMaxEvents` / `replayMaxChars`. `runRivet.ts` already constructs an
`InMemorySessionPersistDriver`, but because each invoke is a cold sandbox, it never spans
turns. The continue path falls back to transcript text instead.

### Capability model: `AgentCapabilities`

`getAgent(id)` returns capabilities the runtime probed from the harness:

```
commandExecution, errorEvents, fileAttachments, fileChanges, images, itemStarted,
mcpTools, permissions, planMode, questions, reasoning, sessionLifecycle, sharedProcess,
status, streamingDeltas, textMessages, toolCalls, toolResults
```

This is the clean answer to the `if harness == "pi"` branching we do today. The service
should ask "does this harness support `mcpTools` / `images` / `planMode` / `usage`" and
degrade, rather than hardcode harness names.

### Session lifecycle in ACP (what the protocol allows)

The ACP schema defines `session/new`, `session/load` (replay), `session/prompt`,
`session/cancel`, plus `ForkSessionRequest`/`ForkSessionResponse` and
`ResumeSessionRequest`/`ResumeSessionResponse`. **Fork is a first class ACP operation.**
That connects to [`../wp-8-rivet-acp-runtime/isolation-and-fork.md`](../wp-8-rivet-acp-runtime/isolation-and-fork.md):
a forked session is a cheap branch point for "try N variations of a turn", separate from
the filesystem jail discussed there.

### Hooks: not in the SDK

A grep for `hook` across `sandbox-agent/dist` and `acp-http-client` returns nothing.
Rivet has no hook concept. Hooks exist inside the harnesses (Pi loads extensions and
settings from `~/.pi/agent`; Claude reads its own hook config). So "set up hooks" is not a
rivet control plane call. It is an agent config artifact: files and settings laid into the
workspace or agent dir before the run. Our Pi tracing extension is exactly this shape
already (`installPiExtensionLocal` / `uploadPiExtensionToSandbox` in `runRivet.ts`).

## 3. Side by side

| Concern | Our `Harness` port today | Rivet SDK |
| --- | --- | --- |
| Turn call | `invoke(req) -> str` (blocking) | `session.prompt(blocks)` + `onEvent` stream + `PromptResponse` |
| Output | single string | structured events: text, thought, tool calls, plan, usage |
| Session | `session_id` string, transcript replay | `Session` object; create / load / resume / fork / destroy |
| Persistence | none (history held by caller) | `SessionPersistDriver` (in memory or Postgres), bounded replay |
| Input modality | text only | content blocks (text, image, audio, resource, resource_link) |
| Model / mode | `model` field | `setModel`, `setMode`, `setThoughtLevel`, `getConfigOptions` |
| Capabilities | `if harness == "pi"` | `getAgent().capabilities` (18 flags) |
| Tools | `custom_tools` + `tool_callback` | per directory MCP config + capability `mcpTools` |
| Skills | not in port | per directory `setSkillsConfig` (artifacts on disk) |
| Hooks | not in port | not in rivet either; harness config artifacts |
| Permissions | hardcoded auto approve in `runRivet.ts` | `onPermissionRequest` / `respondPermission` policy |
| Environment | `Runtime.exec(cmd, stdin)` | sandbox providers (local, daytona, e2b, docker, ...) |
| Lifecycle | `Runtime.pause` no-op stub | `destroySession`, `destroySandbox`, `pauseSandbox`, `killSandbox`, `dispose` |
| System (fs/proc/desktop) | absent (correct) | present on `SandboxAgent`, used only for provisioning |

The gap is not that our port is wrong. It is that it stops at "send a turn, get text",
while rivet models the whole session as a first class, observable, resumable object.
