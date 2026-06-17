# Implementation notes

How the approved A to E arc lands in code, with the cold + replay constraint. This is
the as-built reference for the rewrite (kept in sync with the code).

## Module layout

### Python — two packages

The engine-agnostic runtime and the Agenta workflow integration are separate packages, so
nothing in the runtime is Agenta-specific and the god-module is gone.

`services/oss/src/harness/` — the engine-agnostic runtime:

| File | Holds |
| --- | --- |
| `ports.py` | The neutral types and the two seams. Types: `HarnessCapabilities`, `ContentBlock`, `Message`, `AgentEvent`, `TraceContext`, `ToolCallback`, `SessionConfig`, `AgentRequest`, `AgentResult`. Seams: `Environment` (where it runs) and `Harness` (the agent), plus the concrete `AgentSession`. |
| `transports.py` | The two transports: `SubprocessHarness` (spawn the TS CLI) and `HttpHarness` (POST to the sidecar). Both share `wire.py`. Replaces `pi_harness.py`, `pi_http_harness.py`, `rivet_harness.py`. |
| `environment.py` | `LocalEnvironment` (subprocess on this host). Replaces `local_runtime.py`. |
| `wire.py` | Serializes an `AgentRequest` to the camelCase `/run` JSON and parses an `AgentResult` back. The wire shape lives once. |

`services/oss/src/agent/` — the Agenta workflow app (was the single `agent.py` god-module):

| File | Holds |
| --- | --- |
| `app.py` | The `/invoke` handler plus `select_backend` / `build_harness`. Thin: it orchestrates the modules below. |
| `inputs.py` | Request parsing: `resolve_run_config`, `to_messages`, `_system_text`. |
| `tools.py` | Tool resolution through `/tools/resolve` (and slug parsing). |
| `secrets.py` | Provider keys from the project vault. |
| `tracing.py` | `trace_context` and `record_usage` (the OTel glue). |
| `client.py` | Shared Agenta-backend access (base URL + caller credential). |
| `schemas.py` | The `/inspect` schemas. Gains the permission-policy parameter. |
| `config.py` | The file-backed `AgentConfig` and the TS runner path. |

The backend engine (legacy in-process Pi vs rivet ACP) is no longer a Python class. It is
one env value (`AGENT_BACKEND`) the transport passes to the TS runner, so Python has two
transports, not three backend adapters. The harness folder is named for the seam, not for
Pi: harness choice (pi/claude) lives inside the runtime, which is why there is no
`agent_claude` package.

### TypeScript (`services/agent/src/`) — grouped by role

| File | Holds |
| --- | --- |
| `cli.ts`, `server.ts` | The two entrypoints (stdio subprocess, HTTP sidecar). Route to an engine by the request's `backend`. |
| `protocol.ts` | Shared wire types: `AgentRunRequest`, `AgentRunResult`, `AgentEvent`, `ContentBlock`, `HarnessCapabilities`. Both engines import from here. |
| `engines/pi.ts` | Legacy engine: drive the Pi SDK in-process. Returns the enriched result. |
| `engines/rivet.ts` | Rivet engine: drive a harness over ACP. Probes `getAgent(harness).capabilities` and branches on capability flags, not on the harness name. Returns the enriched result, with usage for both Pi and Claude. |
| `tracing/otel.ts` | The Pi-extension tracer and the ACP-event tracer; accumulates the structured event log. |
| `tools/client.ts` | The one `/tools/call` HTTP client. |
| `tools/mcp-bridge.ts`, `tools/mcp-server.ts` | Tool delivery over MCP for non-Pi harnesses. |
| `extensions/agenta.ts` | The Pi extension (tracing + tools), bundled to `dist/extensions/agenta.js`. |

The folder grouping (entrypoints + contract at the top, `engines/`, `tracing/`, `tools/`,
`extensions/`) replaced a flat `src/` of ten files that had grown one work package at a
time. No behavior change.

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
