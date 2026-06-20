# Agent service: Q&A

Running notes answering review questions about the agent workflow implementation
(branch `feat/agent-workflows`). Questions are in no particular order.

---

## Q: Why a separate entrypoint `agent_main.py` instead of `main.py`?

Short answer: `agent_main.py` is not a replacement for `main.py`. It is an extra,
lightweight runner for testing the agent in isolation. The real integration lives in
`main.py`, and that is what the 8280 stack actually runs.

The two entrypoints:

- `services/entrypoints/main.py` is the full services app. It mounts every service
  (chat, completion, all the managed evaluators, and now the agent at `/agent/v0`). This
  is the production/dev container entrypoint and the path the playground uses
  (`/services/agent/v0/...`). The agent is a first-class part of it:
  `app.mount("/agent/v0", agent_v0_app)`.

- `services/entrypoints/agent_main.py` mounts only the agent app plus `/health`.

Why we added `agent_main.py`:

1. Isolated, fast iteration. Early on the deliverable was "a standalone agent service
   verified by curl" (no full stack). Running `main.py` pulls in the whole managed
   evaluator surface (litellm, all the builtins) and `ag.init()` for the full app.
   `agent_main.py` lets you run just the agent:
   `uv run uvicorn entrypoints.agent_main:app --port 8090` and curl it, without the rest.

2. The dedicated `:8092` Docker compose. Before the agent was integrated into the real
   stack, it ran standalone in its own compose. That container ran `agent_main.py`.

3. A place for cross-origin CORS. When the playground had to call the agent on a
   different port (`:8092` vs the web on `:8280`), the browser needs a credentialed CORS
   policy (echo the specific origin + allow credentials). `agent_main.py` sets that
   (`allow_origin_regex` + `allow_credentials=True`). `main.py` keeps the stricter
   shared services CORS, which is fine for it because, once integrated, the agent is
   served same-origin (`/services/agent/v0`) so there is no CORS at all.

Net: `main.py` is the real, integrated path (same-origin, used by the 8280 stack).
`agent_main.py` was a convenience runner for isolated local/standalone testing and the
old dedicated compose.

**Update (decision): dropped.** We removed `agent_main.py` and the two standalone
composes (`docker-compose.agent.yml`, `docker-compose.stack.yml`) to keep only the
integrated path: the agent mounted in `entrypoints/main.py` at `/agent/v0`, served by
the normal services container, with the `agent-pi` sidecar wired into
`hosting/docker-compose/ee/docker-compose.dev.yml`. If we ever want isolated runs again,
the cleaner approach is a profile/override on the real compose rather than a parallel
entrypoint.

---

## Q: How does the agent service use the workflow middleware? Which parts does it have access to (secrets, invoke, inspect, ...)?

The agent gets the whole Agenta workflow machinery "for free" because it is built the
same way as chat and completion: `ag.create_app()` + `ag.workflow(schemas=...)` +
`ag.route("/", flags={"is_chat": True})` in `services/oss/src/agent.py`. That was the
point of the Python-front decision: the Python layer provides auth, middleware,
tracing, secrets, and the invoke/inspect contract; the Node wrapper only runs Pi.

There are **two middleware layers**.

### Layer 1 — HTTP/ASGI middleware (per request)

Added by `ag.create_app()` (`sdks/.../decorators/routing.py:64`). Outermost first:

- **CORSMiddleware** — cross-origin headers. Irrelevant on the integrated same-origin
  path; it mattered only for the old cross-port setup.
- **AuthMiddleware** — verifies the caller against `{host}/api/access/permissions/check`
  and puts the resolved credential on `request.state.auth["credentials"]` (a signed
  `Secret`). With `AGENTA_SERVICES_MIDDLEWARE_AUTH_ENABLED=false` it passes the raw
  `Authorization` through without a remote check. This is the credential everything
  downstream uses.
- **OTelMiddleware** — opens the request's tracing context, i.e. the workflow span the
  whole run nests under.

### Layer 2 — Workflow middleware (inside `wf.invoke`)

Set on the workflow object (`decorators/running.py:197`), run in order around the
handler:

- **VaultMiddleware** — resolves secrets for the credential: it fetches the project's
  vault secrets from `{api_url}/secrets/`, combines them with any local secrets, checks
  access, and exposes them on the running context. (More on "access" below.)
- **ResolverMiddleware** — resolves which handler to run from the revision URI, hydrates
  references / revision / config from the backend when needed, and resolves embeds in
  parameters.
- **NormalizerMiddleware** — maps the request to the handler's arguments by inspecting
  its signature (`inputs`, `messages`, `parameters` pulled from `data`), calls
  `_agent(...)`, and wraps the return value into the response envelope, attaching
  `trace_id` / `span_id`.

### What the agent actually has access to / uses

- **invoke** — yes, fully. `POST /services/agent/v0/invoke` runs the entire chain
  (auth -> vault -> resolver -> normalizer -> `_agent`). `_agent` receives `inputs`,
  `messages`, and `parameters` already mapped for it.
- **inspect** — yes. `POST /services/agent/v0/inspect` returns the agent's interface,
  i.e. `AGENT_SCHEMAS` (chat `messages` in, `message` out, config = `model` +
  `agents_md`). This is what tells the playground to render a chat box and the two
  config fields. (Known bug: inspect currently 500s under session-cookie auth; it did
  not block the playground because the create flow takes the schema from the catalog
  template.)
- **auth / credentials** — yes. The resolved `Secret` credential is available to the
  handler and to tracing export.
- **tracing** — yes. `_agent` reads the active workflow span via `_trace_context()` and
  threads the `traceparent` (plus endpoint/auth) to the Pi sidecar, so the Pi spans
  nest under the `/invoke` span in one trace.
- **secrets** — available but **not consumed yet**. VaultMiddleware resolves the
  project's secrets on every invoke and exposes them on the running context. Chat and
  completion use them automatically because litellm reads them. The agent handler does
  not read them today; the Pi model auth currently comes from the mounted
  `~/.pi/agent` (Codex login) or `AGENTA_API_KEY`/provider env on the sidecar. Wiring
  the resolved secrets into the Pi run (the "startup hook injects the provider/tool
  keys" step) is exactly where this plugs in: read the secrets in `_agent`, pass them in
  the harness request, and have the wrapper inject them (`setRuntimeApiKey` / env). That
  is the planned secrets work, not yet built.

One detail: the route passes `secrets=None` into `wf.invoke`, so the agent does not
hand secrets in; VaultMiddleware fetches them itself from the credential. The gap is
only on the consuming side (the handler), not the resolving side.

---

## Q: Why does tracing look different / broken now vs the old trace?

Reference old trace `6ab51033...`: root `invoke_agent`, four `turn`s, several
`chat gpt-5.5` spans, and `execute_tool ls/read/bash/write` — 14 spans, with
cumulative token + cost rolled up onto the `turn` and `invoke_agent` spans.

Current trace (e.g. `329698f7...`): `_agent -> invoke_agent -> turn 0 -> chat` — 4
spans; the `chat` span has tokens + cost, the parents do not.

Tracing is **not broken** (spans land, nest correctly, the `chat` span carries model,
tokens, cost). Two things changed:

### 1. Different agent and task (the big, expected difference)

The old trace is the WP-1 POC: tools enabled (`read/bash/edit/write/ls`) and a task
that needs them ("read notes.txt, write greeting.txt"). That drives a multi-turn loop
with tool calls, so you get many turns, many `chat` spans, and `execute_tool` spans.

The current app is the hello-world chat agent: `tools=[]` and "answer in one or two
short sentences". So it does exactly one turn, no tools, one `chat`. Same
instrumentation, a trivial run. To get a rich trace again, give the agent tools
(built-in `read/bash/...` or the WP-7 runnable tools) and a task that uses them.

### 2. Cumulative token/cost rollup is lost across the process boundary (a real regression)

In the old (standalone) trace, all spans were exported by one process in one batch, so
Agenta's per-ingest-batch cumulative computation could build the roll-up tree and put
cumulative tokens/cost on `turn` and `invoke_agent`.

Now the trace is split across **two exporters**:
- Python (services container) exports `_agent` (the workflow span).
- Node (`agent-pi`) exports `invoke_agent -> turn -> chat` (the Pi spans), where
  `invoke_agent`'s parent is the **remote** `_agent`.

Agenta builds the cumulative tree per ingest batch and "attaches a span only if its
parent is already seen" (see the `orderParentFirst` comment in `agenta-otel.ts`). In the
Node batch, `invoke_agent`'s parent (`_agent`) is in the **other** (Python) batch, so the
Pi subtree is dropped from the cumulative tree. Result: the leaf `chat` keeps its raw
`incremental` tokens, but `cumulative` is missing on `chat` and there is no token/cost
rollup on `turn` / `invoke_agent` / `_agent`. (Duration still rolls up because it is
computed differently.)

So the agent- and turn-level token/cost totals you used to see are gone. This is a
side effect of nesting the agent under the Agenta workflow span (the integration goal).
The fix belongs on the tracing side (owned by the instrumentation work): compute the
cumulative roll-up across the whole trace by `trace_id` rather than per ingest batch, so
a trace split between the Python workflow span and the Node Pi spans still aggregates.
Until then, per-span (leaf `chat`) tokens/cost are correct; the rolled-up agent totals
are not.
