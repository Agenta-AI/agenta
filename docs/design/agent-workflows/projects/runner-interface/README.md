# RFC: The Agent Runner Interface (`/run`)

| | |
| --- | --- |
| **Status** | Draft. Describes the active-stack code as built. |
| **Scope** | The wire boundary between the Python agent service and the TypeScript runner sidecar. |
| **Audience** | Anyone changing the `/run` payload, the transports, the event model, or either runner engine. |
| **Related** | [protocol.md](../protocol.md) (all public surfaces), [architecture.md](../architecture.md) (runtime shape), [ports-and-adapters.md](../ports-and-adapters.md) (SDK ports). This page is the deep dive on the internal `/run` slice that those pages summarize. |

## 1. Summary

The agent workflow runs in two processes. A Python process (the **agent service**) decides
*what* to run: it parses config, resolves provider secrets and tools, and threads trace
context. A Node process (the **runner sidecar**) decides *how* to run it: it drives a coding
harness (Pi or Claude) and streams back what happened.

Those two processes talk over one contract: a `POST /run` request carrying a single agent
turn, and a structured result describing the turn. The same contract is delivered two ways
(HTTP to a running sidecar, or a subprocess CLI in a source checkout) and in two modes
(one-shot JSON, or live NDJSON). This RFC specifies that contract precisely: the transports,
the request and result schemas, the event model, the streaming framing, the error model, and
the versioning rules.

The boundary is hand-mirrored on both sides and pinned by golden fixtures. The single most
important operational rule is in [Section 11](#11-versioning-and-the-change-both-sides-rule):
any field change touches Python, TypeScript, the golden fixtures, and both contract tests in
the same PR.

## 2. Why a two-process boundary exists

The split is not incidental. It is load-bearing for three reasons.

1. **The harnesses are Node libraries.** Pi, Claude Code, and the `sandbox-agent` package
   have no Python SDK. The agent loop has to run in Node. The rest of Agenta is Python. The
   boundary is where those two worlds meet.
2. **Secret isolation.** The sidecar deliberately does not inherit the full service
   environment. Provider keys and tool credentials are resolved by the service and passed
   only inside the scoped `/run` payload that needs them. The sidecar sees a key because the
   service chose to send it for that one run, not because it shares the service's env.
3. **Separation of concerns.** "What to run" (Agenta config, vault secrets, gateway tools,
   trace context) stays in the service. "How to run it" (harness lifecycle, ACP, sandbox
   creation, event shaping) stays in the runner. The `/run` contract is the only thing both
   sides must agree on.

## 3. Roles and terminology

| Term | Meaning |
| --- | --- |
| **Agent service** | The Python FastAPI process. Owns config parsing, secret/tool resolution, tracing, and the public `/invoke` and `/messages` surfaces. Code: `services/oss/src/agent/`. |
| **Runner sidecar** | The Node process that runs the agent loop. Serves `GET /health` and `POST /run`. Code: `services/agent/`. Compose service name: `sandbox-agent`. |
| **Backend (SDK)** / **engine (runner)** | The same axis seen from two sides. The SDK `Backend` adapter (`InProcessPiBackend`, `SandboxAgentBackend`) hard-codes its engine id and serializes `/run`. The runner dispatches on that id (`pi` or `sandbox-agent`) to a TS engine (`engines/pi.ts`, `engines/sandbox_agent.ts`). |
| **Harness** | Which agent runs inside the engine: `pi`, `claude`, or `agenta`. |
| **Sandbox** | Where the run happens: `local` or `daytona`. |
| **Transport** | How the `/run` JSON is delivered: HTTP or subprocess CLI. |
| **Mode** | One-shot (one JSON result) or streaming (NDJSON records). |

A clarification that the naming invites confusion on: **"in-process" means in-process to the
Node runner, not to Python.** `InProcessPiBackend` still crosses the `/run` wire. It just
tells the runner to drive the Pi SDK directly (`engines/pi.ts`) instead of starting the
`sandbox-agent` daemon and an ACP adapter (`engines/sandbox_agent.ts`). Both backends use the
identical transports and wire; they differ only in the `backend` field value and therefore in
which TS engine the runner picks.

## 4. Topology and transport selection

```
browser / workflow client
        |
        | POST /invoke  or  POST /messages
        v
+-------------------------------+
| agent service (Python)        |
| services/oss/src/agent/app.py |
|   parse config                |
|   resolve secrets + tools     |
|   pick backend, build /run    |
+-------------------------------+
        |
        |  ONE of two transports, chosen by whether a URL is set:
        |
        |   (a) HTTP   POST {AGENTA_RUNNER_URL}/run
        |   (b) spawn  pnpm exec tsx src/cli.ts   (stdin -> stdout)
        v
+-------------------------------+
| runner sidecar (Node)         |
| services/agent/src/server.ts  |  <- (a)
| services/agent/src/cli.ts     |  <- (b)
|   dispatch on `backend`       |
|     "pi"           -> runPi    |
|     "sandbox-agent"-> runSandboxAgent
+-------------------------------+
```

The service always constructs a `SandboxAgentBackend` (`select_backend` in `app.py`). The
transport is a deployment choice, made by `_runner_config.resolve_runner_command` and the
adapter's `_deliver`:

- **HTTP**, when `url` is set. The service reads it from `AGENTA_RUNNER_URL`
  (`config.runner_url()`). This is the deployed-container path: the sidecar is its own
  service and the Python process calls it in-network.
- **Subprocess CLI**, when `url` is unset. The service passes `cwd` from `config.runner_dir()`
  (overridable with `AGENTA_RUNNER_DIR`), and the adapter spawns the default command
  `pnpm exec tsx src/cli.ts` in that directory. This is the source-checkout / local-dev path.

`resolve_runner_command` fails fast with `AgentRunnerConfigurationError` if it gets neither a
`url`, an explicit `command`, nor a `cwd` that actually contains `src/cli.ts`. There is no
silent "do nothing" runner.

### Engine identity

The engine id is not in the user-facing config. Each backend hard-codes it
(`InProcessPiBackend._ENGINE = "pi"`, `SandboxAgentBackend._ENGINE = "sandbox-agent"`) and
stamps it on the payload as `backend`. The subprocess transport also exports it as the
`AGENT_BACKEND` env var, as a backstop. At dispatch time the **payload's `backend` field
wins**; `AGENT_BACKEND` is only the fallback when the field is absent, and the runner's own
default is `sandbox-agent`.

### Relevant environment variables

| Variable | Side | Effect |
| --- | --- | --- |
| `AGENTA_RUNNER_URL` | service | Set -> HTTP transport to this base URL. Unset -> subprocess CLI. |
| `AGENTA_RUNNER_DIR` | service | Overrides the runner checkout dir used for the subprocess transport. |
| `AGENTA_RUNNER_TIMEOUT_SECONDS` | service | Per-call transport timeout. Default `180`. |
| `AGENT_BACKEND` | runner | Fallback engine when the request omits `backend`. Default `sandbox-agent`. |
| `PORT` | runner | HTTP listen port. Default `8765`. |

## 5. The runner HTTP surface

The sidecar serves two routes from Node's built-in `http` server (no framework). Source:
`services/agent/src/server.ts`.

### `GET /health`

Returns runner identity so a client can detect an incompatible runner before the first run.

```json
{
  "status": "ok",
  "runner": "0.1.0",
  "protocol": 1,
  "engines": ["pi", "sandbox-agent"],
  "harnesses": ["pi", "claude", "agenta"]
}
```

`protocol` is the MAJOR of the `/run` wire contract (`PROTOCOL_VERSION` in `version.ts`).
`runner` is the package build version, which is independent of the protocol. See
[Section 11](#11-versioning-and-the-change-both-sides-rule).

### `POST /run`

Body is an `AgentRunRequest` ([Section 7](#7-the-run-request)). Response depends on the
`Accept` header:

| `Accept` | Mode | Response |
| --- | --- | --- |
| absent or anything but NDJSON | one-shot | One `AgentRunResult` JSON. HTTP `200` when `ok`, `500` when not. |
| `application/x-ndjson` | streaming | An NDJSON stream of `StreamRecord` lines, always under HTTP `200`. |

Other status codes from the route:

| Status | Cause |
| --- | --- |
| `400` | Request body is present but not valid JSON. |
| `404` | Any path other than `GET /health` or `POST /run`. |
| `500` | One-shot run returned `ok:false`, or an unexpected error in the request listener. |

An empty body parses to `{}` rather than erroring. The runner then runs with all-default
fields, which is what the contract tests rely on.

## 6. Transports in detail

There are four delivery functions, two per transport, in
`sdks/python/agenta/sdk/agents/utils/ts_runner.py`. The backend's `_deliver` (one-shot) and
`_deliver_stream` (streaming) pick HTTP vs subprocess by the same `if self._url:` rule.

### One-shot

- **HTTP** (`deliver_http`): `POST {url}/run` with the JSON body, parse the JSON response.
  Any status `>= 400` raises `RuntimeError("Agent runner HTTP {status}: {body}")` so a
  transport failure is a clear error, not an opaque parse failure.
- **Subprocess** (`deliver_subprocess`): spawn the command, write the JSON to stdin, read
  stdout. stdout carries the result and nothing else; logs go to stderr. Empty stdout raises
  with the exit code and stderr tail. Non-JSON stdout raises with both stream tails.

### Streaming (NDJSON)

- **HTTP** (`deliver_http_stream`): `POST {url}/run` with `Accept: application/x-ndjson`,
  yield each parsed line as it arrives. The `async with` client closes the connection when
  the generator is closed or cancelled, which the runner observes as a client disconnect and
  turns into run cancellation ([Section 9](#9-cancellation-and-timeouts)).
- **Subprocess** (`deliver_subprocess_stream`): spawn the command with `--stream`, write the
  request to stdin, read stdout line by line against a deadline. A `finally` kills the child
  if the consumer stops early, so a dropped stream never leaks a runner process.

Both streaming transports enforce the terminal-result invariant
([Section 8](#8-streaming-framing)): if the stream drains without a `result` record, they
raise `RuntimeError("Agent runner stream ended without a terminal result record")`.

### Symmetry guarantee

The one-shot and streaming paths return the *same* `AgentRunResult` shape. The streaming
terminal record carries the identical result object the one-shot path would return, so the
Python side parses both with the same `result_from_wire`. The only difference: on the
streaming path the terminal result's `events` is emptied, because the events were already
delivered live (see [Section 8](#8-streaming-framing)).

## 7. The `/run` request

Type: `AgentRunRequest` in `services/agent/src/protocol.ts`, hand-mirrored in
`sdks/python/agenta/sdk/agents/utils/wire.py` (`request_to_wire`). camelCase on the wire.

| Field | Type | Meaning |
| --- | --- | --- |
| `backend` | string | Engine id: `pi` or `sandbox-agent`. Set by the adapter, not the user. The runner dispatches on it. |
| `harness` | string | `pi`, `claude`, or `agenta`, subject to backend support. |
| `sandbox` | string | `local` or `daytona`. The in-process Pi path is local only. |
| `sessionId` | string \| null | External conversation id. The runtime is still cold; history arrives in `messages`, not by resuming a warm session. |
| `agentsMd` | string | Instructions injected as the agent's `AGENTS.md`. |
| `model` | string | Requested model id (`gpt-5.5`) or `provider/id` (`openai-codex/gpt-5.5`). |
| `messages` | ChatMessage[] | Conversation so far. The runner picks the latest user turn and replays the rest. |
| `secrets` | object | Provider keys as env vars (`{"OPENAI_API_KEY": "..."}`), resolved from the vault by the service. |
| `trace` | TraceContext \| null | Trace context so the run nests under the caller's `/invoke` span. |
| `tools` | string[] | Built-in tool names to enable (harness-shaped). |
| `customTools` | ResolvedToolSpec[] | Resolved runnable tools (gateway callback, code, or client). |
| `toolCallback` | ToolCallbackContext | Where callback tools POST back. Required when `customTools` is set. |
| `mcpServers` | McpServerConfig[] | User-declared MCP servers, secret env already injected. Omitted entirely when there are none. |
| `permissions` | `{default: string, rules?: [...]}` | The agent-wide policy: `default` is one of `allow`, `ask`, `deny`, `allow_reads` (the default mode); optional `rules` are authored patterns (for example `Bash(rm:*)`) that override `default` for matching harness builtins. Read by the runner's shared decision function (`permission-plan.ts`), consulted by both the ACP responder and the tool relay. |
| `systemPrompt` | string | Pi only: replace Pi's base system prompt. `AGENTS.md` is still appended after it. |
| `appendSystemPrompt` | string | Pi only: append to Pi's base prompt without replacing it. |
| `prompt` | string | Optional explicit latest turn. Falls back to the last user message in `messages`. |
| `skills` | string[] | Bundled skill directory names to force-load (the Agenta harness). |

### How the request is assembled

`request_to_wire` does not list tool, prompt, or MCP fields literally. It spreads three
harness-shaped helpers off the config object:

- `config.wire_tools()` shapes `tools` / `customTools` / `toolCallback` / `permissions`
  per harness. Pi and Claude both send the same `permissions` block now; they still differ
  in tool shape (Pi sends built-ins plus native specs, Claude sends MCP-delivered specs).
- `config.wire_prompt()` adds `systemPrompt` / `appendSystemPrompt` only for harnesses that
  expose them (Pi). It is empty otherwise.
- `config.wire_mcp()` adds `mcpServers` only when the user declared some, so a tool-free run's
  payload is byte-for-byte unchanged.

The engine id is passed in explicitly by the caller (the adapter), because each adapter
hard-codes its own.

### ResolvedToolSpec

A tool the service already resolved. Three orthogonal axes:

- `kind` (the executor): `callback` POSTs back through Agenta's `/tools/call` (gateway tools;
  the Composio key stays server-side); `code` runs `code` in a sandbox subprocess with `env`
  (scoped resolved secrets); `client` is fulfilled by the browser across a turn boundary.
  Absent means `callback` for back-compat.
- `permission`: `allow`, `ask`, `deny`, or unset (inherit the agent's policy). The runner's
  shared decision function resolves the effective value; there is no separate
  `needsApproval` field.
- `render`: a generative-UI hint (`component`, `source`, or `spec`).

`callRef` is set for `callback` tools only (the slug the bridge sends back). `runtime` / `code`
/ `env` are set for `code` tools. Provider keys and connection auth never ride on the spec;
they stay server-side.

### Worked example (Pi)

From `golden/run_request.pi.json`:

```json
{
  "backend": "pi",
  "harness": "pi",
  "sandbox": "local",
  "sessionId": "sess-1",
  "agentsMd": "You are a helpful assistant.",
  "model": "openai-codex/gpt-5.5",
  "messages": [{"role": "user", "content": "hi"}],
  "secrets": {"OPENAI_API_KEY": "sk-test"},
  "trace": {
    "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    "endpoint": "https://otlp.example/v1/traces",
    "authorization": "Access tok-123",
    "captureContent": true
  },
  "tools": ["read", "write"],
  "customTools": [
    {
      "name": "get_user",
      "description": "Get a user",
      "inputSchema": {"type": "object", "properties": {}},
      "callRef": "tools__composio__github__GET_THE_AUTHENTICATED_USER__github-tvn",
      "kind": "callback"
    }
  ],
  "toolCallback": {
    "endpoint": "https://api.example/tools/call",
    "authorization": "Access tok-123"
  },
  "permissions": {"default": "allow_reads"},
  "systemPrompt": "You are Pi.",
  "appendSystemPrompt": "Be terse."
}
```

The Claude golden (`run_request.claude.json`) differs as the harness shaping predicts: no
`tools` built-ins beyond an empty list, no Pi prompt overrides, `permissions: {"default":
"deny"}`, and `backend: "sandbox-agent"`.

## 8. The `/run` result and the event model

Type: `AgentRunResult` in `protocol.ts`, parsed by `result_from_wire` in `wire.py`.

| Field | Type | Meaning |
| --- | --- | --- |
| `ok` | bool | Success flag. `false` makes the Python side raise (see below). |
| `output` | string | Final assistant text. What the playground renders. |
| `messages` | ChatMessage[] | Structured assistant messages for the turn. |
| `events` | AgentEvent[] | Structured event log. Empty on the streaming path. |
| `usage` | AgentUsage | Token/cost totals, rolled onto the caller's workflow span. |
| `stopReason` | string | Why the turn ended, when the harness reports it. |
| `capabilities` | HarnessCapabilities | What the harness was probed to support this run. |
| `sessionId` | string | Session id, carried forward by the adapter for the next turn. |
| `model` | string | Model actually used. |
| `traceId` | string | Trace id of the run (the caller's trace when a traceparent was passed). |
| `error` | string | Failure message, set when `ok` is `false`. |

### `ok` is a hard boundary

`result_from_wire` raises `RuntimeError(f"Agent run failed: {error}")` whenever `ok` is
falsey. A failed run never reaches the model loop as an empty reply; it surfaces as a clear
Python exception. This holds on both the one-shot and streaming paths, because both parse the
terminal result with the same function.

### The event model

`AgentEvent` mirrors the ACP `session/update` variants the runner surfaces. Two text families
coexist and a consumer sees one or the other for a given block, never both:

- **Coalesced**: `message` and `thought` carry a whole block. These appear in the one-shot
  result's `events` log, because the non-streaming path has no per-token granularity to
  recover.
- **Lifecycle / delta**: `message_start` / `message_delta` / `message_end` and the matching
  `reasoning_*` trio are emitted live on the streaming path. A consumer that sees the delta
  family for a block never also sees a coalesced `message` for it.

The full variant set:

| Event | Carries |
| --- | --- |
| `message` / `thought` | `text` (coalesced block) |
| `message_start/delta/end` | `id`, `delta` (live assistant text) |
| `reasoning_start/delta/end` | `id`, `delta` (live reasoning) |
| `tool_call` | `id?`, `name?`, `input?`, `render?` |
| `tool_result` | `id?`, `output?`, `data?` (structured), `isError?`, `render?` |
| `interaction_request` | `id`, `kind` (`permission` / `input` / `client_tool`), `payload?`. A HITL request; the reply returns cross-turn in the next `/messages` history, matched by `id`. |
| `data` | `name`, `data`, `transient?` (one-way generative UI) |
| `file` | `url`, `mediaType` |
| `usage` | `input?`, `output?`, `total?`, `cost?` |
| `error` | `message` |
| `done` | `stopReason?` |

`result_from_wire` drops any event whose `type` it does not recognize, rather than failing the
whole parse. The `run_result.ok.json` golden includes a typeless event specifically to pin
that drop behavior.

### Capabilities

`HarnessCapabilities` is probed from the runtime (`sandbox-agent` `AgentCapabilities`) and
returned in the result. The runner branches on these flags rather than on the harness name:
`textMessages`, `images`, `fileAttachments`, `mcpTools`, `toolCalls`, `reasoning`, `planMode`,
`permissions`, `usage`, `streamingDeltas`, `sessionLifecycle`.

### Worked example (success)

From `golden/run_result.ok.json`, abridged:

```json
{
  "ok": true,
  "output": "Hello!",
  "messages": [{"role": "assistant", "content": "Hello!"}],
  "events": [
    {"type": "message", "text": "Hello!"},
    {"type": "usage", "input": 10, "output": 5, "total": 15, "cost": 0.001},
    {"type": "done", "stopReason": "end_turn"}
  ],
  "usage": {"input": 10, "output": 5, "total": 15, "cost": 0.001},
  "stopReason": "end_turn",
  "capabilities": {"textMessages": true, "toolCalls": true, "usage": true},
  "sessionId": "sess-42",
  "model": "gpt-5.5",
  "traceId": "trace-abc"
}
```

A failure is just `{"ok": false, "error": "model exploded"}`.

## 8b. Streaming framing

When a caller asks for live delivery (HTTP `Accept: application/x-ndjson`, or the CLI
`--stream` flag), the runner writes newline-delimited JSON. Each line is a `StreamRecord`:

```ts
type StreamRecord =
  | { kind: "event"; event: AgentEvent }
  | { kind: "result"; result: AgentRunResult };
```

The framing rules are exact and load-bearing:

1. One `{kind:"event"}` record flushes the moment its `AgentEvent` is built.
2. The run ends with **exactly one** `{kind:"result"}` record. This holds for success and for
   failure: a thrown engine error becomes `{kind:"result", result:{ok:false, error}}`, not a
   dropped connection.
3. The terminal result's `events` is emptied (`{...result, events: []}`) because the events
   were already delivered live. A streaming consumer must rebuild the log from the `event`
   records, not expect it on the result.
4. A stream that ends without a terminal `result` is an error. Both Python streaming
   transports raise rather than hand the caller a resultless run.

The browser never sees this NDJSON. The `/messages` egress converts it to a Vercel UI Message
Stream over SSE. NDJSON is strictly the Python-to-runner internal framing.

## 9. Cancellation and timeouts

**Cancellation** is wired end to end on the streaming path:

- HTTP: the server listens on the *response* `close` (not the request, whose body is already
  fully read) and aborts an `AbortController` when the client drops. The signal is passed into
  `runSandboxAgent`. On the Python side, closing or cancelling the async generator closes the
  httpx connection, which the runner sees as that disconnect.
- Subprocess: the streaming transport's `finally` kills the child if the consumer breaks or is
  cancelled.

One asymmetry worth knowing: the HTTP server passes the abort `signal` to `runSandboxAgent`
but not to `runPi`, and the CLI dispatch passes no signal at all. In-process Pi and all CLI
runs are cancelled by transport teardown (connection close or process kill), not by a
cooperative in-engine signal.

**Timeouts** are transport-level on the Python side, from
`AGENTA_RUNNER_TIMEOUT_SECONDS` (default 180s). The one-shot HTTP path uses the httpx
client timeout; the one-shot subprocess path uses `asyncio.wait_for` and kills the child on
expiry; the streaming subprocess path enforces a per-read deadline. There is no separate
server-side run timeout in the runner today; a run that never ends is bounded by the caller's
transport timeout.

## 10. Error model

Failures fall into two clean classes.

1. **Transport failures**: the runner could not be reached or did not produce a parseable
   result. HTTP `>= 400`, empty stdout, non-JSON stdout, a timeout, or a stream with no
   terminal result. Each raises a `RuntimeError` with a specific message and (for subprocess)
   the exit code and stderr tail.
2. **Run failures**: the runner ran but the turn failed. The result is `{"ok": false,
   "error": "..."}`, which `result_from_wire` turns into a `RuntimeError("Agent run failed:
   ...")`. On the one-shot HTTP path this also carries HTTP `500`; on the streaming path it
   arrives as a normal terminal `result` record under HTTP `200`.

The runner hardens its own process against background crashes: when running as the server
entrypoint it installs `unhandledRejection` and `uncaughtException` handlers that log and keep
serving, instead of letting one run's stray rejection (for example a `sandbox-agent` adapter
install or a Daytona preview SSE failing off the awaited path) kill the process and take every
in-flight request with it.

## 11. Versioning and the "change both sides" rule

The contract is intentionally duplicated, not shared through an imported module. Keeping the
request/result/event/capability types in `protocol.ts` (rather than one runner importing them
from the other) is what lets `engines/pi.ts` and `engines/sandbox_agent.ts` stay peers, and it
keeps Python free of a TS dependency.

Duplication is made safe by golden fixtures and two contract tests:

- Fixtures: `sdks/python/oss/tests/pytest/unit/agents/golden/` (`run_request.pi.json`,
  `run_request.claude.json`, `run_result.ok.json`, `run_result.error.json`).
- Python asserts them in `test_wire_contract.py`.
- TypeScript asserts them in `tests/unit/wire-contract.test.ts`, which also has a compile-time
  key guard, so a drifted `protocol.ts` fails `tsc`.

**The rule:** any change to a request field, result field, event kind, or capability touches,
in the same PR: the golden fixture, `protocol.ts`, `wire.py`, and both contract tests.

`PROTOCOL_VERSION` (`version.ts`) is the wire MAJOR, surfaced on `GET /health`. It is meant to
let a client refuse a runner whose major it does not understand. Today this is an available
affordance, not an enforced guard: no Python caller probes `/health` or checks the major
before the first `/run`. Wiring that probe is open work
([Section 12](#12-known-gaps-and-open-questions)).

## 12. Known gaps and open questions

These are properties of the boundary as built, not bugs to fix inside this RFC. They are the
candidate agenda for follow-up design.

- **The runtime is cold.** Every turn is one `/run`: create a session, run, tear down.
  `sessionId` rides the wire and is carried forward, but multi-turn context comes from
  replaying `messages`, not from a warm daemon or a persisted model session. ACP
  `session/load`, fork, and warm reuse are not wired.
- **No schema validation on the runner.** `POST /run` JSON-parses the body and runs with
  whatever fields are present (an empty body becomes `{}`). There is no structural validation
  or rejection of unknown fields at the boundary; correctness rests on the golden tests, not
  on a runtime guard.
- **The version skew guard is not consumed.** `/health` exposes `protocol`, but nothing checks
  it. A client and runner can silently disagree across a major bump.
- **Pi prompt overrides are dropped on the ACP path.** `systemPrompt` / `appendSystemPrompt`
  serialize into the request, but the `sandbox-agent` Pi engine does not deliver them yet.
  They only take effect on the in-process Pi engine.
- **Cancellation is uneven.** Only `runSandboxAgent` over HTTP receives the abort signal.
  In-process Pi and all CLI runs rely on transport teardown.
- **Remote MCP is not executed.** `mcpServers` carries `http` transport on the wire, but the
  active-stack runner path executes local `stdio` MCP only. Remote servers are skipped.
- **No run-level timeout in the runner.** Only the caller's transport timeout bounds a run.
- **Result/event size is unbounded.** The one-shot result inlines the whole `events` log and
  `messages`. There is no paging or cap on the boundary.

## 13. File reference

| Concern | Python | TypeScript |
| --- | --- | --- |
| Wire types | `sdks/python/agenta/sdk/agents/utils/wire.py` | `services/agent/src/protocol.ts` |
| Transports | `sdks/python/agenta/sdk/agents/utils/ts_runner.py` | `services/agent/src/server.ts`, `src/cli.ts` |
| Backend adapters | `adapters/sandbox_agent.py`, `adapters/in_process.py`, `adapters/_runner_config.py` | `src/engines/sandbox_agent.ts`, `src/engines/pi.ts` |
| Runner identity | (consumes `/health`, not yet) | `src/version.ts` |
| Service wiring | `services/oss/src/agent/app.py`, `config.py` | n/a |
| Golden fixtures | `sdks/python/oss/tests/pytest/unit/agents/golden/` | shared (same files) |
| Contract tests | `tests/pytest/unit/agents/test_wire_contract.py` | `tests/unit/wire-contract.test.ts` |
</content>
</invoke>
