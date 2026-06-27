# Design: `find_capabilities`

This is the analysis the brief asked for. First, which information from
`COMPOSIO_SEARCH_TOOLS` is useful, and to whom. Then how each maps to an Agenta concept so the
agent never sees Composio. Then the `find_capabilities` request and response contract.

## Two consumers, two different needs

There are two agents in play, and they want different things from the same response:

- **The setup agent** (the builder). It is wiring a new agent. It needs: which tools to attach,
  whether the project can use them now, and what is missing. It acts on the tool configs and
  the connection state.
- **The agent being created** (the worker). It will run later. It needs: its tools (with
  schemas the model can call), and an operating procedure so it uses them correctly. It
  consumes the schemas and the plan/pitfalls, baked into its `tools` and `agents_md`.

Keeping these separate is the key to deciding what to surface and how.

## Field-by-field: useful to whom, and the Agenta translation

| Composio field | Useful to setup agent | Useful to created agent | Agenta concept it maps to | Accurate? |
|---|---|---|---|---|
| `primary_tool_slugs` | Yes. The tool(s) to attach. | It becomes its tool. | `GatewayToolConfig{provider:"composio", integration, action, connection}` and ref `tools.composio.<integration>.<action>.<slug>` | Yes. We translate `GITHUB_CREATE_AN_ISSUE` -> `{integration:"github", action:"CREATE_AN_ISSUE"}` |
| `related_tool_slugs` | Yes. Prerequisite/companion tools the one-line request omitted (e.g. `SLACK_FIND_CHANNELS`). | Often needed at runtime to complete the task. | Additional `GatewayToolConfig` candidates, marked optional | Yes |
| `toolkits` | Yes. Which integration, hence which connection. | No (indirect). | `integration_key` | Yes, direct |
| `tool_schemas[slug].input_schema` | Validates the tool and its inputs. | Load-bearing. This is what the model sees to call the tool. | `input_schema` on the resolved tool spec (`ToolResolveResponse.custom[].input_schema`) | Yes, same schema our catalog `/tools/{slug}` returns |
| `tool_schemas[slug].description` | Context. | The tool description the model reads. | tool `description` | Yes |
| `recommended_plan_steps` | Reveals the FULL tool set and order the task needs, not just the obvious action. | Becomes its operating procedure. | Draft `agents_md` content + a checklist of tools to include | Guidance, not a typed concept. References slugs; map to friendly names |
| `known_pitfalls` | Informs guardrails (e.g. non-idempotent -> set `needs_approval`). | "Things to avoid" in `agents_md`. | `agents_md` guidance; optionally per-tool `needs_approval`/`permission` | Guidance |
| `difficulty` | Signal: auto-proceed vs ask for human review. | No. | metadata | Coarse |
| `execution_guidance`, `next_steps_guidance` | The next action: resolve connections first, then run. | No. | Drives our connection-resolution + create flow | Translate (do not pass Composio tool names through) |
| `toolkit_connection_statuses[].has_active_connection` | Critical. Drives reuse / initiate / ask-user. | No. | Agenta connection state, resolved against `gateway_connections` for the project | Yes IF we pass `user_id = project_id` |
| `toolkit_connection_statuses[].status_message` | Tells it a connection is missing. | No. | Translate to "create an Agenta connection (`POST /tools/connections/`)" | Reword. Names a Composio meta-tool |
| `session` | Only for multi-call meta workflows. | No. | Ignore for one-shot discovery | Quirky (`id:"body"`) |
| `plan_id`, `time_info` | Telemetry. | No. | metadata | n/a |

### The three buckets, restated

Everything the endpoint returns falls into three buckets, and each has a clean Agenta home:

1. **Tools to attach** = `primary_tool_slugs` + `related_tool_slugs` + `tool_schemas`.
   Translate to `GatewayToolConfig` entries with `input_schema`. This is what `create_workflow`
   drops into `agent_config.tools`.
2. **Connection state to resolve** = `toolkit_connection_statuses` (read with
   `user_id = project_id`), reconciled with our `gateway_connections` rows to get the slug.
   This drives reuse / initiate / ask-user.
3. **Operating knowledge for the created agent** = `recommended_plan_steps` + `known_pitfalls`
   + descriptions. This seeds the created agent's `agents_md`.

## Translation principle: speak Agenta, not Composio

The agent works with Agenta and should not need to know Composio. So `find_capabilities`:

- returns `integration` + `action` (Agenta-shaped), never the raw `GITHUB_` slug as the
  interface. The raw slug can ride along as an opaque `provider_action` for debugging.
- expresses connection state as an Agenta connection (a slug on a project), and when missing,
  points at `POST /tools/connections/` (which returns a `redirect_url`), never at
  `COMPOSIO_MANAGE_CONNECTIONS`.
- returns tool configs already shaped as `GatewayToolConfig`, ready for `agent_config.tools`.
- returns the plan and pitfalls as structured guidance the setup agent can compose into
  `agents_md`, with Composio slugs mapped to the same `integration.action` names used elsewhere.

## The connection state machine (the part the brief keeps circling)

Per integration in the result, exactly one state, derived by combining Composio's status (read
at `user_id = project_id`) with our own connection rows:

| State | Condition | What `find_capabilities` returns | What the setup agent does |
|---|---|---|---|
| `ready` | `has_active_connection: true` and a valid `gateway_connections` row exists | the existing connection `slug` | reuse it; the tool ref is complete. **Use existing.** |
| `needs_auth` | no active connection, integration supports OAuth | an affordance: `POST /tools/connections/` -> `redirect_url` | surface the link, pause for a human to finish OAuth. **Initiate.** |
| `needs_input` | integration needs a user-supplied secret (API-key auth) | the fields to collect (from the integration `auth_schemes`) | ask the user, then create the connection. **Ask the user.** |

`ready` vs not comes straight from the search. `needs_auth` vs `needs_input` comes from the
integration's auth scheme (already in our catalog as `auth_schemes`). The agent reads a field;
it does not run a connection query.

## Request and response contract (proposed)

### Request

`find_capabilities` is the agent-facing tool. Behind it sits a project-scoped Agenta endpoint
(`POST /tools/discover`, name TBD in D1). The tool inputs:

```jsonc
{
  "use_cases": [                     // the agent passes one fragment per capability it needs
    "search github issues for a matching report",
    "create a github issue",
    "post a reply in a slack thread"
  ],
  "provider": "composio",            // default; keyword fallback for "agenta" builtin provider
  "limit_alternatives": 3            // optional, cap related tools per use case
}
// project scope comes from the run's caller auth -> project_id -> Composio user_id
```

### Response (Agenta-native)

```jsonc
{
  "capabilities": [
    {
      "use_case": "create a github issue",
      "integration": "github",
      "tool": {                                  // ready to drop into agent_config.tools
        "type": "gateway", "provider": "composio",
        "integration": "github", "action": "CREATE_AN_ISSUE",
        "connection": "github-main",             // filled when state == ready
        "input_schema": { /* JSON Schema from tool_schemas */ },
        "description": "Creates a new issue in a GitHub repository...",
        "provider_action": "GITHUB_CREATE_AN_ISSUE"   // opaque, for debugging only
      },
      "alternatives": [
        { "integration": "github", "action": "UPDATE_AN_ISSUE", "description": "..." },
        { "integration": "github", "action": "ADD_LABELS_TO_AN_ISSUE", "description": "..." }
      ],
      "connection": { "state": "ready", "slug": "github-main" },
      "difficulty": "easy"
    }
  ],
  "connections": [                                // deduped per integration, the action list
    { "integration": "github", "state": "ready", "slug": "github-main" },
    { "integration": "slack",  "state": "needs_auth",
      "connect": { "endpoint": "POST /tools/connections/",
                   "body": { "connection": { "provider_key": "composio",
                                             "integration_key": "slack", "slug": "slack-support" } } } }
  ],
  "guidance": {                                   // for composing the created agent's agents_md
    "plan_steps": [ "Resolve the channel with github... ", "..." ],
    "pitfalls":   [ "SLACK_SEND_MESSAGE is not idempotent; avoid duplicate posts", "..." ]
  },
  "ready": false                                  // true only when every connection is ready
}
```

Notes:

- `tool` is the happy-path single best match, already a `GatewayToolConfig`. `alternatives`
  lets the agent or user widen the set (the plan often needs a prerequisite like find-channel).
- `connection.slug` is present only when `state == ready`. Otherwise the agent uses the
  `connect` affordance under top-level `connections`.
- `guidance` is structured, not prose, so the setup agent composes `agents_md` how it likes.
  Offering a one-shot `agents_md` draft is a convenience we can add (D4).
- `ready` lets the agent decide in one read whether it can create-and-run now or must resolve
  connections first.

## Where it runs and what auth it uses

Consistent with [`../agent-creation-skills/custom-tools-design.md`](../agent-creation-skills/custom-tools-design.md):
the tool runs through the gateway/builtin tool path with the run's caller credential. The
search itself hits the global Composio catalog, but the connection-state join is project-scoped
(it uses the caller's `project_id` as the Composio `user_id`). A created or modified agent never
escalates beyond the caller.
