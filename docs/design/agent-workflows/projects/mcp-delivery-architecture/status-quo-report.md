# MCP status quo and interface recommendation

Date: 2026-07-13

This report covers user-configured MCP servers on Claude and Pi, on local and Daytona
sandboxes. It also separates that feature from Agenta's internal tool MCP, reviews the public
configuration and UI, assesses secret safety, and recommends a contract that can survive the
planned MCP gateway.

## Executive verdict

The current product is not ready to present MCP as a generally working feature.

- User-configured remote HTTP MCP is wired only for Claude. It is disabled by default in every
  deployment, including both live EE development deployments inspected for this report.
- Pi rejects every user-configured MCP server on both local and Daytona. Pi does not implement an
  MCP client. Agenta has not yet bridged remote MCP tools onto Pi's native tool plane.
- User-configured stdio is rejected for every harness and backend. The UI should not offer it.
- The `tools` or "Exposed tools" value is dead configuration. It reaches the runner wire, but no
  runtime reads it and the Claude ACP adapter does not pass it into Claude's SDK.
- The UI never initializes a server, calls `tools/list`, displays discovered tools, or displays
  connection state. Claude's SDK connects remote MCP asynchronously by default, while Agenta
  discards the status surface. A failed server therefore looks like no change.
- The current `env` field has two meanings. For stdio it means process environment. For HTTP it
  is converted into request headers. The UI labels it "Environment" in both cases.
- Static header secrets currently resolve from Agenta's vault, cross the `/run` wire as plaintext,
  and enter the Claude process as header values. PR #5242 can replace those values with opaque
  Daytona placeholders for HTTP egress, but the PR is a draft, has a dirty merge state, and is
  being recut. It is not a production-ready dependency for MCP.
- Agenta's internal `agenta-tools` MCP is separate. Pi uses its native extension and file relay.
  Local Claude uses a runner-loopback HTTP MCP. Claude on Daytona is intended to use an
  in-sandbox stdio shim and the file relay, but recent live logs show shim-delivery failures.

The first product slice should be deliberately smaller: unauthenticated remote Streamable HTTP
MCP, Claude only, with an explicit deployment capability, a connect-and-discover action, visible
status, and no stdio, environment, secrets, or manual tool-name input in the form.

## Direct answers to the reported behavior

### HTTP MCP on Claude with a local sandbox shows nothing

The live deployments have `AGENTA_AGENT_MCPS_ENABLED=false`. The service therefore refuses a
declared MCP before it reaches the runner. Current source raises `MCPDisabledError` instead of
silently stripping the server (`services/oss/src/agent/tools/resolver.py:23-46`). If the
playground still completes a run, the saved MCP array did not reach the invocation, or the
deployed path predates the fail-loud change.

After enablement, the source path is real:

1. The template reads `agent.mcps` into strict `MCPServerConfig` objects.
2. The service resolves named vault secrets.
3. The runner validates the URL and creates an ACP HTTP MCP entry.
4. The installed Claude ACP adapter converts the entry into Claude SDK `mcpServers` config.
5. Claude connects directly to the remote URL. ACP carries configuration. It does not proxy MCP
   traffic.

This path has unit and wire-contract coverage, but this audit found no live user-HTTP-MCP
acceptance evidence. It is implemented but not product-verified.

### What "Environment" and "Secrets" mean today

`Environment` is authored as `KEY=value` lines. `Secrets` is authored as
`HEADER_OR_ENV_NAME=vault_secret_name` lines.

- For stdio, `env` would be non-secret environment variables for the child process.
- For HTTP, every `env` entry becomes an HTTP request header.
- `secrets` maps the left-hand name to a project-vault secret name. The resolver reads the value
  and merges it into the same `env` map. For HTTP, that merged value becomes a header.

For a no-secret public MCP server, both fields should be empty. Today that is the only usage this
report recommends enabling.

### What "Exposed tools" means

An MCP tool is a function the server advertises through `tools/list`, with a name, description,
and JSON Schema input. The intended field is an allowlist. Empty is intended to mean all tools.

The implementation does not enforce that intent. `tools` is parsed, resolved, and serialized,
but the runner conversion in `services/runner/src/engines/sandbox_agent/mcp.ts:218-244` ignores
it. The installed Claude ACP adapter also maps only type, name, URL, and headers
(`services/runner/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:
2782-2804`).

The UI should not ask users to type tool names before it has connected and called `tools/list`.
After discovery, it can show a selectable list. The gateway must enforce the selection when it
serves `tools/list` and `tools/call`; prompt filtering alone is not a security boundary.

### Why Claude says it has no tools

There are three independent explanations in the current system:

1. The live deployment disables user MCP, so the server never reaches Claude.
2. Claude's SDK connects remote MCP asynchronously by default. Agenta does not surface
   `mcpServerStatus`, connection errors, or reconnect controls, so a bad URL looks inert.
3. A separate recent Claude plus Daytona failure prevents Agenta's internal gateway tools from
   being advertised because the in-sandbox shim could not be delivered.

The UI needs a pre-run status of `not tested`, `connecting`, `connected`, or `error`, plus the
server-reported tool count and error text. The chat model should not be the diagnostic surface.

### Why stdio exists and whether to keep it

Stdio is a standard MCP transport. The MCP client launches the server as a local subprocess and
exchanges JSON-RPC over stdin and stdout. This fits desktop tools and coding agents on a user's
machine.

It is not a viable Agenta public feature today. In Agenta's hosted architecture, accepting `npx`
or another command would launch arbitrary code on the runner host. The runner rejects it before
execution (`services/runner/src/engines/sandbox_agent/run-plan.ts:347-353`).

Recommendation:

- Remove stdio from the UI now and stop defaulting the public schema to stdio.
- Keep a legacy parser long enough to return a clear unsupported error for saved templates.
- Do not promise hosted stdio. A future managed MCP workload should be a managed server
  reference, not a command inside the agent template.
- The internal Daytona shim may use stdio as an implementation detail. It is trusted Agenta code,
  not a user MCP server and not part of the public contract.

## Two MCP channels that must remain separate

| Channel | Purpose | Who creates it | Where credentials execute |
| --- | --- | --- | --- |
| Internal `agenta-tools` | Deliver Agenta gateway, callback, and client tools to MCP-only harnesses | Runner | Runner or Agenta API |
| User MCP server | Connect an agent to an external MCP endpoint | Template author | Today Claude sends headers directly; the future gateway should hold credentials |

A fix for one channel does not fix the other.

## Current capability matrix

Score scale: 0 is absent or rejected; 1 is shape or design only; 2 is wired with component tests;
3 is integrated with end-to-end coverage; 4 is live verified; 5 is production-ready with
diagnostics, security controls, and supported operations.

### User-configured servers, no secrets

| Harness | Backend | Remote HTTP | Stdio | Score |
| --- | --- | --- | --- | --- |
| Claude | local | Code path exists, but deployment flag is off and status is hidden | Rejected | 2/5 |
| Claude | Daytona | Intended direct sandbox-to-remote connection; flag off and no live acceptance evidence | Rejected | 2/5 |
| Pi | local | Rejected before session start | Rejected | 0/5 |
| Pi | Daytona | Rejected before session start | Rejected | 0/5 |

### Agenta internal tools

| Harness | Backend | Delivery | Score |
| --- | --- | --- | --- |
| Pi | local | Pi extension plus runner tool plane | 4/5 |
| Pi | Daytona | Pi extension plus file relay | 4/5 |
| Claude | local | Runner-loopback authenticated HTTP MCP | 3/5 |
| Claude | Daytona | Trusted in-sandbox stdio shim plus file relay | 2/5 today; recent live failures |

### Product layers

| Layer | Score | Reason |
| --- | --- | --- |
| Public config model | 2/5 | Strict and round-tripped, but flat role mixing, unsupported default, and dead `tools` |
| UI | 1/5 | Offers unsupported stdio, mislabels headers, takes manual tool names, and has no status or tests |
| Claude remote HTTP adapter | 2/5 | Static wire and tests exist; default off, failures hidden, no live acceptance evidence |
| Pi remote HTTP adapter | 0/5 | Explicitly rejected |
| Secret handling on current branch | 1/5 | Vault references at rest, but values cross the run wire and enter Claude |
| Daytona opaque secret work in PR #5242 | 2/5 | Functional prototype and tests, but draft is dirty and recut pending |
| MCP gateway | 1/5 | Direction and adjacent `/tools/call` plane exist; user MCP proxy is not implemented |
| Overall user MCP product | 1.5/5 | A hidden Claude-only path, not a supported product loop |

## Protocol status outside Agenta

As of 2026-07-13, the current released MCP specification is `2025-11-25`. It standardizes stdio
and Streamable HTTP. Streamable HTTP replaced the older HTTP plus SSE transport. Current clients
and servers negotiate a protocol version and capabilities during initialization.

The `2026-07-28` revision is a release candidate and contains breaking changes. It moves the core
toward stateless HTTP, removes the old session handshake for the new revision, introduces routing
headers, and formalizes extensions and deprecation. Agenta should not encode a protocol revision
or session behavior in the public agent template. The MCP client or gateway should negotiate
versions internally.

Primary references:

- [Current specification](https://modelcontextprotocol.io/specification/2025-11-25/basic)
- [Streamable HTTP and stdio](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [Server tools and `tools/list`](https://modelcontextprotocol.io/docs/learn/server-concepts)

Product consequence: the UI should say "Remote MCP URL", not ask most users to select a
transport. The gateway owns protocol negotiation and backwards compatibility. Legacy SSE support,
if needed, belongs in gateway compatibility rather than a permanent template field.

## Secret boundary

### Current branch

The saved template contains vault secret names, not values. At run time, the resolver fetches the
values and merges them into `env` (`sdks/python/agenta/sdk/agents/mcp/resolver.py:28-66`). The
runner turns the map into HTTP headers. Plaintext is present in service memory, the `/run`
payload, runner memory, ACP session configuration, and the Claude process.

The SSRF guard requires HTTPS and blocks loopback, private, link-local, and metadata targets. It
does not make the secret opaque to code running in the same sandbox as Claude.

### PR #5242

PR #5242 separates public headers, process environment, and typed credential bindings. On
Daytona, it creates host-restricted Daytona Secrets and replaces each HTTP MCP header value with
an opaque placeholder before Claude receives the MCP entry. Daytona substitutes the value only
on outbound HTTPS requests to the exact allowed host.

That improves Daytona, but it is not the final architecture:

- The sandbox can still exercise the capability against the allowed host. Hiding bytes does not
  remove authority.
- The mechanism covers HTTP header credentials, not arbitrary credential formats or stdio.
- Local Claude still receives plaintext header values.
- PR #5242 is an open draft with `mergeStateStatus=DIRTY`. Its description says the current
  database-backed implementation should not merge unchanged and proposes a two-PR recut.

### Long-run recommendation

Keep credential values in the platform gateway for local and Daytona. The gateway connects to
the upstream MCP server, runs `tools/list`, exposes filtered public tool specs to the harness,
and executes `tools/call` with platform-held credentials. This gives Claude and Pi the same tool
plane and removes upstream secrets from every sandbox.

Daytona Secrets remain useful where direct sandbox egress still needs a credential, including an
interim direct-Claude HTTP path. They are not a substitute for the gateway.

OAuth belongs to a platform connection resource, not raw strings in the agent template. The
template should reference that connection. Token acquisition, refresh, revocation, scopes, and
callback state can then evolve without changing every agent revision.

## Recommended public interface

The current flat shape mixes connection configuration, process environment, credentials, and
tool policy:

```json
{
  "name": "memory",
  "transport": "http",
  "url": "https://memory.example.com/mcp",
  "env": {},
  "secrets": {},
  "tools": []
}
```

Adopt role-based nesting before broad availability:

```json
{
  "name": "memory",
  "connection": {
    "type": "remote_http",
    "url": "https://memory.example.com/mcp",
    "headers": {},
    "credentials": {"type": "none"}
  },
  "policy": {
    "tools": {"mode": "all"},
    "permission": "ask"
  }
}
```

A future static secret header does not move fields:

```json
{
  "connection": {
    "type": "remote_http",
    "url": "https://memory.example.com/mcp",
    "headers": {},
    "credentials": {
      "type": "header_secret_refs",
      "headers": {"Authorization": "memory_token"}
    }
  }
}
```

Future OAuth changes only the credential discriminator:

```json
{
  "connection": {
    "type": "remote_http",
    "url": "https://memory.example.com/mcp",
    "credentials": {
      "type": "oauth_connection",
      "connection_ref": "memory-production"
    }
  }
}
```

Tool selection is explicit: `{"policy":{"tools":{"mode":"include","names":["search",
"remember"]}}}`.

Contract rules:

- `connection` owns endpoint, public headers, and credentials.
- `policy` owns tool selection and permission.
- No protocol-version field. The gateway or client negotiates it.
- No stdio command in the public hosted-agent shape.
- No raw credential value in a saved agent revision.
- Empty arrays carry no overloaded meaning. Use `mode: "all"` or `mode: "include"`.
- Keep the author model separate from the internal resolved credential and placeholder contract.

## Backwards-compatible migration

Do not mutate old saved templates during invocation. Add one normalization boundary:

1. Continue accepting the legacy flat shape as version 1.
2. Convert it into the canonical nested model before resolution.
3. Emit only the nested model for newly saved MCP entries.
4. Preserve old entries byte-for-byte until the user edits or explicitly migrates them.
5. Reject legacy stdio clearly. Do not reinterpret it.
6. Treat legacy HTTP `env` as headers only in compatibility decoding.
7. Map legacy `tools: []` to `policy.tools.mode = "all"`; non-empty lists become `include`.
8. Keep resolved values and Daytona placeholders out of the author model.

This lets execution move from direct Claude MCP to the platform gateway without changing saved
agent templates.

## Recommended UI and delivery order

### Slice 1: no-secret HTTP MCP

Show server name, remote MCP URL, authentication set to `None`, a Connect button, connection
status and error, discovered tools, all-or-selected tool access, and allow/ask/deny permission.
Hide stdio, environment, raw secret mapping, and manual tool-name tags.

The Connect action should perform the same initialization and `tools/list` call as production.
Show negotiated server identity, protocol version, capabilities, and tool count. Saving an
untested server may remain possible, but the row must say "Not tested".

### Slice 2: gateway and Pi parity

Move discovery and calls behind the platform gateway. Convert discovered MCP tools into the same
public specs Pi already receives. Apply selection and permission at the gateway executor. The
same server then works on Claude and Pi, local and Daytona.

### Slice 3: authentication

Add platform connection selection and OAuth. Keep static secret-header references as a bounded
advanced option only if demand exists. Do not add raw tokens to agent templates.

### Work sequence

1. Make deployment capability visible to the frontend. Do not render an editable MCP section
   when the service has MCP disabled.
2. Remove stdio from the UI and stop seeding entries with `transport: "stdio"`.
3. Add the nested author model and legacy normalization tests. Keep the runner wire unchanged.
4. Add service-side connect and discovery for unauthenticated HTTPS MCP.
5. Surface connection state and discovered tools. Enforce selected tools.
6. Enable MCP in development and run live Claude local and Claude Daytona acceptance tests.
7. Build gateway execution and Pi projection. Run the full four-cell matrix.
8. Add connection-backed OAuth and settle the PR #5242 recut for remaining direct-sandbox use.

Do not flip the production feature flag until steps 1 through 6 are complete.

## Verification performed

- Runner MCP, run-plan, and layering tests: 76 passed.
- Python MCP resolver and wire tests selected by `-k mcp`: 10 passed.
- Service MCP gate tests: 5 passed.
- No MCP form tests exist under `web/packages/agenta-entity-ui`.
- Both live EE services inspected had `AGENTA_AGENT_MCPS_ENABLED=false`.
- Recent live logs contained Claude plus Daytona internal-shim delivery failures.
- PR #5242 was inspected live: open draft, dirty merge state, with a recut pending.

## Decision summary

- Ship remote HTTP only in the public UI.
- Start without secrets.
- Treat stdio as unsupported legacy input, not a product option.
- Remove or implement `tools`; do not keep dead configuration.
- Add connect, discover, and visible status before enablement.
- Normalize the public contract into connection, credentials, and policy roles.
- Make the gateway the long-run credential and execution boundary for Claude and Pi.
- Use Daytona Secrets only where direct sandbox egress still requires a credential.
