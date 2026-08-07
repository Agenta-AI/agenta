# Research

This file records how the system works today, in the code, and the outside
facts that constrain the design. It is grounded in the repo on `main` and in
live tests against Composio. File references use `path:line`.

## 1. How a third-party tool works today

### 1.1 The saved config entry

An agent stores one entry per action. The model lives at
`sdks/python/agenta/sdk/agents/tools/models.py:89` (`GatewayToolConfig`):
`provider` (default `composio`), `integration`, `action`, `connection`, and an
optional `name`. Its `reference` property is
`tools.{provider}.{integration}.{action}.{connection}`.

The frontend still writes an older shape, a function tool whose name encodes the
five parts. The compat layer (`sdks/python/agenta/sdk/agents/tools/compat.py:12`)
parses both. It keeps only the five slug parts and drops any description or
schema the frontend embedded, so a description edited in the drawer never reaches
the model.

Connections live in the `gateway_connections` table
(`api/oss/src/dbs/postgres/gateway/connections/dbes.py:38`), unique per project,
provider, integration, and slug. Tools and triggers share these rows. The
Composio identity sits in an opaque `data` JSON blob; the connected-account id is
read through a property, not a column.

### 1.2 Discovery

The agent calls the platform operation `discover_tools`. The Agenta API calls
Composio's `COMPOSIO_SEARCH_TOOLS` meta-tool
(`api/oss/src/core/tools/providers/composio/adapter.py:225`). The API returns at
most one primary tool per use case plus a few alternatives, and marks a tool
"ready" from our connection state alone
(`api/oss/src/core/tools/discovery.py`). It never checks that the tool will
resolve, which is why discovery can offer a tool that resolve then cannot find.

### 1.3 Resolve at run start

The SDK resolves all tools before the run starts
(`sdks/python/agenta/sdk/agents/handler.py:242`). For each action the API makes
one live HTTP GET to Composio (`adapter.py:117`, `get_action`). The calls are
serial and uncached. Ten tools cost ten round trips before the first token. If
one fails, the whole request fails; there is no partial path. This is the
all-or-nothing failure of #5173. The failure happens at three layers: the API
service loop (`api/oss/src/core/tools/service.py:416`), the per-tool resolve, and
the SDK gateway resolver (`platform/gateway.py:113`).

### 1.4 Version drift (#5174)

We call Composio API v3 with no version. Composio v3 defaults tool endpoints to a
frozen snapshot (`00000000_00`), while the search meta-tool and API v3.1 default
to the latest version. So discovery sees the latest catalog and resolve sees the
frozen one, and a tool present in one can be a 404 in the other. `ComposioConfig`
(`api/oss/src/utils/env.py:685`) has no version field; the version is baked into
the default URL.

### 1.5 Execute

The model's tool call reaches the API at `POST /tools/call`
(`api/oss/src/apis/fastapi/tools/router.py:1129`). The API resolves the
connection again, then calls Composio (`adapter.py:166`, `execute`). A
business-level tool failure returns HTTP 200 with an error status inside the
result; only infrastructure faults become 4xx or 5xx. The Composio key is read
from `env.composio` and injected as an `x-api-key` header (`adapter.py:54`). The
key lives only in the API.

### 1.6 How tools reach the harness (the runner)

The runner delivers tools in two separate layers
(`services/runner/src/engines/sandbox_agent/mcp.ts:355`, `buildSessionMcpServers`).

- **Internal `agenta-tools` channel.** The runner advertises the run's resolved
  tools to the harness itself. On Claude and Codex running locally, it stands up
  a loopback HTTP MCP server (`services/runner/src/tools/tool-mcp-http.ts`). On
  Daytona, where the loopback is unreachable from the sandbox, it uploads a
  stdio shim (`tool-mcp-stdio.ts`) whose calls a runner-side relay executes
  (`relay.ts`). On Pi there is no MCP; Pi loads tools through its bundled
  extension.
- **User MCP servers.** Any MCP server the user declared is delivered as an
  entry the harness dials directly (`mcp.ts`, `toAcpMcpServers`). On Daytona this
  works because it is a genuinely remote URL, and secret headers are swapped for
  a Daytona placeholder at egress.

When the model calls an internal-channel tool, the call executes server-side: the
runner holds the callback bearer and posts to the API's `/tools/call`, and the
API holds the Composio key. No Agenta or Composio credential enters the sandbox
today (`services/runner/src/tools/callback.ts`).

### 1.7 The warm-sandbox fingerprint (a hard constraint)

The runner reuses a parked sandbox between turns when a fingerprint matches
(`services/runner/src/engines/sandbox_agent/session-identity.ts:207`). The
fingerprint hashes the whole resolved tool array and every MCP server's
connection URL; only credential values are stripped. So any value visible to the
sandbox that changes when we recreate a Composio session (a session id inside a
tool identity or an MCP URL) would evict every warm sandbox. The session id must
stay server-side.

### 1.8 Result size caps today

A live tool result is capped only at 1 megabyte
(`services/runner/src/tools/callback.ts`), which is roughly 250,000 tokens. The
4,000-character cap people remember applies only when the runner replays old
turns into a cold session (`transcript.ts`), not live. This is why the 241,000
token result in #5341 reached the model intact.

## 2. What Composio provides (documented, and tested live)

- **Sessions (their Tool Router).** One session per user holds a filtered set of
  tools and exposes six meta-tools: search, get-schemas, multi-execute,
  manage-connections, a Python workbench, and a bash tool. With `mcp=True` the
  session exposes an MCP endpoint (`session.mcp.url` plus headers).
- **The MCP credential is the project key.** Tested live: `session.mcp.headers`
  is `{x-api-key: <our project key>}`. Calling the endpoint needs session-write
  access, which also creates and widens sessions for any user in the project.
  There is no session-scoped credential. The Agenta-to-Composio identity mapping
  sets Composio's `user_id` to the Agenta `project_id`
  (`api/oss/src/core/gateway/connections/service.py:174`), so "any user in the
  project" means any Agenta workspace's connections. This is why the key must
  never enter the sandbox.
- **Sessions do not expire.** Composio's docs state sessions "persist on the
  server and don't expire", and the session object carries no expiry field. We
  create one per connection and reuse it. (Two unrelated timers exist: file
  download URLs expire after one hour, half-finished connections after ten
  minutes.)
- **Filters update in place.** `PATCH` on the session changes filters without
  changing the MCP URL, so a config edit does not force a new session.
- **Version drift dies.** Search returns the tool schemas in the same response,
  so discovery and execution share one scope. There is no second endpoint on a
  different default version to disagree with.
- **Result-trimming hooks do not run over MCP.** Composio's `afterExecute` and
  schema modifiers only run on their direct SDK path, not over the MCP endpoint.
  So the large-result fix must be ours.
- **Rate limits are per organization**, shared by all our tenants.

## 3. Spike results (live key, 5-6 August)

We tested against the live Composio key. The load-bearing results:

- The session's meta-tools and its tools are callable over plain REST (through
  the session execute call), not only over MCP. This is what makes the
  recommended design reuse our existing call path instead of speaking MCP.
- A scoped key limited to Sessions=read-only was denied on the MCP endpoint with
  the message that the route "requires 'sessions' write access". So there is no
  scoped key that both drives the session and stays confined. The key stays
  server-side.
- A key-injecting proxy let a client holding no Composio key drive Composio
  tools, including a workbench call that ran a GitHub call and returned only a
  filtered summary. This confirmed the forwarding shape and the keyless sandbox.
- Latency: session create about half a second; the search meta-tool about two
  seconds because it runs a model on Composio's side; the workbench about three
  seconds cold, then about half a second warm.

## 4. Tool-piping ("toolbox") options

The question is whether the model can call several tools in one script and keep
intermediate results out of context.

- Composio's workbench meta-tool does this over MCP, keyless in the sandbox,
  proven in the spike.
- Anthropic's native programmatic tool calling cannot call MCP-sourced tools
  (documented). OpenAI's Responses API allows it but only on OpenAI models. Pi
  has none.
- Our own alternative, preferred: the API's forward point writes a large result
  to a file in the sandbox mount and returns the path, and the agent reads or
  slices the file. This works for any tool, keeps the data in our control, and
  avoids depending on Composio's workbench.

## 5. The runner delivery decision (resolved in design.md)

The open question that the design must answer: do we expose a Composio session
as our own callback tools through the internal channel, or as an MCP server that
the harness dials at an Agenta-hosted endpoint that forwards to Composio? The
answer depends on whether the second shape keeps our permissions and tracing.
The runner-plumbing findings and the decision live in design.md.
