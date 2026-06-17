# Implementation notes

How the approved A to E arc lands in code, with the cold + replay constraint. This is
the as-built reference for the rewrite (kept in sync with the code).

## Module layout

### Python (`services/oss/src/agent_pi/`)

| File | Holds |
| --- | --- |
| `ports.py` | The neutral types and the two seams. Types: `HarnessCapabilities`, `ContentBlock`, `Message`, `AgentEvent`, `TraceContext`, `ToolCallback`, `SessionConfig`, `AgentRequest`, `AgentResult`. Seams: `Environment` (where it runs) and `Harness` (the agent). Plus the concrete `AgentSession` sugar. |
| `wire.py` | One place that serializes an `AgentRequest` to the camelCase `/run` JSON and parses an `AgentResult` back. Shared by every transport so the wire shape lives once. |
| `environment.py` | `LocalEnvironment` (subprocess on this host). Replaces `local_runtime.py`. |
| `harness.py` | The two transports: `SubprocessHarness` (spawn the TS CLI) and `HttpHarness` (POST to the sidecar). Both share `wire.py`. Replaces `pi_harness.py`, `pi_http_harness.py`, `rivet_harness.py`. |
| `config.py` | Unchanged: load the file-backed `AgentConfig`. |
| `schemas.py` | The `/inspect` schemas. Gains the permission-policy parameter. |

The backend engine (legacy in-process Pi vs rivet ACP) is no longer a Python class. It
is one env value (`AGENT_BACKEND`) the transport passes to the TS runner, or the sidecar
auto-routes by request shape. So Python has two transports, not three backend adapters.

### TypeScript (`services/agent/src/`)

| File | Holds |
| --- | --- |
| `protocol.ts` | Shared wire types: `AgentRunRequest`, `AgentRunResult`, `AgentEvent`, `ContentBlock`, `HarnessCapabilities`. Both runners import from here (no more `runRivet` importing types out of `runPi`). |
| `runPi.ts` | Legacy backend: drive the Pi SDK in-process. Returns the enriched result. |
| `runRivet.ts` | Rivet backend: drive a harness over ACP. Probes `getAgent(harness).capabilities` and branches on capability flags, not on the harness name. Returns the enriched result, including usage for both Pi and Claude. |
| `agenta-otel.ts` | The Pi-extension tracer and the ACP-event tracer. Also accumulates the structured event log. |
| `piExtension.ts`, `toolBridge*.ts` | Unchanged tool/trace delivery. |
| `cli.ts`, `server.ts` | Route to the backend by `AGENT_BACKEND` (auto by request shape on the sidecar). |

## The seams

```python
class Harness(ABC):
    async def setup(self) -> None: ...
    async def shutdown(self) -> None: ...
    async def invoke(self, request: AgentRequest, *, on_event=None) -> AgentResult: ...
    async def destroy_session(self, session_id: str | None) -> None: ...   # cold: no-op
    def create_session(self, config: SessionConfig) -> AgentSession: ...

class AgentSession:                 # sugar over invoke; the first-class session abstraction
    async def prompt(self, messages, *, on_event=None) -> AgentResult: ...
    async def destroy(self) -> None: ...
```

`invoke` is the single transport call (one cold run). `AgentSession` is the rivet-shaped
abstraction on top: `create_session(config)` then `session.prompt(messages)`. Under cold +
replay the session holds no warm daemon; continuation replays the caller-supplied history
into a fresh run, exactly as WP-8 does today. Server-side persisted history is the
deferred Phase C bit (see Deferred below).

## Capabilities: probed in TS, reported in the result

A separate capability probe would cost a whole daemon spin-up under the cold model. So the
rivet runner probes `getAgent(harness).capabilities` while its daemon is already up, drives
tool delivery and tracing off the flags (`mcpTools`, `usage`, `streamingDeltas`, ...), and
returns the capabilities in the result. Python keeps a small static table only for input
shaping (for example, do not send image blocks to a harness without `images`). This is
what removes the `if harness == "pi"` branching: the decision moves to where the live
answer is, the TS runner.

## Wire contract (`/run`)

Request (camelCase), superset of today: `harness`, `sandbox`, `sessionId`, `agentsMd`,
`model`, `messages` (each `content` is a string or a `ContentBlock[]`), `prompt`,
`secrets`, `tools`, `customTools`, `toolCallback`, `permissionPolicy` (`auto` | `deny`),
`trace`.

Result: `ok`, `output` (final text), `messages` (structured assistant messages), `events`
(the `AgentEvent` log for the turn), `usage` (`{input, output, total, cost}`, now for the
rivet path too), `stopReason`, `capabilities`, `sessionId`, `model`, `traceId`, `error`.

## What each phase delivers here

- **A** capabilities + structured result: `HarnessCapabilities`, the enriched `AgentResult`
  (messages, usage, stopReason, capabilities), and capability-driven branching in `runRivet`.
- **B** event stream through the port: `AgentEvent` log on the result, plus an optional
  `on_event` callback on `invoke`/`prompt`. The HTTP edge (`/invoke`) stays request and
  response; live SSE to the playground is deferred (ties to WP-4).
- **C** first-class sessions: `AgentSession` create / prompt / destroy. Continuation stays
  cold + replay with caller-held history. A server-side `SessionStore` is deferred.
- **D** content blocks, permissions, skills, hooks: `ContentBlock` on the turn (text now,
  image-ready), `permissionPolicy`, and skills/hooks carried as workspace artifacts.
- **E** retire the exec port: `Runtime` becomes `Environment`; `exec` survives only as the
  subprocess transport's mechanism.

## Verification

Local CLI runs against real models (2026-06-17), driving `services/agent/src/cli.ts`:

| Combo | Result | Usage source | Live capabilities |
| --- | --- | --- | --- |
| `pi` (legacy in-process) | reply ok | Pi extension (`otel.usage()`) | mcpTools=false |
| `rivet` + `pi` + `local` | reply ok | extension usage file | probed: mcpTools=false, images=true |
| `rivet` + `claude` + `local` | reply ok | ACP `usage_update` | probed: mcpTools=true, permissions=true |

The capability probe returns the harness's real flags (Pi and Claude differ), and tool
delivery routes off `mcpTools`. The structured result carries output, messages, events,
usage (token split + cost), stopReason, capabilities, sessionId, model, traceId. Python
compiles and passes `ruff`; TypeScript passes `tsc --strict --noEmit`.

### Review

A high-effort recall review (8 finder angles, 36 candidates, single-vote verify) found 10
issues, all fixed and re-verified:

- usage_update read non-existent `input`/`output` fields, so the Claude/Codex token split
  was always 0. Fixed: read the split from `PromptResponse.usage` in `runRivet`. Verified
  Claude now reports input/output (3327/6).
- `Message.to_wire()` crashed on list (content-block) content. Fixed: `Message.from_raw`
  coerces blocks into `ContentBlock`; `to_wire` tolerates dicts. Verified a content-block
  turn returns cleanly.
- `priorMessages` dropped every prior user turn equal to the prompt, not just the latest.
- The legacy Pi engine silently swallowed a `claude`/`daytona` selection. Fixed:
  `_select_backend` upgrades to rivet when the harness/sandbox needs it.
- The `/tools/call` client was triplicated across `runPi`, `piExtension`, and
  `toolBridgeServer`. Fixed: one shared `toolClient.ts`.
- Dead code removed: the `RunCall` alias and a stale type re-export block.

### Live verification (dev stack, 2026-06-17)

Run on the dev box with the agent-pi sidecar and services container reloaded onto this
branch (both bind-mount the repo):

- **Daytona**: `rivet+pi+daytona` through the live sidecar returned a correct answer in
  ~14s with usage read back from the in-sandbox extension file.
- **Full playground run**: the agent app in the `pi-agents` project answered "Hello! The
  capital of Germany is Berlin." with status Success, 6.54s, 1.2K tokens. The new
  Harness/Sandbox config selectors render from `schemas.py`.
- **Trace nesting**: the trace shows `invoke_agent` nested directly under the `_agent`
  workflow root span (same trace, usage propagated). The agent's run joins the `/invoke`
  trace as required.

Remaining manual check: a Composio tool end to end through the playground (the tool
routing is verified by capability; the WP-7 resolution path is unchanged).

## Deferred (documented, not built in this pass)

- Server-side persisted session history (the `SessionStore` / DB). Today the playground
  holds history and replays it; the session abstraction is in place for when we add the store.
- Live SSE streaming to the playground client (the event stream is delivered through the
  port as a log + callback; the HTTP edge stays request and response).
- Image content blocks end to end (the type is plumbed; the playground does not send images yet).
- `session/fork`, the folder jail, and the warm shared daemon (all out of scope per WP-8).
