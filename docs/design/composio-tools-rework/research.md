# Research

This file is background for engineers. It records how the system works today, in
the code, and the outside facts we learned by testing against Composio. For the
plan itself, read `design.md`, not this file.

One note to avoid confusion: some sections below describe Composio "sessions" and
an MCP server. Those are things Composio offers and shapes we looked at and
dropped. The plan does not use them. See `design.md` for what we build.

File references use `path:line`.

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

## 3. Spike results (live key, 5-7 August)

We tested against the live Composio key. The load-bearing results:

- Search and execute are callable over plain HTTP, one call each, with no
  Composio session. Composio's search (`COMPOSIO_SEARCH_TOOLS`) returns matching
  slugs and their input schemas in one response, and a returned slug executes
  directly. This is what lets the design use a search tool and an execute tool
  without a session object.
- The version pin fixes the discover-versus-resolve drift. We searched six real
  use cases across GitHub, Slack, Gmail, and Notion and got 40 tool slugs. On
  Composio's v3 default version, 36 resolved and 4 returned a 404, which is the
  #5174 drift live. On v3.1, which defaults to the latest version, all 40
  resolved. Zero of the 40 failed even on latest. So pinning to v3.1 aligns
  search and execute, and a found tool that cannot resolve is rare, not routine.
  This tests version resolvability, which is what we control; a specific call can
  still fail on bad arguments or a broken connection, as always.
- The Composio key cannot be safely reduced for the sandbox. A key scoped to
  read-only sessions was denied even from reading a session, and the scope that
  drives a session also creates and widens sessions for any workspace in the
  project. So the key stays in the Agenta API, whatever design we pick.
- Latency: the search call is about two seconds, because Composio runs a model
  inside it. A plain execute call is well under a second.

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

## 5. How tools reach the harness (why the design reuses it)

The runner already delivers every Agenta tool to the harness through one internal
channel: a loopback tool server for Claude and Codex running locally, an uploaded
relay for Daytona, and Pi's own tool registration. When the model calls a tool,
the call runs on our side and the Agenta API holds the Composio key. The new
design adds two ordinary tools (search and execute) to this same channel, so it
needs no new runner path and works on every harness, including Pi. See design.md
for the end-to-end flow.

## 6. A version caveat the code already navigates

Composio's endpoints do not agree on how they spell an action slug across
toolkit versions. The catalog list endpoint on the latest version returns short
slugs that the single-tool and execute endpoints reject, while the default
version returns the long slugs that all endpoints accept
(`api/oss/src/core/tools/providers/composio/catalog.py:212`). Our search endpoint
returns long slugs, and those resolve on v3.1 but 404 on some tools on the v3
default (section 3). So a version fix is not a single switch to latest; it must
keep the slug spelling consistent across list, search, get, and execute. This is
the delicate part of #5174.
