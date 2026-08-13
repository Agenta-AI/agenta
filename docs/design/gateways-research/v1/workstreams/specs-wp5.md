# WP5 — Test doubles

A mock LLM endpoint and a mock MCP server, first-class deliverables (D23) rather than test
scaffolding bolted on afterwards. Depends on nothing — starts immediately, in parallel with the
seed if necessary. Blocks every acceptance test in wave 1: Checkpoint A's whole target set is
"our own servers and the mocks" (`open-designs.md` OD10), so nothing downstream can be
acceptance-tested without this package.

Two deliverables per plane, and `entities.md` is explicit that only one of them is its concern:

- **The adapter-level mock** — `MockLlmAdapter` / `MockMcpAdapter`, in-process classes
  implementing the south port (`LlmUpstreamInterface` / `McpUpstreamInterface`), registered under
  the `"mock"` adapter key alongside `passthrough`/`translated` and `http`/`composio`
  (`entities.md` §9, the wiring block). No network call, no process. This is what `entities.md`
  draws in the file tree (§0, `providers/mock/adapter.py`) and what satisfies **unit and contract
  tests**: a test constructs a service with `upstream_registry=...Registry(adapters={"mock":
  MockLlmAdapter()})` and calls it directly — nothing running.
- **The deployable mock** — a standalone process speaking the real upstream protocol (OpenAI-
  compatible HTTP for the model plane, MCP Streamable HTTP for the tool plane), run as its own
  docker-compose service. `entities.md` §0 says outright: *"Not shown: the deployable mocks...
  Checkpoint A's acceptance tests additionally need the mocks running as compose services in the
  local stack (`plan.md` WP5). Those are services, not entities, and are out of this document's
  scope."* This is what satisfies **acceptance tests**: a real HTTP request travels gateway →
  passthrough/http adapter → real socket → this process → a real streamed/hung response back,
  which an in-process object cannot exercise (SSE framing over the wire, an actual timeout).

Both deliverables answer to the **same control convention**, defined once by this package so a
test behaves identically whether it drives the in-process adapter or the compose service (see
"Controllable behavior" below).

**Explicitly not built here:** the registry that picks `"mock"` for a given `(provider_key,
deployment)` pair (`select_upstream`, `core/gateways/llms/registry.py` — WP7); the MCP-plane
equivalent (`core/gateways/mcps/registry.py` — WP9); the `agenta`-namespace code that generates
the mock MCP server's catalog entry (`core/gateways/mcps/service.py` — WP9); the custom LLM
endpoint row that points a slug at the mock LLM server's URL (WP1's DAO / WP10's CRUD, seeded by
whoever owns local-stack fixtures). WP5 supplies the two processes and the classes; it does not
wire either into an endpoint.

## Files

New, all inside this package's owned paths (`workstreams/README.md`):
- `core/gateways/llms/providers/mock/adapter.py` — `MockLlmAdapter(LlmUpstreamInterface)`
- `core/gateways/llms/providers/mock/app.py` — the deployable OpenAI-compatible mock server
  (not in `entities.md`'s tree — it is the "deployable mock" the document explicitly disclaims;
  see "Missing from the design" below for the naming call this makes)
- `core/gateways/llms/providers/mock/__init__.py`
- `core/gateways/mcps/providers/mock/adapter.py` — `MockMcpAdapter(McpUpstreamInterface)`
- `core/gateways/mcps/providers/mock/app.py` — the deployable MCP Streamable HTTP mock server
- `core/gateways/mcps/providers/mock/__init__.py`

Compose wiring (owned by no other package):
- `hosting/docker-compose/oss/docker-compose.dev.yml` — two new services, `mock-llm-gateway` and
  `mock-mcp-gateway`
- `hosting/docker-compose/ee/docker-compose.dev.yml` — same two services (EE dev stack mirrors
  OSS dev for anything not license-gated, per the compose file list; the mocks are not EE work)
- `api/oss/src/utils/env.py` — one `MockGatewaysConfig` block, following the `ComposioConfig`
  shape (`env.py` lines 685–704): two URLs the mocks' own consumers (WP1/WP9/WP10) read to seed
  or generate their catalog entries

Edited: `api/entrypoints/routers.py` — two import lines only (diff below); the registry dict
entries themselves belong to WP7/WP9's wiring blocks, not this package.

## Interfaces

Reproduced verbatim from `entities.md` §7.1 — the exact shapes both adapters must satisfy. Do
not rename, do not add parameters not listed here.

```python
# core/gateways/llms/interfaces.py (seed-owned; read, not edited, by WP5)

@dataclass
class LlmRelayResult:
    status_code: int
    headers: Dict[str, str]
    body: AsyncIterator[bytes]
    usage: Optional[GatewayUsage] = None

class LlmUpstreamInterface(ABC):
    @abstractmethod
    async def relay_chat_completion(
        self, *, route: LlmResolvedRoute, secret: Optional[ResolvedSecret],
        context: LlmCallContext, body: bytes, headers: Dict[str, str],
    ) -> LlmRelayResult: ...
```

```python
# core/gateways/mcps/interfaces.py (seed-owned; read, not edited, by WP5)

@dataclass
class McpRelayResult:
    status_code: int
    headers: Dict[str, str]
    body: bytes

class McpUpstreamInterface(ABC):
    @abstractmethod
    async def relay(
        self, *, route: McpResolvedRoute, auth: McpRelayAuth,
        context: McpCallContext, body: bytes, headers: Dict[str, str],
    ) -> McpRelayResult: ...
```

Exceptions to raise, from `entities.md` §5 (`core/gateways/llms/types.py`,
`core/gateways/mcps/types.py`) — verbatim, do not add fields:

```python
class LlmUpstreamError(GatewaysError):
    def __init__(self, *, provider_key: str, status_code: Optional[int] = None,
                 detail: Optional[str] = None): ...

class McpUpstreamError(GatewaysError):
    def __init__(self, *, target: str, status_code: Optional[int] = None,
                 detail: Optional[str] = None): ...
```

`GatewayUsage` (§4.2, `core/gateways/policy/dtos.py`), populated by `MockLlmAdapter` once `body`
is exhausted, per `LlmRelayResult`'s own docstring ("usage is populated by the adapter once body
is exhausted"):

```python
class GatewayUsage(BaseModel):
    calls: int = 1
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost: Optional[float] = None
```

## `MockLlmAdapter`

```python
# core/gateways/llms/providers/mock/adapter.py

class MockLlmAdapter(LlmUpstreamInterface):
    async def relay_chat_completion(
        self, *, route, secret, context, body, headers,
    ) -> LlmRelayResult: ...
```

No constructor arguments beyond what the interface needs — registered once, statically, in
`api/entrypoints/routers.py` per the wiring snippet (§9): `"mock": MockLlmAdapter()`. It never
opens a socket; `secret` may be `None` (targets with `GatewayAuthScheme.NONE` are the
intended callers, per §2's "an endpoint with no secret is legitimate — the mock (D23)") and
the adapter does not require one either way.

**Controllable behavior, keyed by `context.model`** (a field `LlmCallContext` already carries —
no new DTO field). Three model-name suffixes, checked as a prefix match so the base model name
stays free-form:

| `context.model` | Behavior |
|---|---|
| `mock/echo` (default; any name not matching a suffix below) | Returns a well-formed chat-completion response echoing the request's last message content; if `context.stream` is set, streams it as 2–3 SSE chunks ending `data: [DONE]\n\n`, matching the OpenAI streaming shape |
| `mock/error` | Raises `LlmUpstreamError(provider_key="mock", status_code=500, detail="forced by mock/error")` |
| `mock/slow-{seconds}` | `await asyncio.sleep(seconds)` before returning the `mock/echo` response — this is what WP6's relay-side timeout must fire against; `{seconds}` is a plain integer, e.g. `mock/slow-30` |

`GatewayUsage` on a successful call: `calls=1`, `input_tokens`/`output_tokens` counted off the
request/response body length (word count is enough — this is a mock, not a tokenizer), `cost=0.0`
(the mock spends nothing).

## `MockMcpAdapter`

```python
# core/gateways/mcps/providers/mock/adapter.py

class MockMcpAdapter(McpUpstreamInterface):
    async def relay(
        self, *, route, auth, context, body, headers,
    ) -> McpRelayResult: ...
```

Unlike the real `http`/`composio` adapters, this one *is* the upstream — it parses `body` (the
caller's JSON-RPC payload) itself, because there is nothing behind it to relay to, and returns a
JSON-RPC response built in-process. This does not violate D16's transparency rule: D16 constrains
the **gateway**, which still passes `body` through this port untouched (§7.1, `McpUpstreamInterface`
docstring — "same method, same body, same response"); a mock *server* interpreting its own
JSON-RPC input is exactly what any real MCP server does.

Three tools, advertised by `tools/list` and dispatched by `tools/call`'s `params.name`:

| Tool | Behavior on `tools/call` |
|---|---|
| `echo` | Echoes `params.arguments` back as the tool result content |
| `fail` | Returns a JSON-RPC **result** carrying an MCP tool error (`isError: true`), not a transport failure — matching the pass-through rule that a server's own failure reason is not an exception (`api/AGENTS.md`'s error-envelope scope, and `McpUpstreamInterface`'s docstring: "protocol-level errors from the server are NOT exceptions") |
| `slow` | `await asyncio.sleep(seconds)` first, `seconds` from `params.arguments.seconds` (default 5) |

A transport-level failure (`McpUpstreamError`) is reserved for a distinct control path: a
`method` other than `initialize` / `tools/list` / `tools/call` / `notifications/*` raises
`McpUpstreamError(target="agenta/<slug>", status_code=501)` — there is no fourth method to mock.

**Forced scope challenges (D23's "later"): explicitly not built.** `McpScopeInsufficientError`
exists in `entities.md` §5 as a declared-but-unreachable type until the OAuth checkpoint (wave 3).
Adding a `scope-challenge` tool now would exercise a code path (`403` handling in the OAuth
client) that does not exist yet. Note the extension point in a comment; do not implement it.

## The deployable mocks

Two standalone ASGI apps, each importable and runnable independently of the main API process
(`uvicorn core.gateways.llms.providers.mock.app:app`). They implement the **same control
convention** as the adapters above, because the whole point is that a test written against the
in-process `MockLlmAdapter` and a test written against the compose service see identical
behavior for the same input:

- `core/gateways/llms/providers/mock/app.py` — a FastAPI (matching the API's own framework)
  app exposing `POST /v1/chat/completions`, OpenAI-shaped request/response, real
  `text/event-stream` SSE when `"stream": true`, dispatching on the request body's `"model"`
  field with the identical `mock/echo` / `mock/error` / `mock/slow-{n}` convention. No
  `/v1/models` route is required — the gateway's own `/v1/models` handler (WP6) answers from the
  endpoint's `model_slugs`, never by asking the upstream.
- `core/gateways/mcps/providers/mock/app.py` — a stateless-JSON-mode MCP Streamable HTTP server:
  `POST` carries JSON-RPC, `GET`/`DELETE` answer `405`, `202` for a notification — the exact shape
  `entities.md` §7.1 cites as precedent (`services/runner/src/tools/tool-mcp-http.ts`, read in
  full: stateless, no session id, no SSE leg, `application/json` responses). Same three tools as
  `MockMcpAdapter`.

Both apps expose `GET /health` for the compose healthcheck.

## Compose wiring

Following the existing profile-gated satellite-service precedent
(`hosting/docker-compose/oss/docker-compose.dev.yml`, the `composio` and tunnel services under
`with-tunnel`) for shape — copy their shape, never their names: the tunnel services belong to the
development-ingress work, which renames and adds to them (D26), but **not profile-gated** — Checkpoint A's acceptance tests need these
every run, unconditionally, matching D23 ("no third-party dependency to gate on... the gateways
have no third-party dependency to gate on" — same reasoning: the mocks are ours, not optional):

```yaml
    mock-llm-gateway:
        image: agenta-oss-dev-api:latest   # reuses the already-built api image; no new Dockerfile
        command: ["uvicorn", "oss.src.core.gateways.llms.providers.mock.app:app",
                   "--host", "0.0.0.0", "--port", "9091"]
        networks:
            - agenta-network
        restart: always
        healthcheck:
            test: ["CMD", "curl", "-sf", "http://localhost:9091/health"]
            interval: 5s
            timeout: 5s
            retries: 10

    mock-mcp-gateway:
        image: agenta-oss-dev-api:latest
        command: ["uvicorn", "oss.src.core.gateways.mcps.providers.mock.app:app",
                   "--host", "0.0.0.0", "--port", "9092"]
        networks:
            - agenta-network
        restart: always
        healthcheck:
            test: ["CMD", "curl", "-sf", "http://localhost:9092/health"]
            interval: 5s
            timeout: 5s
            retries: 10
```

Reusing the `agenta-oss-dev-api:latest` image (built already for the `api` service, `docker-
compose.dev.yml` lines 6–7) rather than a new Dockerfile: the mock apps are pure Python modules
inside the already-built `api` package tree, so the same image serves them with a different
`command`, the same move the `runner` service's `.runner` build anchor makes for its own
container, minus even that — no build step at all, just a different entrypoint on an image that
already exists.

`env.py` addition, following `ComposioConfig`'s shape exactly (`api/oss/src/utils/env.py` lines
685–704):

```python
class MockGatewaysConfig(BaseModel):
    """Local-stack mock upstream addresses (WP5). Unset in production images —
    nothing references these outside dev/gh compose."""
    llm_url: str = os.getenv("AGENTA_MOCK_LLM_GATEWAY_URL", "http://mock-llm-gateway:9091")
    mcp_url: str = os.getenv("AGENTA_MOCK_MCP_GATEWAY_URL", "http://mock-mcp-gateway:9092")
```

registered on `EnvironSettings` next to `composio` (`env.py` line 1609). WP1/WP10 (the custom LLM
endpoint row that seeds the mock) and WP9 (the `agenta`-namespace MCP entry) read these; WP5 does
not consume them itself.

## `api/entrypoints/routers.py` diff

Two import lines, added wherever the file's existing gateway-adapter imports land (near the
`ComposioConnectionsAdapter` import block, `routers.py` lines 142–150):

```diff
+from oss.src.core.gateways.llms.providers.mock.adapter import MockLlmAdapter
+from oss.src.core.gateways.mcps.providers.mock.adapter import MockMcpAdapter
```

WP7 and WP9 add the corresponding `"mock": MockLlmAdapter()` / `"mock": MockMcpAdapter()` entries
inside their own `LlmUpstreamRegistry(...)` / `McpUpstreamRegistry(...)` construction blocks
(`entities.md` §9's wiring snippet) — this package does not touch those blocks.

## Contracts this package must honour

- **No third-party dependency, ever.** Both adapters and both deployable apps depend only on
  what the API already ships (`fastapi`, `httpx`/`uvicorn` if needed) — D23 exists specifically so
  Checkpoint A needs nothing external.
- **Registered always, reachable conditionally.** The wiring snippet's own comment: `"mock":
  MockLlmAdapter(), # registered always; reachable only via the mock endpoints the local stack
  defines`. The adapter class is present in every deploy (nothing branches on environment inside
  `core/`); only the compose services and the seed data that points an endpoint at them are
  dev/gh-local concerns.
- **Same control convention on both tiers.** A test that passes on the in-process adapter and
  fails against the compose service (or vice versa) is a WP5 bug, not a caller bug.
- **Transparent-relay discipline still applies to the adapter's exceptions.** `LlmUpstreamError`
  / `McpUpstreamError` are for transport-level failures the mock is asked to simulate
  (`mock/error`); a tool's own business failure (`fail`) is a JSON-RPC result, never an exception
  — this is D16 and `api/AGENTS.md`'s pass-through rule, and the mock exists partly to prove the
  distinction is testable.
- **No secret material anywhere in this package.** The mocks' whole point is an unauthenticated
  target (`GatewayAuthScheme.NONE` on the MCP side, `secret_id=None` on the LLM side per §2); if a
  test ever needs the mocks to *require* a secret, that is a different fixture, not this one.

## Tests

Unit — nothing running, both adapters exercised as plain Python objects:
- `MockLlmAdapter().relay_chat_completion(..., context=LlmCallContext(model="mock/echo", ...))`
  returns a well-formed `LlmRelayResult`, `status_code=200`, non-empty `body`.
- `context.model="mock/error"` raises `LlmUpstreamError` with `provider_key="mock"`.
- `context.model="mock/slow-1"` takes ≥1s wall-clock (use a short value, not the eventual
  timeout-test duration) and then returns normally.
- Streaming: `context.stream=True` yields more than one chunk over `body`, terminated by `data:
  [DONE]`.
- `MockMcpAdapter().relay(...)` with a `tools/list` body returns all three tools;
  `tools/call` with `name="echo"` echoes arguments; `name="fail"` returns `isError: true` in the
  JSON-RPC **result**, not a raised exception; `name="slow"` with `arguments={"seconds": 1}` takes
  ≥1s.
- An unrecognized `method` raises `McpUpstreamError(status_code=501)`.
- `GatewayUsage` is populated (non-`None`) after a successful `relay_chat_completion` call and its
  `body` iterator is exhausted.

Contract — the same fixture both a mock and (once it exists) a real adapter must pass, run against
`MockLlmAdapter`/`MockMcpAdapter` now and reused by WP6/WP7/WP8/WP9's own adapters later. Still
nothing running:
- `relay_chat_completion`'s return type is `LlmRelayResult` for every `context.model`, never a
  raw dict or a bare exception escaping unwrapped.
- `relay`'s return type is `McpRelayResult` for every method in `{initialize, tools/list,
  tools/call}`.

Acceptance — needs the compose stack (`hosting/docker-compose/oss/docker-compose.dev.yml`) up:
- `curl -sf http://localhost:9091/health` and `.../9092/health` both return 200 once
  `mock-llm-gateway` / `mock-mcp-gateway` are healthy.
- `POST http://mock-llm-gateway:9091/v1/chat/completions` with `"model": "mock/echo"` returns a
  real OpenAI-shaped JSON body over a genuine HTTP round trip (from inside the compose network —
  the container is not published to the host by default).
- The same request with `"stream": true` returns `Content-Type: text/event-stream` and multiple
  SSE frames observable on the wire (not just in a mocked client).
- The same request with `"model": "mock/slow-30"` and a client-side timeout shorter than 30s
  observes the connection cut, proving the hang is real (a genuine open socket, not a Python
  `await` a test harness can preempt).
- `POST http://mock-mcp-gateway:9092/` with a `tools/list` JSON-RPC body returns the three tools
  over real Streamable HTTP; a bare `GET`/`DELETE` to the same URL returns `405`.

## Done test

```bash
bash hosting/docker-compose/run.sh --oss --dev --build
curl -sf http://localhost:<published-port-if-any>/... # or, from inside the network:
docker compose exec api curl -sf http://mock-llm-gateway:9091/health
docker compose exec api curl -sf http://mock-mcp-gateway:9092/health
```

Both healthchecks green, and each can be driven to fail on demand:

```bash
docker compose exec api python -c "
import asyncio, httpx
async def main():
    async with httpx.AsyncClient(base_url='http://mock-llm-gateway:9091') as c:
        r = await c.post('/v1/chat/completions', json={'model': 'mock/error', 'messages': []})
        assert r.status_code == 500
asyncio.run(main())
"
```

Matches `plan.md` WP5's own done condition verbatim: *"both mocks run in the local stack and can
be driven to fail on demand."*

## Out of scope

- `select_upstream` and the `LlmUpstreamRegistry`/`McpUpstreamRegistry` classes — WP7 / WP9.
- The `agenta`-namespace code that turns the mock MCP server's URL into a listed endpoint — WP9's
  `service.py`.
- The custom LLM endpoint row that turns the mock LLM server's URL into a reachable
  `custom/{slug}` — WP1's DAO, seeded by whichever package owns local-stack fixtures (WP10 is the
  natural owner once Endpoint CRUD exists; until then a raw `INSERT` against the migration WP1
  ships is an acceptable interim seed, not this package's job to write).
- `McpScopeInsufficientError`-driven behavior (forced scope challenges) — deferred to wave 3
  alongside the OAuth checkpoint; the type exists, the mock does not yet exercise it.
- Any change to `passthrough`/`translated`/`http`/`composio` adapters — WP6, WP7, WP8.

## Missing from the design, needs a ruling

- **The deployable mocks' implementation files.** `entities.md` explicitly places the deployable
  mocks "out of this document's scope," so `app.py` under each `providers/mock/` directory is not
  a name that document specifies — it is this spec's own choice, made because the design
  delegates the decision here rather than settling it. Flagged so a reviewer checks the naming
  call rather than assuming it was copied from `entities.md` verbatim like everything else in this
  spec.
- **The env var names** (`AGENTA_MOCK_LLM_GATEWAY_URL`, `AGENTA_MOCK_MCP_GATEWAY_URL`) and the
  compose service names (`mock-llm-gateway`, `mock-mcp-gateway`) are this package's own choice for
  the same reason — no document names them. WP1/WP9/WP10 should treat them as an interface this
  spec fixes, not as a detail to re-derive.
- **How the mock LLM server gets a seeded `custom` endpoint row in the local stack** (a migration
  data-seed, a startup fixture, or a manual `POST /gateways/llms/endpoints/` call scripted into
  `run.sh`) is not decided anywhere in `v1/`. This blocks nothing in WP5 itself but blocks the
  acceptance test that reaches the mock *through the gateway* rather than directly — raise it at
  the M1→Checkpoint A merge point.

## Checkpoint

Feeds **Checkpoint A** (`plan.md`): *"The LLM gateway and the MCP gateway both accept a call,
authorise it, resolve and inject a secret, reach a mock upstream, and return... Everything it
proves is proved against our own mocks."* WP5's direct contribution: without it there is no mock
upstream for WP6/WP7/WP8/WP9's relay paths to reach, and Checkpoint A's acceptance suite (a
permitted request reaches the mock with the caller's token replaced by the upstream secret; a
streamed response arrives byte for byte on both gateways; a tool call outside the allowlist is
refused) has nothing to run against.

*Depends on:* nothing. *Blocks:* every acceptance test in wave 1 (`plan.md`: "Blocks: every
acceptance test").
