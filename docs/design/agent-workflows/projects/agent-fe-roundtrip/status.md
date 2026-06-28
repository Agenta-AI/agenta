# Status

Source of truth for this project. Update as work proceeds.

## What this project is

One primitive, two applications. A tool call that travels to the playground, shows the user
something, waits for the user to act, and resumes the agent with the result.

- Application 1: the agent edits its own config (`commit_revision`). Approval stays per-tool,
  not hardcoded. After a commit lands, the playground refreshes the config panel and the
  build-kit view in both the gated and the direct path.
- Application 2: the agent needs a connection it does not have (for example GitHub). Discovery
  reports it, the agent calls `request_connection`, the user finishes the OAuth flow in the
  playground, the frontend replies with a structured reference, and the agent resumes.

The design doc is [`design.md`](./design.md).

## Current state, 2026-06-28

Design ready for review. Nothing built yet. Docs-first.

The headline finding: the HITL approval flow we already ship is a client round-trip, and the
Vercel AI SDK ships the sibling half we need. The runner's "forbid client tools" becomes "emit
the call and park." No new transport.

## Decisions (locked 2026-06-28)

- D1: config-change approval is per-tool. `needs_approval` stays the tool's own field. The new
  universal requirement is the refresh, fired on commit success so it covers both the gated and
  the direct path. v1 ships a generic approval widget; the frame carries the tool name and a
  render hint for a later config-diff widget.
- D2: the connection trigger is an explicit `request_connection` tool, driven by discovery and a
  skill. Runner auto-interception is out of v1, kept only as a future option.
- D3: build the generic client-tool round-trip, not a narrow connect kind. It carries both
  applications and retires the dead `client` executor.
- D4: the result returns as a structured tool result keyed to the parked call, carrying a
  reference (integration plus slug), never the secret. The runner re-resolves from the vault on
  resume. Failure and cancel also settle the call.
- D5: `request_connection` is a hard-coded platform tool with a client executor, in the same
  catalog as `find_capabilities` and `commit_revision`. Because it is a platform tool, it is
  part of the injected build kit.

## Verified facts (grounded in code, do not relitigate)

- The neutral event `interaction_request` already carries
  `kind: "permission" | "input" | "client_tool"` (`services/agent/src/protocol.ts`). Only
  `permission` is wired. `Responder` has `onPermission` only.
- The `client` executor exists as a model (`ClientToolSpec`, `kind: "client"`), but the runner
  throws on any client tool on purpose (`services/agent/src/tools/dispatch.ts`).
- Park and resume is fully built for permission. The runner parks (stop reason `paused`),
  cold-replays on the next turn, and resolves a decision keyed by `approvalKey(name, args)`,
  read from inbound `tool_result` blocks carrying `{approved}`
  (`services/agent/src/responder.ts`).
- The playground consumes the stream with `useChat`, renders approve and deny in `ToolActivity`,
  and auto-resumes through `sendAutomaticallyWhen: agentShouldResumeAfterApproval`, which
  filters `providerExecuted !== true`
  (`web/oss/src/components/AgentChatSlice/`,
  `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts`).
- The AI SDK is on the beta channel (`ai@6.0.0-beta`, `@ai-sdk/react@3.0.0-beta`). All symbols
  we rely on are present: `addToolApprovalResponse`,
  `lastAssistantMessageIsCompleteWithApprovalResponses`, `onToolCall`, `addToolOutput`,
  `lastAssistantMessageIsCompleteWithToolCalls`, and the `providerExecuted` flag.
- `commit_revision` is a platform op with `default_needs_approval=True` and
  `default_permission="ask"`. The running variant id is bound server-side
  (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`).
- Config refresh today is imperative: the playground reads the latest revision per request
  through `workflowLatestRevisionQueryAtomFamily`. No "a revision landed" frame exists yet for
  the agent's own commit.
- Connections: `POST /tools/discover` (`find_capabilities`) returns
  `ConnectionRequirement{integration, state, connect}`. `POST /tools/connections/` returns
  `status.redirect_url`; the OAuth callback activates the connection and posts a message to the
  opener. A missing connection at resolve time raises `ConnectionNotFoundError` (HTTP 404).
  Connections live at project scope, keyed `(project_id, provider_key, integration_key, slug)`
  (`api/oss/src/apis/fastapi/tools/router.py`).

## Corrections folded into this round

- `request_connection` does not exist yet. It is proposed by this doc and built as the first
  client platform op.
- The platform op model has no `executor` field, and every existing op is server-executed by an
  HTTP method and path. `request_connection` is the first op with `executor: "client"` and no
  method or path. This is a small new shape in the catalog.
- A client tool needs no new Vercel frame. The call rides as the standard unsettled tool part,
  and the optional render hint rides the existing `data-render` channel.

## Build-kit alignment (reference, do not redesign)

The default platform tools and the authoring skill are injected, not committed. The backend
exposes them as a read-only `build_kit` descriptor at `revision.data.build_kit` in `/inspect`
(grouped `skills`, `tools`, `permissions`; rows carry `key`, `name`, `description`; permission
rows add `status`), with a per-run flag `flags.inject_build_kit` on the run request.
`request_connection` is a `tools` row in that kit. The commit refresh (`data-committed-revision`)
should also refresh the build-kit display. Owned by the default-agent-config project.

## Coordination

- agent-skills owns the skill that teaches the discover-then-connect loop. Our primitive only
  delivers the "connection ready" signal.
- default-agent-config owns the build kit and decides whether a published agent keeps
  `request_connection`.
- agent-builder-capabilities rides this primitive for triggers and subscriptions, and gates a
  live subscription test on a connection.

## Links

- Tool discovery (the connection-state source for Application 2):
  [`../tool-discovery/status.md`](../tool-discovery/status.md)
- HITL park and resume (the primitive both applications extend):
  [`../hitl-fix`](../hitl-fix)
- Default build kit (the inject-not-commit model and the `build_kit` descriptor):
  [`../default-agent-config/`](../default-agent-config/)
