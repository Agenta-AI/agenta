# Research

All calls below were run live against Composio with our org key on 2026-06-27. The key lives
in `COMPOSIO_API_KEY` (env), base URL `https://backend.composio.dev/api/v3`.

## 1. `COMPOSIO_SEARCH_TOOLS` is a plain REST call, not an MCP session

It executes through the same endpoint our adapter already uses for actions:

```
POST /api/v3/tools/execute/COMPOSIO_SEARCH_TOOLS
Headers: x-api-key: <key>
Body:
{
  "user_id": "<composio user id>",
  "arguments": {
    "queries": [ { "use_case": "post a message to a slack channel" } ],
    "session": { "generate_id": true }
  }
}
```

The `session: {generate_id: true}` is an argument to the tool, not an MCP handshake. There is a
heavier `POST /api/v3.1/tool_router/session` path that returns an MCP URL, but we do not need
it. Our `ComposioToolsAdapter.execute()` already posts to `/tools/execute/{slug}`
(`api/oss/src/core/tools/providers/composio/adapter.py:164-183`), so this is a one-method add.

## 2. The response shape (verified)

Top-level `data` keys:

```
results[]                      # one per query
toolkit_connection_statuses[]  # one per toolkit referenced across all results
tool_schemas{}                 # deduplicated, keyed by tool_slug
session                        # id + "reuse this id in later meta calls"
next_steps_guidance[]          # plain instructions to the agent
time_info, success, error
```

Each `results[]` item:

```
index, use_case
primary_tool_slugs[]     # e.g. ["SLACK_SEND_MESSAGE"]
related_tool_slugs[]     # alternatives / prerequisites, e.g. ["SLACK_FIND_CHANNELS", ...]
toolkits[]               # e.g. ["slack", "slackbot"]
recommended_plan_steps[] # ordered, annotated [Required]/[Optional]/[Fallback] steps
known_pitfalls[]         # gotchas per tool
difficulty               # "easy" | ...
execution_guidance       # short instruction string
plan_id
```

Each `tool_schemas[slug]`:

```
{ "toolkit": "GITHUB", "tool_slug": "GITHUB_CREATE_AN_ISSUE",
  "description": "...", "input_schema": { JSON Schema, with required + examples + descriptions },
  "hasFullSchema": true }
```

So the search returns matched tools + alternatives + full schemas + plan + pitfalls +
connection state in ONE call. No separate schema fetch, no separate connection query, no
rerank.

## 3. Connection state is per `user_id`, and `user_id == project_id`

This answers the load-bearing question. The same GitHub query returns different connection
state per `user_id`:

```
user_id=019e8df5-... (has active github)  -> toolkit=github has_active_connection=True
user_id=default       (no connection)     -> toolkit=github has_active_connection=False
```

And Agenta sets the Composio `user_id` to the project id when it creates a connection:

```
api/oss/src/core/gateway/connections/service.py:172   user_id=str(project_id)
api/oss/src/core/gateway/connections/service.py:324   user_id=str(project_id)
```

Therefore: to report the calling project's real connection state, `find_capabilities` must
pass `user_id = str(project_id)`. The status it gets back is exactly "does this project have an
active connection for this toolkit."

A `toolkit_connection_statuses[]` item looks like:

```
{ "toolkit": "slack", "has_active_connection": false,
  "description": "Slack is a channel-based messaging platform...",
  "status_message": "No Active connection for toolkit=slack. You MUST call
                     COMPOSIO_MANAGE_CONNECTIONS (toolkit=\"slack\") to create a connection
                     BEFORE executing any slack tools." }
```

We do not pass `status_message` through verbatim. It names a Composio meta-tool. We translate
it to the Agenta action (create a connection via `POST /tools/connections/`). See `design.md`.

## 4. What the search does NOT cover

- **Triggers / events: there is NO semantic search.** Verified 2026-06-27. The action search
  is tools-only, and Composio offers no trigger equivalent:
  - `COMPOSIO_SEARCH_TOOLS` with a trigger-phrased query ("trigger when a new message is posted
    in a slack channel") still returned action tools (`SLACK_SEND_MESSAGE`), no events.
  - `COMPOSIO_SEARCH_TRIGGERS` -> HTTP 404 (does not exist).
  - Only keyword/list paths exist: `GET /api/v3/triggers_types?toolkit_slugs=slack` (returns
    trigger types with config + payload schema + setup instructions) and the
    `COMPOSIO_LIST_TRIGGERS` meta-tool (a plain list; it ignored a `toolkit` filter arg).

  So the Slack "listen for new messages" part cannot be one-call-semantic the way tools are. It
  is a trigger (a webhook subscription), a separate Composio concept and a separate Agenta
  subsystem (`/triggers/...`). This is the concrete reason to keep triggers as a follow-up that
  uses the keyword catalog, not `find_capabilities`. Scope decision D5.
- **OAuth completion.** `has_active_connection: false` means a human still needs to authorize.
  The search reports the gap; our connection create returns the `redirect_url`.

## 5. Composio slug vs Agenta reference

Composio slugs are toolkit-prefixed: `GITHUB_CREATE_AN_ISSUE`. Our adapter strips/adds the
prefix in `_to_composio_slug` (`api/oss/src/core/tools/providers/composio/catalog.py:210-228`).
Agenta references an action as `tools.composio.<integration>.<action>.<connection_slug>` and
configures it as a `GatewayToolConfig{provider, integration, action, connection}`
(`sdks/python/agenta/sdk/agents/tools/models.py`). So we translate
`GITHUB_CREATE_AN_ISSUE` -> `{integration: "github", action: "CREATE_AN_ISSUE"}`.

## 6. Caveats and quirks to verify during build

- `session.id` came back as the literal string `"body"` for `generate_id: true`. Looks like a
  Composio quirk. For a one-shot discovery we do not reuse the session, so it is harmless, but
  confirm before relying on session continuation.
- The endpoint runs an LLM internally (it returns reasoning and a plan), so latency is a few
  seconds and it is metered on Composio's side. One call still replaces ~20.
- Connection validity: Composio's `has_active_connection` is authoritative on token validity at
  Composio. Our own `gateway_connections` rows carry the Agenta connection slug. The design
  uses our rows for the slug and Composio's status as the freshness check (they agree when we
  pass `user_id = project_id`).
- Plan steps and pitfalls reference Composio slugs in their text. Treat as guidance; optionally
  map slugs to friendly action names before showing the agent.
