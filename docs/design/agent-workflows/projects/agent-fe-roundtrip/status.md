# Status

Source of truth for this project. Update as work proceeds.

## What this project is

One primitive, two applications. A tool call travels to the playground, shows the user something,
waits for the user to act, and resumes the agent with the result.

- Application 1: the agent edits its own config (`commit_revision`). Approval stays per-tool. After
  a commit lands, the playground refreshes the config panel and the build-kit view in both the
  gated and the direct path.
- Application 2: the agent needs a connection it lacks (for example GitHub). Discovery reports it,
  the agent calls `request_connection`, the user finishes OAuth in the playground, the frontend
  replies with a structured reference, and the agent resumes.

The design doc is [`design.md`](./design.md).

## Current state — shipped (backend #4925, frontend #4934)

The client-tool round-trip is live. `request_connection` parks via the runner and resumes from the
browser's connect flow; the runner re-resolves the credential from the project vault on resume,
carrying a reference, never the secret. `commit_revision` emits a one-way `data-committed-revision`
event the playground listens for to refresh the config panel and build-kit view.

Known gap (follow-up): `data-committed-revision` fires on the create/initial commit path
(`create_workflow_revision`) and the platform-tool `/tools/call` path, but the regular
`commit_workflow_revision` endpoint (`api/oss/src/apis/fastapi/workflows/router.py:1500`) does not
emit it yet, so a normal frontend-driven commit of an existing variant does not auto-refresh.

The headline finding held: the HITL approval flow we already ship is a client round-trip, and the
Vercel AI SDK ships the sibling half. The runner's "forbid client tools" became "emit the call and
park." No new transport.

## Decisions (locked 2026-06-28)

- D1: config-change approval is per-tool. `needs_approval` stays the tool's own field. The universal
  requirement is the refresh, fired on commit success so it covers both the gated and the direct
  path. v1 ships a generic approval widget; the frame carries the tool name and a render hint for a
  later config-diff widget.
- D2: the connection trigger is an explicit `request_connection` tool, driven by discovery and a
  skill. Runner auto-interception is out of v1.
- D3: build the generic client-tool round-trip, not a narrow connect kind. It carries both
  applications and wires the declared-but-dormant `client_tool` interaction path.
- D4: the result returns as a structured tool result keyed to the parked call, carrying a reference
  (integration plus slug), never the secret. The runner re-resolves from the vault on resume.
  Success, failure, cancel, and abandon all settle the call.
- D5: `request_connection` is a non-runnable reference tool: a hard-coded platform workflow the
  build kit embeds with `@ag.embed`, like the authoring skill. It is not a platform op. The backend
  exposes the tool; the frontend handles the call.

## Verified facts (grounded in code, do not relitigate)

- The neutral event `interaction_request` carries
  `kind: "permission" | "input" | "client_tool"` (`services/agent/src/protocol.ts`). Only
  `permission` is wired; `Responder` has `onPermission` only. `input` and `client_tool` are
  forward-looking.
- A client tool is correctly refused in-sandbox: `dispatch.ts` throws because it is browser-
  fulfilled (`services/agent/src/tools/dispatch.ts`). Missing is the emit-and-park path that runs
  before dispatch.
- The cold-replay anchor is `approvalKey(name, args)` (`services/agent/src/responder.ts`). CodeRabbit
  flagged the approval-specific name; rename it to `parkedCallKey`.
- Park and resume is fully built for permission. The runner parks (stop reason `paused`),
  cold-replays on the next turn, and resolves a decision read from inbound `tool_result` blocks
  carrying `{approved}` (`services/agent/src/responder.ts`).
- The playground consumes the stream with `useChat`, renders approve and deny in `ToolActivity`, and
  auto-resumes through `sendAutomaticallyWhen: agentShouldResumeAfterApproval`, which filters
  `providerExecuted !== true` (`web/oss/src/components/AgentChatSlice/`,
  `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts`).
- The AI SDK is on the beta channel (`ai@6.0.0-beta`, `@ai-sdk/react@3.0.0-beta`). All symbols we
  rely on are present: `addToolApprovalResponse`,
  `lastAssistantMessageIsCompleteWithApprovalResponses`, `onToolCall`, `addToolOutput`,
  `lastAssistantMessageIsCompleteWithToolCalls`, and the `providerExecuted` flag.
- Tool models: `ReferenceToolConfig` (`type: "reference"`) resolves to a server-side
  `CallbackToolSpec` (`/tools/call`, backend-runnable). An `@ag.embed` of a workflow tool inlines to
  a browser-fulfilled `ClientToolSpec` (`kind: "client"`). `request_connection` takes the second
  path (`sdks/python/agenta/sdk/agents/tools/models.py`, `.../platform/workflow.py`,
  `api/oss/src/core/embeds/utils.py`).
- `commit_revision` is a platform op with `default_needs_approval=True` and
  `default_permission="ask"`. The running variant id is bound server-side
  (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`).
- Config refresh today is imperative: the playground reads the latest revision per request through
  `workflowLatestRevisionQueryAtomFamily`. No "a revision landed" frame exists yet for the agent's
  own commit.
- Connections: `POST /tools/discover` (`find_capabilities`) returns
  `ConnectionRequirement{integration, state, connect}`. `POST /tools/connections/` returns
  `status.redirect_url`; the OAuth callback activates the connection and posts a message to the
  opener. A missing connection at resolve time raises `ConnectionNotFoundError` (HTTP 404).
  Connections live at project scope, keyed `(project_id, provider_key, integration_key, slug)`
  (`api/oss/src/apis/fastapi/tools/router.py`).

## Build-kit alignment (reference, do not redesign; #4917)

The default platform tools and the authoring skill are an agent-template overlay the backend serves
read-only at `additional_context.playground_build_kit.agent_template_overlay` (a partial `parameters.agent`). The
frontend merges the overlay onto `parameters.agent` on a playground run and excludes it on commit.
There is no run flag and no service-side injection. `request_connection` joins the overlay as a
reference-tool entry (identity by its referenced workflow), beside the authoring skill's `@ag.embed`.
The commit refresh (`data-committed-revision`) also refreshes the build-kit view. Owned by the
default-agent-config project.

## Coordination

- agent-skills owns the skill that teaches the discover-then-connect loop. Our primitive only
  delivers the "connection ready" signal.
- default-agent-config (`#4917`) owns the build-kit overlay and decides whether a published agent
  keeps `request_connection`.
- agent-builder-capabilities rides this primitive for triggers and subscriptions, and gates a live
  subscription test on a connection.

## Links

- Tool discovery (the connection-state source for Application 2):
  [`../tool-discovery/status.md`](../tool-discovery/status.md)
- HITL park and resume (the primitive both applications extend):
  [`../hitl-fix`](../hitl-fix)
- Default build kit (the overlay model and the `additional_context` container):
  [`../default-agent-config/`](../default-agent-config/)
