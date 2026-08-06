# Design

This document proposes the new architecture. It states the parts both options
share, gives the two options for how the harness reaches the Composio session,
compares them, and recommends one. It ends with the shared concerns: large
results, permissions, session lifecycle, and security.

Read `context.md` for why, and `research.md` for how the system works today.

## 1. Summary

Replace the one-entry-per-action config with one entry per connection plus a
tool policy. At run start, the Agenta API opens a Composio session that holds the
policy and the connected account, and exposes the tools. The model then calls a
few meta-tools (search, get schemas, execute) instead of holding a hundred
schemas. The Composio key stays in the Agenta API; the sandbox never holds it.

Two options for how the harness reaches the session:

- **Option 1, call the session's meta-tools over REST as our own tools
  (recommended).** The API resolves the connection into a few callback tool
  specs, one per meta-tool. The runner delivers them through its existing
  internal channel. When the model calls one, it relays to `POST /tools/call`,
  which calls Composio's session execute endpoint over plain HTTP, the same way
  we call Composio today. Reuses all our existing machinery and works on every
  harness including Pi.
- **Option 2, proxy the session as an MCP server.** The API runs an MCP endpoint
  that forwards to Composio; the harness dials it like a user MCP server. Cleaner
  in theory, but it needs real streaming-proxy machinery, does not work on Pi,
  and moves the trust boundary. Kept here as the considered alternative.

Both keep the model experience identical: the session exposes the same
meta-tools either way. The difference is transport and which machinery we reuse.

## 2. The config change (both options)

Today an agent stores one entry per action. We replace that with one entry per
connection and its tool policy. To avoid colliding with the existing per-action
`gateway` type, the new entry uses a distinct discriminator.

```
{
  "type": "gateway_toolkit",
  "provider": "composio",
  "integration": "github",
  "connection": "github-main",
  "tools": { "mode": "all" },
  "permission": "ask"
}
```

or, to restrict the actions:

```
"tools": { "mode": "include", "actions": ["CREATE_ISSUE", "GET_ISSUE"] }
```

Classified by what each field is, not the feature it serves:

- `provider` and `integration` are **routing**: they select the adapter and the
  toolkit.
- `connection` is **routing to a credential**: it names the stored connection
  whose token Composio uses. The token never appears here. Because a connection
  slug is unique only within a project, provider, and integration, the resolved
  identity uses the connection's UUID, not the slug alone.
- `tools` is **authorization policy**: `all` lets the model use the whole
  toolkit; `include` limits it to named actions. `actions` are Agenta action
  keys; the adapter maps them to Composio slugs server-side, so the stored config
  never depends on Composio's slug spelling.
- `permission` is **policy**: the default allow, ask, or deny.

This entry replaces up to a hundred per-action rows. The existing per-action
`gateway` type stays so old configs keep parsing, and the compat layer gives a
migration path.

## 3. What the model sees (both options)

A Composio session exposes meta-tools. We use three: search tools, get schemas,
and multi-execute. We turn off the others:

- **Manage connections: off.** The frontend already lets the agent ask the user
  to connect an integration, so we reuse that.
- **Workbench and bash: off.** We do not depend on Composio's sandbox for large
  results (section 7).

The model searches for the action it needs and calls it through multi-execute.
The real action, for example `GITHUB_CREATE_ISSUE`, is an argument to
multi-execute, not a separate tool. This is true in both options and matters for
permissions (section 8).

## 4. Option 1: call the session's meta-tools over REST (recommended)

### How it works

1. The agent config names the integration, connection, and tool policy.
2. At run start, the Agenta API gets or creates a Composio session for this
   policy (section 9), pinned to the connection's connected account, and stores
   the session id.
3. The API resolves the connection into a few callback tool specs, one per
   meta-tool, named so they cannot collide, for example
   `composio.<connection-uuid>.search`.
4. The runner delivers them through its existing internal channel. Nothing new in
   the runner.
5. When the model calls a meta-tool, the runner relays it to `POST /tools/call`.
6. `/tools/call` calls Composio's session execute endpoint over plain HTTP, with
   the key injected from `env.composio`, and returns the result. This is the same
   call shape we already use to execute a Composio tool today; the spikes
   confirmed the meta-tools are callable this way over REST, not only over MCP.

### Why this is the recommended shape

- It reuses everything: the callback transport, the result cap, tracing, the
  permission gate, and credential isolation all already exist on this path.
- It works on every harness. The runner refuses external MCP servers on Pi, so
  Option 2 cannot serve Pi; this option can, because it uses our callback tools.
- The Composio key stays exactly where it is today, in the API. The sandbox holds
  only the run's own bearer, as it does for callback tools now.
- No new streaming-proxy machinery. We call an HTTP endpoint and get a result.

### What is new

- A session lifecycle service (section 9).
- The Composio adapter gains a session-execute call (execute a meta-tool against
  a session). This is close to the existing execute call.
- Resolution changes from one spec per action to a few meta-tool specs per
  connection. This changes the gateway resolver, which today returns exactly one
  spec per config. The plan names the exact seams (`GatewayToolResolution`,
  `ToolResolver`, `/tools/resolve`).

## 5. Option 2: proxy the session as an MCP server (considered, not recommended)

### How it works

The API runs an MCP endpoint. The config resolves to one MCP server entry whose
URL points at that endpoint, delivered through the runner's user-MCP path. The
harness dials it; the endpoint injects the Composio key and forwards to the
session's MCP URL.

### Why we do not recommend it for the first version

- **It does not work on Pi.** The runner refuses external MCP servers for Pi
  (`services/runner/src/engines/sandbox_agent/run-plan.ts:591`). Option 1 has no
  such limit.
- **It is not a thin proxy once it does real work.** To cap a large result it
  must read and rewrite the response, so it cannot simply stream bytes through;
  it must understand the MCP streaming-HTTP protocol, session headers, and
  message framing. That is real, ongoing surface.
- **It moves the trust boundary.** Today the callback authorization stays
  runner-side. This option puts a project-scoped Agenta token in the sandbox MCP
  config, which on a local run is plaintext, and a shell in the sandbox could
  call the forward URL directly and skip the interactive gate. Making it safe
  needs a short-lived, forward-only capability, which is more machinery.

It stays on record because it is the natural shape if we later host user-provided
MCP servers, where the harness genuinely must speak MCP.

## 6. Comparison

| Concern | Option 1: REST meta-tools as callback tools | Option 2: MCP proxy |
|---|---|---|
| Works on Pi | Yes | No (runner refuses external MCP on Pi) |
| New API code | A session-execute call on the adapter | A streaming MCP proxy endpoint |
| Reuses result cap, tracing, permissions | Yes, all existing | Partly; the proxy re-implements capping |
| Composio key location | API, unchanged | API, but a project token enters the sandbox |
| Trust boundary vs today | Same | Changed (token in sandbox, gate can be skipped) |
| Deny / ask | Yes, per meta-tool via existing gate | Yes, per connection |
| Warm fingerprint | Stable | Stable if URL keyed on connection |
| Future user-hosted MCP servers | Needs the same work again | Direct fit |

Both deliver the same model experience and the same integration-level config. The
recommendation is Option 1 because it reuses our machinery, works on Pi, keeps the
trust boundary, and avoids a streaming proxy. Choose Option 2 only if hosting
user-provided MCP servers becomes a near-term requirement.

## 7. Large results

Composio's own result trimming does not run when we drive the session, so the fix
is ours. For the first version: cap the result at a byte budget well below the
current one megabyte, and return a short message that names the size and tells the
model to narrow, filter, or paginate. This reuses the cap the callback path
already has (`services/runner/src/tools/callback.ts`) at a lower limit, and it
closes #5341.

Two richer options are deferred:

- Write the full result to a file in the sandbox mount and return the path. This
  fits Option 1, because the runner is in the data path, but it needs mid-run
  writes into the sandbox and is not needed for the first version.
- Composio's workbench keeps a large result in Composio's sandbox and returns a
  preview. Available if a use case needs server-side piping.

## 8. Permissions and the one product decision

The real action is an argument to multi-execute, so the harness gate sees the
meta-tool, not the action. Per-action allow and deny run at `/tools/call`, which
reads the arguments. Interactive "ask the user before this one specific action"
does not work at the harness gate, because the gate does not see the action.
"Ask before any Composio action" works today. We propose to ship that and treat
per-action interactive ask as a later addition, raised from `/tools/call` if we
build it.

## 9. Session lifecycle

A Composio session holds a tool policy and a connected-account binding. Two agents
can share one connection with different policies, so the session is keyed on the
policy, not the connection alone:

```
(project_id, connection_uuid, tool_policy_hash) -> composio_session_id
```

This lives in a small dedicated mapping table with a uniqueness constraint, which
gives safe get-or-create. It does not live in the connection's `data` blob,
because that row is owned by the connections domain and its update is an unlocked
read-modify-write, so it cannot give safe get-or-create for many policies on one
connection.

Rules:

- **Immutable per policy.** A session is created for a policy hash and never
  edited. A policy change creates a new session under a new hash. We do not PATCH
  a session in place, which removes the cross-agent race and the need to reason
  about warm reuse across a policy change.
- **Reused across runs and conversations** for the same policy. Sessions do not
  expire (documented), and our meta-tool use is stateless because the workbench
  is off, so one session per policy is safe. If Composio session state ever leaks
  between conversations, we add the conversation id to the key; not needed now.
- **Pinned to the connected account.** Session creation passes Composio's
  `connected_accounts` for the toolkit, set to the connection's provider account
  id (`api/oss/src/core/gateway/connections/dtos.py:68`), so calls run through the
  account the config names, not whichever account Composio would pick.
- **Recreated lazily.** If Composio reports the session gone, we create a new one
  and retry. No background garbage collection in the first version.

A policy edit changes the resolved tool specs, which changes the warm-session
fingerprint, so the harness session reopens on its own. We do not try to keep a
warm sandbox across a policy change, because that would risk running under stale
permissions.

## 10. Security recap

The Composio key is a project-wide credential. It reaches every Agenta workspace's
connections, because Composio's user is our project and all workspaces share one
Composio project. So the key stays in the Agenta API and never enters the sandbox.
Option 1 keeps this exactly as today. Option 2 weakens it, which is one reason we
do not recommend it.

## 11. Extensibility

The design leaves room for a second provider or a user's own hosted MCP server,
but we do not build for that now. The rule that keeps a future hosted tool safe:
its sandbox-visible identity is keyed on provider and connection and stays stable
for the life of the connection, while the volatile upstream session id and the
provider credential live only in the API. A user-hosted MCP server is the case
where Option 2's shape becomes the right one; until then Option 1 is simpler.
