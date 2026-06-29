# Frontend round-trip: client tools that ask the human

Status: shipped (backend #4925, frontend #4934). Date: 2026-06-28. Owner: agent-workflows.
Audience: Arda (most of the frontend), us (SDK, runner, API).

An agent sometimes needs the human in the middle of a run. This doc owns one primitive that
serves that need: a tool call that leaves the agent, reaches the playground, shows the user
something, waits, and resumes the agent with the result. We design the primitive once and point
it at two jobs.

## The problem

Two cases drive this work, and they share one shape.

1. The agent edits its own config. It calls `commit_revision` to write a new revision of
   itself. The user usually approves first, and the playground then shows the new config.
2. The agent needs a connection it lacks. It wants a GitHub tool, but no GitHub connection
   exists. The user must finish an OAuth flow before the agent can continue.

Both cases pause the run, surface something in the playground, wait for the user, and resume the
agent with a result. One primitive carries both. The builder-capabilities work (triggers,
subscriptions) rides the same primitive, so we keep it general.

## The shape, in one paragraph

We reuse a transport we already ship. The human-in-the-loop (HITL) approval flow pauses a run,
renders approve or deny, waits, and resumes on the next message. The Vercel AI SDK ships two
matching halves; we use one today. The approval half drives HITL. The client-tool half is the
sibling we reuse: a tool with no server execute is fulfilled by the client, which supplies the
result and triggers an automatic resend. The runner's current rule, "forbid client tools,"
becomes "emit the call and park." That is the whole idea. The rest of this doc is the contract,
the two applications, and the work split.

## Scope

In v1:

- One generic client-tool round-trip that any browser-fulfilled tool can use.
- `request_connection` as the first such tool, for the connection case.
- `commit_revision` approval through the existing gate, plus a refresh of the config panel.
- A reference-only resume envelope, with success, failure, cancel, and abandon all settled.

Out of v1, recorded so no one rebuilds them:

- A config diff widget. v1 ships a generic approval widget; a per-tool diff is a later widget,
  not a new contract.
- Runner auto-interception of a missing-connection failure. The agent asks for a connection
  explicitly, taught by a skill. Auto-interception stays a future safety net (see Appendix).

## Decisions (locked 2026-06-28)

| ID | Decision |
| --- | --- |
| D1 | Config-change approval is per-tool, not hardcoded. `needs_approval` stays the tool's own field, read by the existing approval gate. The universal requirement is the refresh: after a commit lands, the playground refreshes the config panel and the build-kit view, whether a human approved or the agent committed directly. The refresh fires in both paths. No config diff in v1; the frame carries the tool name plus a render hint so a per-tool widget can land later with no protocol change. |
| D2 | The connection trigger is an explicit `request_connection` tool, driven by discovery and a skill. Runner auto-interception of a call-time failure is out of v1. |
| D3 | Build the generic primitive, not a narrow connection flow. One client-tool round-trip carries both jobs and wires the declared-but-dormant `client_tool` interaction path. |
| D4 | The result returns as a structured tool result keyed to the parked call. It carries a reference (integration plus slug, or "connection ready"), never the secret. The runner re-resolves the credential from the vault on resume. Success, failure, cancel, and abandon all settle the call so the run never hangs. |
| D5 | `request_connection` is a non-runnable reference tool: a hard-coded platform workflow the build kit embeds with `@ag.embed`, the same way it embeds the authoring skill. It is not a platform op. The backend exposes the tool; the frontend handles the call. |

## What exists today (verified in code 2026-06-28)

We start from a working round-trip, not from zero.

The HITL round-trip works end to end. When a tool needs approval:

1. The runner raises a neutral `interaction_request` with `kind: "permission"`
   (`services/agent/src/protocol.ts`).
2. The SDK projects it to a Vercel `tool-approval-request` frame
   (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`).
3. The run parks: the runner ends the turn with stop reason `paused`, disposes the sandbox, and
   emits a clean finish frame (`services/agent/src/engines/sandbox_agent.ts`).
4. The playground renders approve or deny in `ToolActivity` and, the moment the user decides,
   auto-resends through `sendAutomaticallyWhen: agentShouldResumeAfterApproval`
   (`web/oss/src/components/AgentChatSlice/`).
5. The next turn carries the decision back as a `tool_result` block with an `{approved}` output.
   The runner cold-replays the conversation and resolves the parked gate, keyed by
   `approvalKey(name, args)` (`services/agent/src/responder.ts`).

The rails for the generic case are laid but dormant. The neutral event already declares
`kind: "permission" | "input" | "client_tool"`, and only `permission` is wired; `Responder` has
`onPermission` and no `onClientTool` (`services/agent/src/responder.ts`). A client tool is
correctly refused in-sandbox: `dispatch.ts` throws because a client tool is browser-fulfilled and
must never run in the sandbox (`services/agent/src/tools/dispatch.ts`). What is missing is the
path that recognizes a client tool *before* dispatch and emits-and-parks it instead.

The AI SDK ships both halves we need (`ai@6` and `@ai-sdk/react@3`, beta channel; all symbols
below verified present in `node_modules`).

- The approval half, in use today: `addToolApprovalResponse` records the decision, and
  `lastAssistantMessageIsCompleteWithApprovalResponses` drives the resend.
  `agentShouldResumeAfterApproval` wraps it.
- The client-tool half, which we reuse: a tool with no server execute is client-handled. The
  playground supplies the result through `addToolOutput` (`addToolResult` is deprecated), and
  `lastAssistantMessageIsCompleteWithToolCalls` drives the resend. The `providerExecuted` flag on
  a tool part says whether the server ran the tool, so the playground tells a server result from a
  client call.

## The primitive: a generic client-tool round-trip

### How it works

A client tool is a tool the playground runs, not the sandbox. The agent calls it like any other
tool. The runner does not execute it. It streams the tool call, parks the run, and waits. The
playground dispatches a widget, the user acts, and the result returns on the next turn as a
`tool_result` keyed to the same call. The agent reads the result as the tool's return value and
continues.

This is the permission flow with two parts generalized. The outbound side carries an arbitrary
tool call, not just a permission ask. The inbound side carries an arbitrary tool output, not just
`{approved}`. The park, the cold-replay, and the resume stay as they are.

### The contract, by role

Two boundaries cross: runner to playground (outbound) and playground to runner (inbound). We
classify each field by the role it plays, not the feature it touches.

The outbound side needs no new Vercel frame. The permission flow projects a bespoke
`tool-approval-request` frame because approval is a separate concern layered on the tool call. A
client tool is different: the tool call itself is what the client fulfills. So the call rides as
the standard unsettled tool part the runner already streams (`tool-input-available`, no output,
`providerExecuted` falsy), and an optional presentation hint rides the existing one-way render
channel (`data-<name>` in `stream.py`). The runner-internal `interaction_request kind="client_tool"`
drives the park; it needs no wire frame of its own.

What the playground reads to render the request:

```jsonc
{
  "toolCallId": "call_abc",            // context: ties the result back to the call
  "toolName": "request_connection",    // identity: the dispatch key
  "input": { "integration": "github" },// data: the call arguments, owned by the model
  "render": { "kind": "connect" }      // metadata: an optional presentation hint
}
```

- `toolCallId` is protocol context. Correlation, per call, platform-owned. We reuse the existing
  id; we mint no parallel one.
- `toolName` is identity and the stable dispatch key. `request_connection` maps to a connect
  widget; a future tool maps to its own widget.
- `input` is data, the tool arguments the model produced. The widget reads them to know what to
  show.
- `render` is metadata, an optional presentation hint on the one-way render channel. It refines
  dispatch when the name alone is too coarse. It carries no behavior and no secret, and the
  playground may ignore it. It lives on the stream, never in the committed config (see Build-kit
  alignment).

What the playground sends back, on the next turn's message history:

```jsonc
{
  "type": "tool_result",
  "toolCallId": "call_abc",            // context: the cold-replay anchor
  "toolName": "request_connection",
  "output": { "connected": true, "integration": "github", "slug": "github-main" }
}
```

- `toolCallId` and `toolName` are protocol context. The runner re-keys by name and args on resume,
  the existing match path.
- `output` is data, and for a connection it is a reference, never the credential. The connection
  lives in the project vault, keyed `(project_id, provider_key, integration_key, slug)`. The
  runner re-resolves the real credential server-side on the resumed turn. Putting the secret in
  the stream or the message would leak it into transcripts and traces for no gain.

The single most important rule: the result is a `tool_result` keyed to the call, and it carries a
reference, not a secret.

### Rename the cold-replay anchor to `parkedCallKey`

The runner resolves a parked call by `approvalKey(name, args)` (`services/agent/src/responder.ts`).
A client tool is not an approval gate, so the approval-specific name is wrong for the generic
mechanism. Rename the function to a neutral `parkedCallKey(name, args)`, which reads correctly for
any parked interaction (permission, client tool, future input). If the rename costs more than it
returns, the minimum is a note that the name is historical and covers all parked interactions.

### Where dispatch lives

The AI SDK offers two entry points. We use the second for any tool that needs a human.

- `onToolCall` fires the instant a client tool call streams in. It fits a fully automatic tool
  that computes and returns at once. It is the wrong place for connect, which needs the user for
  seconds to minutes. We note it as available; v1 does not use it.
- The message-part renderer is the interactive pattern, and where dispatch lives. This is where
  `ToolActivity` renders approve and deny today. The renderer sees an unsettled client tool part,
  dispatches the widget by `render.kind`, then `toolName`, then a generic fallback. The widget
  drives the interaction, then calls `addToolOutput`. The part flips to settled, and
  `lastAssistantMessageIsCompleteWithToolCalls` makes `sendAutomaticallyWhen` resend.

The playground keeps a registry of client-tool handlers, keyed by `render.kind` first, then by
`toolName`. A streamed client tool call that is not in the registry is an error surface: the
playground renders a generic "this app cannot handle that request" widget and settles the part, so
it never hangs silently. v1 ships one entry, `request_connection`, plus the generic fallback. Each
later client tool is one added entry, not a protocol change.

This needs one generalization of the resume predicate. Today `agentShouldResumeAfterApproval`
wraps the approval predicate. It must also resume on a settled client-tool output. The clean form
is one predicate that returns true when every non-provider-executed tool part on the last
assistant turn is settled (`output-available`, `output-error`, or `approval-responded`) and at
least one was just resolved. Whether it stays one predicate or composes two is Arda's call at the
seam.

### Settle on every path

An unsettled tool part hangs the resume, so the widget must settle the part on every terminal
path, not only on success.

- **Success.** The widget calls `addToolOutput` with the reference, for example
  `{ connected: true, integration, slug }`.
- **Explicit cancel.** The user dismisses the widget. The widget calls `addToolOutput` with
  `{ connected: false, reason: "cancelled" }`.
- **Failure.** The interaction errors. The widget calls `addToolOutput` with
  `{ connected: false, reason }`, or the error form via `errorText`.
- **Abandon.** The user starts but never finishes (closes the popup, walks away). The widget
  detects the closed popup and settles `{ connected: false, reason: "cancelled" }`. A timeout
  backstop settles `{ connected: false, reason: "timeout" }` if no terminal signal arrives within
  a bound.

On every path the agent receives a definite result, so it can re-ask or move on rather than wait
forever. Application 2 covers the connect-specific UX of the incomplete state.

## `request_connection`: a non-runnable reference tool

This is the corrected model, and it follows ownership rather than transport.

A normal reference tool (`type: "reference"`, `ReferenceToolConfig`) points at a workflow and is
backend-runnable: when the model calls it, the runner routes the call to `POST /tools/call` and
the Agenta service runs the workflow revision server-side. `request_connection` is not that. It
has no API call for the runner to make. The browser does the work.

So we model `request_connection` as a non-runnable reference tool, the same idea as a platform
skill. A platform skill is a hard-coded workflow the build kit embeds with `@ag.embed`.
`request_connection` is a hard-coded workflow embedded the same way, and the embed resolver inlines
it into a `client` tool config (the existing `@ag.embed`-of-a-tool path: an embedded tool resolves
to a browser-fulfilled `client` tool, not a server callback). The runner then emits-and-parks it
through the generic primitive above, and the playground fulfills it.

Three points fall out of this model:

- It is **not a platform op**. Platform ops (`find_capabilities`, `commit_revision`) always bind to
  an HTTP method and path the runner calls. `request_connection` has neither, so it does not belong
  in the platform-op catalog.
- The build kit carries it **as an embed**, beside the authoring skill, not as a committed tool
  (see Build-kit alignment). Its identity in the kit is the workflow it references.
- On the wire it is a `ClientToolSpec` (`kind: "client"`), the model that already exists. The spec
  carries `name` (the dispatch key), `input_schema` (the argument contract), and an optional render
  hint. The runner reads the client marker, then emits and parks instead of dispatching to the
  sandbox.

`needs_approval` is policy and orthogonal. A client tool may also be approval-gated.
`request_connection` is not, because connecting is its own confirmation.

## Build-kit alignment

This section references the default-agent-config project (`#4917`) and does not redesign it.

The default platform tools and the authoring skill are an agent-template **overlay** the backend
serves read-only. The backend attaches it to the simple-applications response
(`GET /api/simple/applications/{id}`) at
`additional_context.playground_build_kit.agent_template_overlay`, a partial `parameters.agent`. The frontend
merges the overlay onto the current `parameters.agent` on a playground run and excludes it on
commit. There is no run flag and no service-side injection; the agent service runs the
`parameters.agent` it receives.

Two consequences for this project.

First, `request_connection` joins the overlay as a **reference-tool entry**, identity by its
referenced workflow, beside the authoring skill's `@ag.embed`. It is never committed. The overlay
is the kit's home; this project owns only the tool's definition and behavior.

Second, the config refresh in Application 1 must also refresh the build-kit view. A commit can
change which overlay rows apply, so the same `data-committed-revision` signal that invalidates the
config panel also refreshes the build-kit display. We reference the overlay and the container; we
change neither.

## Application 1: the agent edits its own config

`commit_revision` is a platform op with `default_needs_approval=True` and
`default_permission="ask"`. The running variant id is bound server-side from run context, so the
agent commits to its own default variant. The approval gate is therefore already available through
the HITL flow. When the agent calls `commit_revision`, the run parks on a permission gate, the user
sees the request, and on approve the commit runs server-side.

The gate stays per-tool (D1). Whether `commit_revision` parks is the tool's own `needs_approval`.
The default is `True`, a sensible default for "the agent rewrote itself," but it is a default, not
a hardcode. An author or a future auto-commit mode can set it to `False`, and the agent then
commits directly. The refresh below still runs.

The approval widget is generic now and per-tool later. v1 renders the generic approval widget,
which shows the tool input. For `commit_revision` that input is the new config. A later
`render: { kind: "config-diff" }` lets the playground swap in a real before-and-after diff with no
protocol change. Raw JSON is a weak approval surface, so the diff is the expected first per-tool
widget, but it is a follow-up.

The refresh is the universal requirement. Today the playground reads the latest revision per
request through `workflowLatestRevisionQueryAtomFamily`. When the agent commits, the playground has
no signal that a new revision landed, and it needs one in both paths: the gated path (a human
approved, the commit runs on the resume turn) and the direct path (`needs_approval=False`, the
commit runs inside the turn). Fire the refresh on commit success, not on approval, because success
happens in both paths, so one emit point covers both.

Locked: on a successful `commit_revision`, the runner or SDK emits a one-way `data` event,
`data-committed-revision`, with `{ variantId, revisionId, version }`. The playground listens and
invalidates `workflowLatestRevisionQueryAtomFamily`, which refreshes the config panel, the section
drawers, and the build-kit view. The signal is metadata ("the config changed, here is the new
reference"), so it rides the one-way `data-<name>` channel, not a tool result.

Known gap (follow-up). As shipped, two paths emit `data-committed-revision`: the create path
(`create_workflow_revision`, `api/oss/src/apis/fastapi/workflows/router.py:1251`) and the
platform-tool call path (`_emit_committed_revision_data_event_from_outputs`,
`api/oss/src/apis/fastapi/tools/router.py`). The regular `commit_workflow_revision` endpoint
(`api/oss/src/apis/fastapi/workflows/router.py:1500`) does not emit it yet, so a normal
frontend-driven commit of an existing variant does not fire the refresh. Wiring the event into that
endpoint is the open follow-up.

## Application 2: the agent needs a connection

The end-to-end flow:

1. The agent learns it needs a connection from discovery. It calls `find_capabilities`, which
   returns a `ConnectionRequirement` with `state` (`ready`, `needs_auth`, or `needs_input`) and a
   `connect` affordance. A skill teaches the discover-then-connect loop (D2).
2. The agent calls `request_connection(integration)`. The runner streams the call and parks.
3. The playground dispatches the connect widget. It shows the integration, calls
   `POST /tools/connections/`, and opens the returned `redirect_url` (the OAuth flow) in a popup.
4. The user finishes OAuth. The callback activates the connection in the project vault and posts a
   message to the opener window.
5. The widget validates the message origin (below), then calls `addToolOutput` with
   `{ connected: true, integration, slug }`, keyed to the parked call. The resume predicate fires
   and the conversation auto-resends.
6. The runner cold-replays, resolves the parked call by `parkedCallKey(name, args)`, re-resolves
   the connection from the vault, and the agent proceeds.

The connect affordance (which endpoint to call, with what body) rides in the tool input or the
render hint, so the playground speaks Agenta, never Composio. The agent decides when to ask and can
explain why in its own words first. This is the seam the builder-capabilities project depends on
for triggers and subscriptions. The connection persists at project scope, so a later run needs no
re-prompt.

### Security: validate the popup message origin

The connect widget opens `redirect_url` in a popup and listens for a `postMessage` from the OAuth
callback. A `postMessage` listener trusts any sender by default, so a malicious page could spoof the
callback signal. Before the widget trusts the message and calls `addToolOutput`, it MUST validate
`event.origin` against the Agenta API origin and drop any message from another origin. This is a
hard requirement, not a nicety. As defense in depth, the callback should also carry an expected
shape and a state value bound to this connect attempt.

### The incomplete state (abandoned flow)

A user can open the popup and never finish. The run must not hang, and the UI must show what
happened.

- While the popup is open, the chip reads "Connecting GitHub…" with a Cancel action.
- If the user closes the popup without success, the widget detects the closed window and settles
  the part with `{ connected: false, reason: "cancelled" }`. A timeout backstop settles
  `{ connected: false, reason: "timeout" }` if nothing arrives within a bound.
- The chip then reads "Connection not completed" with a Retry action.
- The agent receives the failure result on the resume turn, so it can re-ask ("I still need GitHub
  access, want to try again?") or move on. It never waits on a call that will not return.

### The post-connection handoff

The callback says only that the connection now exists. It does not add the tool to the agent. After
the resume, the agent re-runs `find_capabilities`, sees the `ConnectionRequirement` now reads
`ready` with a `slug`, and adds the gateway tool or calls it. This loop is teaching, not transport.
Our primitive delivers the "connection ready" signal; the agent-skills project owns the skill that
teaches the full loop. Connections are project-scoped, so the re-resolve succeeds on the very next
turn.

## Displaying the result

The wire envelope is identical either way. This is pure presentation, and Arda's call.

- **U1, an inline status chip (lean).** The connect interaction renders as a compact tool-activity
  row, the same visual language as approve and deny: "Connect GitHub" with a button, collapsing on
  success to "GitHub connected" with a check, and on abandon to "Connection not completed" with
  retry. The raw tool result never shows as a chat bubble. This matches the HITL UI, stays low
  noise, and treats the result as plumbing the user need not read.
- **U2, a plain chat message.** The result posts as a visible turn ("Connected GitHub"). This is
  maximally legible but noisier, can imply the user typed something they did not, and duplicates
  what the agent restates on resume.

Lean: U1, for consistency with the approval UI and lower noise. Move to U2 only if testing shows
people miss that a connection happened.

## Work split

Most of this is frontend, and most of the frontend is Arda's call.

Us (SDK, runner, API):

- Runner: add `onClientTool` to `Responder`; recognize a client tool before dispatch and emit-and-
  park exactly as permission parks; resolve from the inbound `tool_result` on resume; generalize
  decision extraction beyond `{approved}` to any structured output; rename `approvalKey` to
  `parkedCallKey`.
- SDK: surface a client tool as a standard unsettled tool part plus an optional render hint (no new
  Vercel frame); widen inbound `tool_result` parsing for client tools in `vercel/messages.py`;
  define `request_connection` as a hard-coded non-runnable workflow and resolve its `@ag.embed`
  into a `ClientToolSpec`.
- API or SDK: emit `data-committed-revision` on commit success, in both the gated and direct paths.

Arda (frontend), the calls that are his:

- The client-tool dispatcher in the message-part renderer (sibling to `ToolActivity`): which widget
  renders for which `render.kind`, then `toolName`, the generic widget as fallback, and an explicit
  "cannot handle that" surface for an unknown client tool. v1 ships only the generic widget. This is
  the central new surface.
- The connect widget: the OAuth popup, the origin-validated callback listener, and the reply through
  `addToolOutput` (success, cancel, failure, and abandon all settle the part), plus the incomplete-
  state UX.
- The generalized resume predicate: `agentShouldResumeAfterApproval` extended so a settled client-
  tool output resumes, not only an approval.
- The result UX (U1 inline chip versus U2 chat message; lean U1).
- The config-panel and build-kit refresh on `data-committed-revision`, and later the per-tool
  config-diff widget.

Cross-project (coordinated, not ours to build):

- The skill that teaches the discover, `request_connection`, re-discover, add-tool loop:
  agent-skills.
- The build-kit overlay and whether a published agent keeps `request_connection`:
  default-agent-config (`#4917`).

## Open questions (non-blocking)

These settle during implementation, with Arda.

- The `render.kind` vocabulary (for example `connect`, `config-diff`). Dispatch precedence is
  settled (`render.kind`, then `toolName`, then generic fallback); only the string values remain.
- The exact `request_connection` argument and output schema, and its render hint.
- Whether the resume predicate stays one function or composes two. Same behavior either way.
- The `data-committed-revision` payload beyond `{ variantId, revisionId, version }`.
- The abandon timeout bound and whether popup-closed detection uses polling or a focus listener.

## Appendix: prior approaches

Recorded so no one rebuilds them.

- Two narrow interaction kinds. Keep `permission` and add a dedicated `connect` kind, each with a
  bespoke frame and widget. Smaller blast radius, but the third interaction repeats the work and
  we pay the generalization later with special cases to retire. D3 chose the generic primitive.
- A fresh user message for the connection result ("I connected GitHub"). The parked call would
  never resolve, so the runner would re-raise it or the model would guess. It pollutes the
  transcript and reuses none of the resume machinery. D4 chose the `tool_result`.
- `request_connection` as a platform op with a client executor. A platform op binds to an HTTP
  method and path the runner calls; this tool has neither. Modeling it as an op invented a new op
  shape and put a non-runnable tool in the runnable catalog. It is a non-runnable reference tool
  instead (D5).
- Refresh off the `commit_revision` tool result, or a blind refetch on every turn finish. The
  first couples the playground to a platform tool's output shape and still must fire in the direct
  path; the second is wasteful and can race the write. The `data-committed-revision` signal avoids
  both.
- Runner auto-interception of a missing-connection failure. The gateway resolve raises
  `ConnectionNotFoundError` mid-run and the runner raises a connect interaction itself, with no
  agent tool call. The control flow is implicit, and the parked thing is a synthetic interaction
  rather than a real model tool call, so the cold-replay anchor must be synthesized carefully. We
  may add it later as a fallback, so an agent that skips discovery degrades to a connect prompt
  instead of a raw error. Out of v1 (D2).

## References

Sibling docs (read to align, do not edit):
`../default-agent-config/`, `../advanced-build-kit/`, `../agent-skills/`,
`../agent-builder-capabilities/`, `../agent-builds-an-app/`.

Code anchors (verified 2026-06-28):

- Neutral event and responder: `services/agent/src/protocol.ts`,
  `services/agent/src/responder.ts` (`approvalKey`, the cold-replay anchor to rename).
- Park and finish: `services/agent/src/engines/sandbox_agent.ts`.
- Client-tool in-sandbox guard: `services/agent/src/tools/dispatch.ts`.
- Stream and inbound parsing: `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`
  (`tool-approval-request`, `data-<name>`), `.../vercel/messages.py`.
- Tool models: `sdks/python/agenta/sdk/agents/tools/models.py`
  (`ClientToolConfig`, `ReferenceToolConfig`, `ClientToolSpec`).
- Reference/workflow tool resolution: `sdks/python/agenta/sdk/agents/platform/workflow.py`.
- Embed resolution (embed-of-tool to client): `api/oss/src/core/embeds/utils.py`.
- Platform catalog: `sdks/python/agenta/sdk/agents/platform/op_catalog.py`
  (`find_capabilities`, `commit_revision`).
- Frontend: `web/oss/src/components/AgentChatSlice/`,
  `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts`.
- Connections API and OAuth callback `postMessage`: `api/oss/src/apis/fastapi/tools/router.py`
  (`/tools/discover`, `/tools/connections/`, `ConnectionNotFoundError` 404).
