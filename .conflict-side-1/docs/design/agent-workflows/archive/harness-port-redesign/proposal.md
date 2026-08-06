> Superseded by the as-built design in [the design pages](../../README.md) and [scratch/sdk-local-backend/status.md](../sdk-local-backend/status.md). Kept for history.

# Proposal: evolve the ports toward a session shaped seam

## Principle

Borrow rivet's vocabulary, keep the neutral seam. Rivet stays one adapter behind the
port so the legacy in process Pi path and any future non rivet harness still fit. We are
not adopting the rivet SDK as our public interface. We are reshaping our port so the rich
session that rivet already gives us stops getting flattened to a string at the boundary.

Three moves carry most of the value:

1. Split the port into an **Environment** seam (where it runs, its lifecycle) and an
   **AgentSession** seam (the conversation), matching rivet's plane A and plane B.
2. Make the turn call **event shaped**: stream structured events, return a structured
   result. Stop returning one string.
3. Make a **session a first class object** with create, continue, destroy, backed by a
   persistence driver, so "continue" uses ACP `session/load` instead of replaying
   transcript text.

Everything else (capabilities, content blocks, permissions, skills, lifecycle) hangs off
those three.

## Target shape (conceptual, Python)

Not final signatures. The intent, so the phased plan has a destination.

```python
# Plane A: where the agent runs and its lifecycle. Rivet providers live below this.
class Environment(ABC):
    async def start(self) -> None: ...
    async def dispose(self) -> None: ...
    async def destroy(self) -> None: ...        # tear the sandbox down
    async def pause(self) -> None: ...          # optional, provider dependent
    # provisioning only, never exposed to the agent author:
    async def put_file(self, path: str, body: bytes) -> None: ...

# Capabilities the runtime probed from the harness (rivet AgentCapabilities).
@dataclass
class HarnessCapabilities:
    mcp_tools: bool = False
    images: bool = False
    file_attachments: bool = False
    plan_mode: bool = False
    reasoning: bool = False
    permissions: bool = False
    usage: bool = False
    session_lifecycle: bool = False
    streaming_deltas: bool = False
    # ... the rest of the 18 flags

# Plane B: the agent conversation.
class AgentSession(ABC):
    id: str
    capabilities: HarnessCapabilities

    async def prompt(self, blocks: list[ContentBlock]) -> AsyncIterator[AgentEvent]: ...
    async def destroy(self) -> None: ...
    # config the harness honors (each is capability gated):
    async def set_model(self, model: str) -> None: ...
    async def set_mode(self, mode: str) -> None: ...
    async def on_permission(self, request: PermissionRequest) -> PermissionReply: ...

class Harness(ABC):
    async def get_capabilities(self) -> HarnessCapabilities: ...
    async def create_session(self, config: SessionConfig) -> AgentSession: ...
    async def resume_session(self, session_id: str) -> AgentSession: ...
```

`SessionConfig` is the agent config bundle: `agents_md`, `model`, `skills`, `tools`
(definition plus body plus delivery), `mcp`, `hooks` (as artifacts), `harness`,
`permission_policy`. `ContentBlock` mirrors ACP: `text | image | audio | resource |
resource_link`. `AgentEvent` mirrors the `session/update` variants:
`message`, `thought`, `tool_call`, `plan`, `usage`, `done`.

## Field by field: where today's fields go

| Today (`HarnessRequest`) | Tomorrow |
| --- | --- |
| `agents_md` | `SessionConfig.agents_md` (still written as `AGENTS.md`) |
| `model` | `SessionConfig.model`, applied via `set_model` (capability gated) |
| `prompt` | a `text` content block in `prompt(blocks)` |
| `messages` | prior turns become `session/load` replay, not transcript text |
| `session_id` | `resume_session(id)` returning an `AgentSession` |
| `tools` / `custom_tools` / `tool_callback` | `SessionConfig.tools`, delivered by capability (MCP vs native) |
| `trace` | unchanged; still injected at the environment's birth |
| (new) attachments / images | `image` / `resource` content blocks |
| (new) per harness behavior | `HarnessCapabilities` instead of `if harness == "pi"` |

`HarnessResult.output` becomes the terminal `done` event plus the accumulated `message`
events. The single string is still trivially derivable for `/invoke`'s current response.

## How each piece maps to rivet

- **Sessions** → `createSession` / `resumeSession` / `resumeOrCreateSession` /
  `destroySession`, plus a `SessionPersistDriver`. Adopt the persist driver interface
  shape so the platform backs it with Postgres and a standalone run backs it with a file,
  exactly as rivet already splits in memory vs Postgres.
- **Streaming** → `session.onEvent`. `runRivet.ts` already subscribes for tracing
  (`otel.handleUpdate`). The change is to forward those events through the port instead of
  consuming them privately and returning a string.
- **Capabilities** → `getAgent().capabilities`. Probe once per harness, cache, branch on
  flags.
- **Attachments** → ACP content blocks on `prompt`. Gate on `fileAttachments` / `images`.
- **Skills** → `setSkillsConfig(directory, ...)` or laid into `cwd` as files. Part of
  `SessionConfig`, resolved before the run like AGENTS.md.
- **Tools** → keep WP-7's definition plus body plus callback. Deliver over MCP when
  `mcpTools` is set, native when the harness wants native (today's Pi extension path).
- **Hooks** → **not a rivet call.** Lay them into the workspace or agent dir as artifacts,
  the way we already install the Pi tracing extension. Model `hooks` as files in
  `SessionConfig`, not a port verb.
- **Permissions** → `onPermissionRequest` / `respondPermission`. Replace the hardcoded
  auto approve with a `permission_policy` on `SessionConfig` (auto allow, deny, or
  delegate to a callback), and later surface requests as events for true human in the
  loop.
- **Lifecycle / destroy** → `Environment.destroy` / `dispose` and `AgentSession.destroy`,
  mapping to `destroySandbox` / `dispose` / `destroySession`. Retire the `Runtime.pause`
  no-op or back it with `pauseSandbox` where the provider supports it.

## What stays out of the port

The system plane: filesystem, process, desktop. We use `writeFsFile` / `mkdirFs` only to
provision a Daytona sandbox (upload AGENTS.md, auth, the extension). Keep that inside the
`Environment` adapter as provisioning. Never surface it to the agent config author. The
agent author sees AGENTS.md, skills, tools, model, harness, attachments. Not a filesystem.

## Phased path (each phase ships and keeps `/invoke` working)

The phases are ordered by value over risk. Stop wherever the payoff flattens.

- **Phase A. Capabilities and structured result.** Probe `getAgent().capabilities`,
  thread a `HarnessCapabilities` object through, and replace the `harness == "pi"`
  branches in `runRivet.ts` with capability checks. Widen `HarnessResult` to carry
  `messages`, `usage`, `tool_calls`, `stop_reason` (the data is already in the event
  stream). Low risk, immediately removes brittle harness name checks.

- **Phase B. Event streaming through the port.** Add an event channel to `invoke`
  (callback or async generator) carrying the `session/update` variants. Tracing reads from
  it instead of a private subscription. `/invoke` still returns the final message, so the
  HTTP contract is unchanged; client side streaming (WP-4) becomes a small add on.

- **Phase C. First class sessions.** Introduce `create_session` / `resume_session` /
  `destroy` and a `SessionPersistDriver` analogue. Continue a conversation with ACP
  `session/load` instead of `buildTurnText` transcript replay. This needs the warm daemon
  decision (see open questions) because cold per invoke sandboxes cannot hold a session
  across turns without replay.

- **Phase D. Content blocks, permissions, skills, hooks.** Turn `prompt` into content
  blocks (attachments, images). Add `permission_policy`. Move skills and hooks into
  `SessionConfig` as resolved artifacts.

- **Phase E. Retire the `Runtime` exec port.** Fold "where it runs" fully into the
  `Environment` seam backed by rivet providers. Keep `exec` only as long as the legacy
  subprocess Pi transport needs it.

## Risks and caveats

- **Cold per invoke lifecycle fights first class sessions.** Phase C is the moment to
  decide warm vs cold (the WP-8 status calls this out). First class sessions and ACP
  `session/load` want a daemon that survives between turns, which reopens the per session
  env and folder jail questions in
  [`../wp-8-rivet-acp-runtime/isolation-and-fork.md`](../wp-8-rivet-acp-runtime/isolation-and-fork.md).
- **Harness capability gaps are real.** Pi 0.79.4 has no MCP, so `mcpTools` is false and
  Pi tools still go native. The capability model makes that explicit instead of surprising.
- **Usage is harness dependent.** Pi emits no `usage_update` over ACP; Claude does. The
  structured result must tolerate missing usage (the WP-8 tracing deviation already notes
  this).
- **Neutral seam vs rivet coupling.** Mirroring rivet's names risks the port drifting into
  a rivet wrapper. Keep the port types ours (content blocks, events, capabilities as our
  dataclasses) and translate in the adapter, so a non rivet harness can still implement it.
