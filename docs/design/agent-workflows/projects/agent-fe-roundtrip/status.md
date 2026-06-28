# Status

Source of truth for this project. Update as work proceeds.

## What this project is

One shared primitive, two applications. A tool call that travels up to the playground,
shows the user something, waits for the user to act, and resumes the agent with the result.

- **Problem 1** — the agent changes its own config (`commit_revision`). Approval is per-tool
  (not hardcoded); after a commit lands, the playground refreshes the config panel in both the
  gated and the direct path.
- **Problem 2** — the agent needs a connection that does not exist (for example GitHub).
  Discovery reports it; the agent calls `request_connection`; the user finishes the OAuth flow
  in the playground; the frontend auto-replies with a structured result and resumes the agent.

The design doc is [`design.md`](./design.md).

## Current state — 2026-06-28 (round 3)

Research done; design at round 3. Round 3 adds the detailed client-tool mechanism (design.md
"Part 1b") grounded in the Vercel AI SDK. Nothing built. Docs-first; the orchestrator
consolidates the converged design docs into one draft PR for Mahmoud's review.

The key finding: the HITL permission flow we already ship **is** a client round-trip, and the
Vercel AI SDK already ships the sibling half we need. The approval flow uses
`addToolApprovalResponse` + `lastAssistantMessageIsCompleteWithApprovalResponses`. Client tools
use `onToolCall` / `addToolOutput` (the renamed `addToolResult`) +
`lastAssistantMessageIsCompleteWithToolCalls`, with `providerExecuted` distinguishing
server-run from client-run tool parts. All verified present in `ai@6` / `@ai-sdk/react@3`. We
wire our runner and stream to the client-tool half and add the widgets; we invent no transport.

## Decisions (locked 2026-06-28, relayed via the orchestrator)

- **D1 — config-change approval is per-tool, not hardcoded.** `needs_approval` is the tool's
  own config, handled by the existing approval boundary. The new universal requirement is the
  refresh: fire `data-committed-revision` on commit **success**, so it covers both the gated
  and the direct path. v1 ships a generic approval UI; the frame carries tool name plus a
  `render` hint so per-tool UIs (a config diff for `commit_revision`) can be added later with
  no protocol change.
- **D2 — connection trigger is an explicit `request_connection` tool, skill-driven.** Discovery
  reports the missing connection; the skill teaches the agent to call `request_connection`.
  Runner auto-interception of a call-time failure is rejected as primary, kept only as an
  optional later safety net (out of v1).
- **D3 — build the generic client-tool round-trip**, not a narrow `connect` kind. It carries
  both applications and retires the dead `client` executor.
- **D4 — the result returns as a structured tool result (the "callback")** keyed to the parked
  call, carrying a reference (integration plus slug), never the secret. The runner re-resolves
  from the vault on resume. The "frontend auto-sends a follow-up message" framing maps to this,
  not a free-text user message.
- **D5 — `request_connection` is a hard-coded platform tool with a client executor.** Same
  catalog as `find_capabilities` and `commit_revision`, but client-executed. Resolves the
  earlier "client-executor tool vs platform tool" question (it is both). Because it is a
  platform tool it can ship in the default embedded set — coordinate with the
  default-agent-config project.

Round 3 mechanism, in brief (design.md "Part 1b"):

- **Registration:** one execution-location flag (`executor: "client"`) flows catalog -> spec ->
  wire -> playground. The runner emits-and-parks instead of dispatching to the sandbox. The
  playground registers a handler per tool keyed by `render.kind` then `name`; an unknown client
  tool renders an explicit "cannot handle" surface, never a silent hang.
- **Dispatch:** lives in the message-part renderer (sibling to `ToolActivity`), not in
  `onToolCall` (that is for headless auto client tools). The widget calls `addToolOutput`;
  `lastAssistantMessageIsCompleteWithToolCalls` auto-resends.
- **Return + UX:** the envelope is a `tool_result` keyed to the call, reference-only. UX is
  Arda's call: U1 inline status chip (lean) vs U2 chat message.
- **Post-connection handoff:** the callback only says "connection ready." The agent must
  re-discover and add the tool; the agent-creation-skills project owns that teaching.

Residual non-blocking items (render-kind string values, the `request_connection` arg/output
schema, one-vs-two resume predicates, the refresh payload fields) are in design.md and settle
during implementation with Arda.

## Verified facts (grounded in code, do not relitigate)

- Neutral event `interaction_request` already carries `kind: "permission" | "input" |
  "client_tool"` (`services/agent/src/protocol.ts`). Only `permission` is wired. `Responder`
  has only `onPermission`; `client_tool` and `input` are declared and unhandled.
- The `client` executor exists as a model (`ClientToolConfig` type, `ClientToolSpec` kind)
  but execution is forbidden in every runner path on purpose. The rails exist; the round-trip
  does not.
- Park/resume is fully built for permission. The runner parks (stop reason `paused`),
  cold-replays on the next turn, and resolves a decision keyed by `approvalKey(name, args)`.
  Decisions are read from inbound `tool_result` blocks carrying `{approved}`
  (`services/agent/src/responder.ts`).
- The playground consumes the stream with `useChat`, renders approve/deny in `ToolActivity`,
  and auto-resumes via `sendAutomaticallyWhen: agentShouldResumeAfterApproval`
  (`web/oss/src/components/AgentChatSlice/`).
- `commit_revision` is a platform op with `default_needs_approval=True`,
  `default_permission="ask"`. The running variant id is server-bound. The approval gate is
  already available (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`).
- Config refresh today is imperative: the playground reads the latest revision per request
  via `workflowLatestRevisionQueryAtomFamily`. No "a revision landed" frame exists yet for
  the agent's own commit.
- Connections: `POST /tools/discover` (`find_capabilities`, a platform op) returns
  `ConnectionRequirement{integration, state: ready|needs_auth|needs_input, connect}`. A
  missing connection on the resolve path raises `ConnectionNotFoundError` (HTTP 404).
  `POST /tools/connections/` returns `status.redirect_url`; the OAuth callback activates the
  connection and posts a message to the opener window. Connections live at project scope,
  keyed `(project_id, provider_key, integration_key, slug)`.

## Coordination

- The "default tools and skills" project and the "missing builder tools" project are active.
  The builder-capabilities work depends on this project's connection-request flow; that
  dependency is designed here (Problem 2). Coordinate concrete tool names via the
  orchestrator.

## Links

- Tool discovery (the connection-state source for Problem 2):
  [`../tool-discovery/status.md`](../tool-discovery/status.md)
- HITL park/resume (the primitive Problem 1 and 2 extend):
  [`../hitl-fix`](../hitl-fix)
