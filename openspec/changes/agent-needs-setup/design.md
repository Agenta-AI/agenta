# Design: agent needs setup

## Context

Owner decisions of 2026-10-26: M5 option B (an agent uses exactly the item it picked), the "needs configuration" pattern as a feature of its own, and the nine answers below. The LLM gateway is always on (CONTRACT.md section 15), so this design describes only the gateway path. Research and code notes: the needs-setup design page of the sharing program (product research, and current behavior with file and line references).

| # | Question | Decision |
| --- | --- | --- |
| 1 | Tag text | "Needs setup", with the reason on a second line |
| 2 | What blocks a run | Only model items: the model, its model key, its subscription login |
| 3 | Save | Always allowed. Runs and turning on automations are blocked only for model items |
| 4 | Schedule fire with a model item missing | Skip, no retry, schedule stays on, the automation row shows it |
| 5 | Same slug elsewhere | The same item inside one project. On a move or copy, clear the references and suggest same-slug items; never apply them |
| 6 | Where the check runs | On the server. One endpoint that `/m` calls in parallel with its other requests; it must add no wait |
| 7 | Template slots | Out of the pattern. Templates keep their own setup step |
| 8 | "Used by N agents" warning | Not in the first version |
| 9 | Slack reply | Nothing new. A model item fails the run with today's reply; other items need no reply |

The "model no longer available" design is approved: the model row shows "Needs setup" and "No longer available"; the banner says "The model needs setup before this agent can run."; Send is disabled; a click opens the model picker filtered to models the chosen key offers; picking a model clears the tag and the banner and enables Send.

## Terms

- **Item.** A thing the agent uses: a model key, a subscription login, a model, an MCP server, an MCP sign-in, a custom secret, or a connected-app connection.
- **Reference.** The place in the agent configuration that names an item, for example `agent.mcps[0].connection.slug`.
- **Requirement.** One item that the agent needs and that is not ready where it runs. An empty list means the agent is ready.
- **Model item.** The model, its model key, or its subscription login.
- **Where the agent runs.** A project, plus the principal the run acts as: the sender of a chat, the executing principal of a schedule, and for a channel turn the authority of CONTRACT.md section 4.

## Decisions

### D1. Rules

1. The check reads references only. It never changes the configuration.
2. A reference resolves only to the exact item it names. The check never replaces a missing item, by name or by default.
3. An agent with no named model key keeps the project default for its provider, as today. If the project has no key for that provider, that is a requirement.
4. Requirements are grouped by item. Five tool entries that name one connection give one requirement.
5. Only model items block a run. Every other missing item is left out of the run.
6. Saving is never blocked, and no check runs at save time (CONTRACT.md section 15).
7. A reason describes the state, not the cause. The check cannot tell a deleted item from one that never existed.

### D2. Kinds

| Kind | Reference | Ready when | Reasons |
| --- | --- | --- | --- |
| `model_key` | `agent.llm.connection`, `mode: "agenta"` | With a slug: the named key or endpoint exists where the agent runs, is active, and offers the model. Without a slug: the project has a key for the provider. | `not_chosen`, `not_found`, `not_shared`, `turned_off` |
| `subscription` | `agent.llm.connection`, `mode: "self_managed"` with a slug | The named login exists and is signed in | `not_found`, `needs_sign_in` |
| `model` | `agent.llm.model`, `provider` | The model is in the catalog the picker uses, the chosen key offers it, and the harness can run it (the test of `agentModelSelectionIsRunnable`, moved to the server) | `not_available` |
| `mcp_server` | `agent.mcps[].connection.slug` | A server with that slug exists where the agent runs and is active | `not_found`, `not_shared`, `turned_off` |
| `mcp_sign_in` | from the MCP server above | The server's connection state is `ready` | `needs_sign_in` |
| `secret` | `agent.sandbox.credentials[].secret.slug`, `tools[].secrets[]` | A secret with that slug exists where the agent runs | `not_found`, `not_shared` |
| `app_connection` | `tools[].connection`, new and old shapes | A connection with that integration and slug exists, is active and is valid | `not_chosen`, `not_found`, `not_shared`, `turned_off`, `needs_sign_in` |

`self_managed` without a slug (the runner operator's login) is not an Agenta item and is never a requirement. A missing MCP server gives one requirement (`mcp_server`); the sign-in check runs only when the server exists. Model items are `model_key`, `subscription` and `model`.

### D3. Reasons

| Reason | Meaning | Fix |
| --- | --- | --- |
| `not_chosen` | The agent uses a provider without naming a key, and the project has no key for it | Pick or connect |
| `not_found` | Nothing with this name exists where the agent runs | Pick, connect, or remove |
| `not_shared` | The item exists in the organization, and this project cannot use it (M5) | Pick, connect, remove, or ask an organization admin |
| `turned_off` | The item exists and is inactive | Turn it on if allowed, pick, or remove |
| `needs_sign_in` | The sign-in is missing, expired or rejected | Sign in again; the agent does not change |
| `not_available` | The model is not in the catalog, or the chosen key does not offer it | Pick another model |
| `needs_your_account` | The connection is "Each person's own account" and this person has not connected one (M7) | Connect your own account; anyone who can run the agent can do this |

### D4. When the check runs

| Moment | Who checks | Result |
| --- | --- | --- |
| Open an agent (chat or config pane) | `/m` calls the query route in parallel with its other requests | Tags; the banner and the composer block only for a model item |
| Edit an item | `/m` queries again after the draft changes (debounced), or marks the item ready at once after a pick in the fix sheet | Tags update |
| Save | Nothing. The commit route does not run the check. `/m` queries the new revision after the commit returns | Save always succeeds |
| Turn on a schedule, trigger or channel | The API checks the target revision as the principal the automation runs as | Refused with `agent_needs_setup` only for a model item |
| Send a message | `/m` uses the last check | Send is blocked only for a model item |
| Run start (any source) | The services agent handler, while it resolves references | A model item fails the run before the sandbox starts; other missing items are removed from the run |
| A schedule or trigger fires | The dispatcher, from the run start result | Model item: delivery `skipped`, no retry. Other items: the run happens without them |
| An item is deleted during a run | Unchanged | The tool call fails with today's `connection_unavailable` message; the next run applies these rules |

### D5. Query route

`POST /workflows/revisions/requirements/query` on the workflows router, following the `POST /query` convention in `api/AGENTS.md`. It needs view permission on the agent. It takes a saved revision or an unsaved draft.

```json
{ "workflow_revision_ref": { "id": "019d952f-0000-0000-0000-000000000000" } }
```

or `{ "parameters": { "agent": { ... } } }` for a draft. Response:

```json
{
  "count": 1,
  "status": "needs_setup",
  "requirements": [
    {
      "key": "app_connection:github/github-x1",
      "kind": "app_connection",
      "label": "GitHub",
      "reference": { "integration": "github", "slug": "github-x1" },
      "paths": ["agent.tools[2].connection", "agent.tools[3].connection"],
      "reason": "not_found",
      "blocks_run": false,
      "fix": { "can_edit_agent": true, "can_connect": true, "can_sign_in": false, "candidates": 1, "ask": null }
    }
  ]
}
```

- `status` is `ready` when `count` is 0.
- `key` is stable for one item, so the UI matches a requirement to its row.
- `paths` lists every place that uses the item. A fix writes all of them.
- `blocks_run` is true for model items only.
- `fix` is computed for the caller. `candidates` counts compatible items the caller can pick. `ask` names who can act when the caller cannot, for example `{"role": "owner", "name": "Alice"}`.
- The response never contains a secret value. When the caller cannot see a referenced item (another person's private item), the label is "Another person's account" and no slug is returned.

### D6. Run error

The services agent handler (`sdks/python/agenta/sdk/agents/handler.py`) already resolves the model key, secrets and connected apps before a run, and stops at the first failure. It runs every resolve step, collects the failures, and maps them to the requirement shape. Then it splits them:

- Model items fail the run with 422 and `failure_code: "agent_needs_setup"`, the message "The model needs setup before this agent can run.", and the `requirements` list.
- Other items are left out of the run. The handler drops the missing tools, MCP servers and secret bindings and adds no message. Today's MCP chat notice from the runner stays as it is. A missing secret stops failing the run, and an old-style connected-app tool is no longer dropped without a trace: it is left out and tagged in the editor.
- Each requirement keeps the old code as `detail.code` (`endpoint_not_found`, `subscription_connection_missing`, `subscription_login_required`, and the `invalid-sandbox-credential` error type), so logs and tests can still match them.
- The check runs in the services handler, not in the runner, so a runner of another version is not affected. Runner and services versions can differ in a deploy.
- The chat shows the error with the editor's banner, not the generic failure callout.

### D7. Automations and channels

- A new delivery state `skipped` with reason `agent_needs_setup`, used only for a model item. It is not retried: the dispatcher records it and does not raise. The schedule stays on, and the next fire runs once the agent is fixed.
- The automation row shows "Skipped: agent needs setup" and a link to the agent.
- When only other items need setup, the fire runs without them.
- Channels: nothing new. A model item fails the run, and the bot sends today's reply. Other missing items need no reply. The installation stays active.

### D8. Fix sheet and who can fix

- Pick existing: compatible items the user can use where the agent runs (the same provider for a model key, or any key that offers the model; the same integration for a connected app; any MCP server; any secret). After M5 the list is grouped by owner: Project, then Organization. After M7 a Personal group and the M7 binding choices appear.
- Suggest, never apply: when exactly one compatible item exists, the sheet selects it, and the user still confirms. A same-name item is not preferred.
- Connect new: the existing connect journey for that kind; the new item is selected when it finishes.
- Sign in again: for `needs_sign_in`, the existing sign-in journey. It does not change the agent and needs no edit permission on the agent.
- Remove from agent: for tools, MCP servers and secrets. Not for model items.
- One write: a pick or a removal writes every path and saves one new revision, with the message "Set up {label}".
- A model key that does not offer the current model asks for a model in the same step.

| Action | Needs |
| --- | --- |
| Pick another item, remove an item | Edit permission on the agent |
| Connect a new project item | Edit permission on the agent, and the create permission for that kind (`EDIT_SECRET` for vault keys and secrets, `EDIT_LLM_ENDPOINTS` for a custom LLM endpoint) |
| Sign in again to a project item | Permission to manage that item in the project |
| Share an organization item with the project (M5) | Organization admin |
| Connect your own account (M7) | Run permission on the agent |

A viewer who cannot fix the agent sees the tag and the reason; tapping a row opens a read-only explanation that names who can fix it.

### D9. UI parts and homes

- Tag "Needs setup" and the reason line on item cards and section titles, in `@agenta/entity-ui` next to `AgentTemplateControl`. They replace today's states for this problem ("Connect key", "No model", "Unavailable", "Unresolved", "Reconnect", "Login expired", "(unavailable)", "This connection is no longer available").
- Model banner, in `@agenta/chat`, so the composer uses it. Only for a model item.
- Replace sheet (one item) and Set up sheet (steps through every requirement, with Later and Skip), in `@agenta/entity-ui`.
- The query and its state, in `@agenta/entities`.
- Mocks use the real `/m` screens and existing components only. No new layouts.

### D10. Move and copy

When move and copy exist (M6c), references to project items are cleared on the move or copy, and the Set up sheet opens in the new project. Items with the same slug there are suggested, never applied (question 5).

## Latency

| Path | Added wait |
| --- | --- |
| Open an agent | None. One more request, sent at the same time as the requests the page already makes |
| Save | None. The commit route does not change |
| Run start, model key, secrets, connected apps | None. The handler already calls their resolve endpoints; it collects failures instead of stopping at the first |
| Run start, MCP servers | One new request, sent concurrently with the other resolve calls, so no sequential round trip is added |
| Allowed schedule fire | None |

## Risks

- A missing secret no longer fails the run. An agent that needs it may give a worse answer instead of an error. Accepted (question 2).
- A tool that is left out can make an agent answer without data it needs. The only sign is the tag in the editor. Accepted (decision of 2026-10-26: no banner or notice for non-model items).
- A schedule that keeps skipping is visible only on the automation row. A notification can come later, when a notification channel exists.

## Open questions

None. All nine questions are decided.
