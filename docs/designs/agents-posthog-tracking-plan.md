# Agents PostHog Tracking Plan

Status: **proposal for review** — no instrumentation added yet.

## Principle

> **Backend-first.** If a tracker's action reaches the backend — or the backend already tracks
> it — it goes on the **backend**. The **frontend** gets *only* interactions that never touch
> the server (navigation, pre-commit discovery, pure UI state).

The backend already runs a path-based analytics middleware
([analytics.py](/api/oss/src/middlewares/analytics.py#L138)) that emits a PostHog event after
every request, keyed on URL + method — it already captures app creation and revision commits.
Its one blind spot: it only sees `path / method / status / request.state`, never the body, so
it cannot tell an **agent** from a chat/completion app. The discriminator exists in the model
(`is_agent`, [workflows/dtos.py:142](/api/oss/src/core/workflows/dtos.py#L142)) but is never
surfaced to analytics. Closing that gap is the backbone of this plan.

## Metrics we want

| Metric | Owner | How |
|---|---|---|
| Activation route | Backend (`api/`) | property on `app_created` — frontend passes the entry point in the create request |
| Workflow created | Backend (`api/`) | `app_created` exists — add `is_agent` |
| Agent was run | Backend (tracing) | agent runs in `services/`, not `api/` — reuse existing OTEL spans / `spans_created`, no new event |
| Number of messages sent | Backend (tracing) | derived from the run's span / message list |
| Which features / triggers were used | Backend (`api/`) | derive from committed agent config at commit |

---

## Backend events

Two backend apps are involved: the **`api/`** app (where `analytics_middleware` lives) and the
**agent service** (`services/`), which serves agent runs at `/agent/v0` and has **no PostHog
wiring today**. Each event's owner is called out.
**E** = already emitted (add an agent property), **N** = new.

### `api/` app — analytics middleware + handlers

| Event | State | Endpoint / trigger | Product question | Properties |
|---|---|---|---|---|
| `app_created` | **E** | `POST /apps` — [analytics.py:295](/api/oss/src/middlewares/analytics.py#L295) | Agent creation volume + activation route | `is_agent`, `route` (frontend-supplied, see below) |
| `app_revision_created` | **E** | `POST /variants/configs/commit\|fork`, `PUT …/parameters` — [analytics.py:303](/api/oss/src/middlewares/analytics.py#L303) | "Finished building" milestone; iteration frequency | `is_agent`, feature counts (below) |
| `tool_connection_created` | **N** | `POST /tools/connections/` — [tools/router.py:211](/api/oss/src/apis/fastapi/tools/router.py#L211) | Connect-tool adoption | `integration` |
| `agent_archived` | **N** | `POST /{workflow_id}/archive` — [workflows/router.py:238](/api/oss/src/apis/fastapi/workflows/router.py#L238) | Lifecycle / churn | `is_agent`, `count` |

**Feature composition (properties on `app_revision_created`, agents only).** The full agent
config is in the committed `parameters.agent.*` payload
([dtos.py:307](/api/oss/src/core/workflows/dtos.py#L307)), so the commit handler derives which
features are used at commit time: `toolCount`, `mcpServerCount`, `skillCount`, `triggerCount`,
`hasTriggers`, `harness`, `connectionMode` (`agenta` | `self_managed`).

### Agent service (`services/`) — the run path

Agent chat runs through the agent service `/invoke` handler
([services/oss/src/agent/app.py](/services/oss/src/agent/app.py#L1)), mounted at `/agent/v0`
([services/entrypoints/main.py:137](/services/entrypoints/main.py#L137)). These requests **do
not** pass through the `api/` middleware, so they cannot be captured by adding a path there.

**Decision: reuse tracing for the run, add capture only for approval.** The run already emits an
**instrumented OTEL span** ([agent/tracing.py](/services/oss/src/agent/tracing.py)) and the `api/`
middleware already tracks `spans_created`, so "agent was run" and message counts come from
tracing — no new run event, no new PostHog wiring in the service for that. We add PostHog only for
the one product signal tracing doesn't cleanly express:

| Event | State | Where | Product question | Properties |
|---|---|---|---|---|
| `agent_tool_approval_submitted` | **N** | `tool_approvals` in the `/invoke` body | HITL adoption + approval rate | `approved` |

| Metric | Source |
|---|---|
| Agent was run | existing OTEL spans / `spans_created` (no new event) |
| Number of messages sent | derived from the run's span / message list |

### Backend work

1. **Agent detection (`api/`).** Set `request.state.is_agent` in the create / commit / archive
   handlers (same channel that carries `project_id` / `user_email`,
   [auth.py:535](/api/oss/src/middlewares/auth.py#L535)); read it in the middleware and attach it
   as a property. Without this, agent events can't be segmented from chat / completion.
2. **Archive mapping (`api/`).** `POST /{workflow_id}/archive` is not in
   `_get_event_name_from_path` — add it (agent-gated).
3. **Handler-level events (`api/`).** `tool_connection_created`, activation `route`, and feature
   composition need the request / committed body (the middleware can't see it), so they fire from
   inside the handlers.
4. **Approval (agent service).** Add PostHog to the agent service `/invoke` handler (no analytics
   there today) for `agent_tool_approval_submitted` only. Run volume + message counts come from
   existing tracing — no new run event.
5. **Activation route (`api/`).** The frontend passes the entry point (empty-state CTA / dropdown
   / template — [CreateAppDropdown](/web/oss/src/components/pages/app-management/components/CreateAppDropdown/index.tsx#L80))
   as a `route` field in the `POST /apps` body; the handler stashes it on `request.state` and the
   middleware attaches it to `app_created`. The route is the only frontend-supplied piece; the
   event itself stays backend-owned.
6. **Archived-in-playground edge.** Ensure opening an archived agent's playground does not emit a
   misleading `agent_run`.

---

## Frontend events

Only interactions that never reach the server (verified).

| Event | Where it fires | Why frontend | Payload |
|---|---|---|---|
| `agent_playground_opened` | Open-in-playground (navigation) — [ApplicationManagementSection.tsx:88](/web/oss/src/components/pages/app-management/components/ApplicationManagementSection.tsx#L88) | Pure `router.push`; no dedicated backend signal | `{appId, source: "menu"}` |
| `agent_session_created` | New session tab (`+`) — [AgentChatPanel.tsx:1018](/web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx#L1018) | Session tabs persist to localStorage, no backend call | — |

### Optional — discovery / friction funnel (later)

Add only when a backend feature-composition count shows a capability is under-adopted and we
need to tell **"never discovered"** from **"discovered but abandoned before commit."** These
fire on opening an add-surface (no backend request) and read as a funnel against the composition
counts.

| Event | Where it fires | Reads against |
|---|---|---|
| `agent_tool_picker_opened` | [AgentTemplateControl.tsx:309](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L309) | `toolCount` |
| `agent_trigger_menu_opened` | [AgentTemplateControl.tsx:385](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L385) | `triggerCount` |
| `agent_mcp_server_add_started` | [AgentTemplateControl.tsx:347](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L347) | `mcpServerCount` |
| `agent_skill_add_started` | [AgentTemplateControl.tsx:366](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L366) | `skillCount` |

---

## Convention

- **Backend:** `posthog.capture(distinct_id, event, properties)`; `snake_case` events. In `api/`,
  properties are enriched from `request.state` (existing middleware pattern); the agent service
  would need its own capture (none today).
- **Frontend:** `usePostHogAg().capture(name, payload)`; `snake_case` `object_action`,
  `agent_` prefix; flat camelCase payloads.

## Verification

- **Backend:** with PostHog configured, create an agent and a chat app — `app_created` fires for
  both but only the agent carries `is_agent: true`; commit an agent revision and confirm
  `app_revision_created` carries the feature counts; connect an integration, archive the agent;
  approve a tool and confirm `agent_tool_approval_submitted`. Confirm the run itself produces
  spans/traces (run volume is read from those, not a dedicated event).
- **Frontend:** confirm the two FE events fire on the pure-UI actions and that none duplicate a
  backend event.
