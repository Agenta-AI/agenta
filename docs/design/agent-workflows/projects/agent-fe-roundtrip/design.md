# Frontend round-trip: a client tool that asks the human

Status: design, ready for review. Date: 2026-06-28. Owner: agent-workflows.
Audience: Arda (most of the frontend), us (SDK, runner, API).

This doc owns one primitive: a tool call that leaves the agent, travels to the playground,
shows the user something, waits for the user to act, and resumes the agent with the result.
We design that primitive once, then point it at two jobs.

## The problem

An agent sometimes needs the human in the middle of a run. Two cases drive this work, and they
are the same shape.

1. The agent edits its own config. It calls `commit_revision` to write a new revision of
   itself. The user should usually approve that first, and the playground must then show the
   new config.
2. The agent needs a connection it does not have. It wants to call a GitHub tool, but no GitHub
   connection exists. The user must finish an OAuth flow before the agent can continue.

Both cases pause the run, surface something in the playground, wait, and resume the agent with
a result. One primitive serves both. The builder-capabilities work (triggers, subscriptions)
rides the same primitive, so we keep it general.

## Approach in one paragraph

We do not invent a transport. We already ship this round-trip: the human-in-the-loop (HITL)
approval flow pauses a run, renders approve or deny, waits, and resumes. The Vercel AI SDK
ships two matching halves, and we already use one. The approval half drives HITL today. The
client-tool half is the sibling we reuse here: a tool with no server execute is fulfilled by
the client, which supplies the result and triggers an automatic resend. The runner's current
rule, "forbid client tools," becomes "emit the call and park." That is the whole idea. The rest
of this doc is the contract, the two applications, and the work split.

## Scope

In v1:

- One generic client-executor round-trip that any client tool can use.
- `request_connection` as the first client tool, for the connection case.
- `commit_revision` approval through the existing gate, plus a refresh of the config panel.
- A reference-only resume envelope, with failure and cancel both settled.

Out of v1, recorded so no one rebuilds them by accident:

- A config diff. v1 ships a generic approval widget. A per-tool diff is a later widget, not a
  new contract.
- Runner auto-interception of a missing-connection failure. The agent asks for a connection
  explicitly, taught by a skill. Auto-interception stays a future safety net (see Rejected
  alternatives).

## Decisions (locked 2026-06-28)

These were the open questions. Mahmoud answered them. The rest of the doc honors them.

| ID | Decision |
| --- | --- |
| D1 | Config-change approval is per-tool, not hardcoded. `needs_approval` stays the tool's own field, read by the existing approval gate. The new universal requirement is the refresh: after a commit lands, the playground refreshes the config panel, whether a human approved or the agent committed directly. The refresh fires in both paths. No config diff in v1, but the frame carries the tool name plus a render hint so a per-tool widget can be added later with no protocol change. |
| D2 | The connection trigger is an explicit `request_connection` tool, driven by discovery and a skill. Runner auto-interception of a call-time failure is out of v1, kept only as a future option. |
| D3 | Build the generic primitive, not a narrow connection flow. One client-tool round-trip carries both jobs and retires the dead `client` executor. |
| D4 | The result returns as a structured tool result keyed to the parked call. It carries a reference (integration plus slug, or "connection ready"), never the secret. The runner re-resolves the credential from the vault on resume. Failure and cancel also settle the call so the run never hangs. |
| D5 | `request_connection` is a hard-coded platform tool with a client executor. It sits in the same platform catalog as `find_capabilities` and `commit_revision`, except the runner does not execute it: the playground does. Because it is a platform tool, it is part of the injected build kit (see Build-kit alignment). |

## What exists today (verified in code)

We are not starting from zero. Three things are already built or already shipped by the SDK.

The HITL round-trip already works end to end. When a tool needs approval:

1. The runner raises a neutral `interaction_request` with `kind: "permission"`
   (`services/agent/src/protocol.ts`).
2. The SDK projects that event to a Vercel `tool-approval-request` frame
   (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`).
3. The run parks: the runner ends the turn with stop reason `paused`, disposes the sandbox,
   and emits a clean finish frame (`services/agent/src/engines/sandbox_agent.ts`).
4. The playground renders approve or deny in `ToolActivity` and, the moment the user decides,
   auto-resends through `sendAutomaticallyWhen: agentShouldResumeAfterApproval`
   (`web/oss/src/components/AgentChatSlice/`).
5. The next turn carries the decision back as a `tool_result` block with an `{approved}`
   output. The runner cold-replays the conversation and resolves the parked gate, keyed by
   `approvalKey(name, args)` (`services/agent/src/responder.ts`).

So the transport exists: out through the stream, park, render, wait, resume on the next
message. The decision even rides home in the right place, a `tool_result` keyed to the call.

The rails for the generic case are laid but dormant. The neutral event already declares
`kind: "permission" | "input" | "client_tool"`, and only `permission` is wired; `Responder`
has `onPermission` but no `onClientTool`. The `client` executor exists as a model
(`ClientToolSpec`, `kind: "client"` in `sdks/python/agenta/sdk/agents/tools/`), but the runner
throws on any client tool on purpose (`services/agent/src/tools/dispatch.ts`). Nothing runs on
the rails yet.

The AI SDK ships both halves we need (`ai@6` and `@ai-sdk/react@3`, currently on the beta
channel; all symbols below verified present in `node_modules`).

- The approval half, in use today: `addToolApprovalResponse` records the decision, and
  `lastAssistantMessageIsCompleteWithApprovalResponses` drives the resend. Our
  `agentShouldResumeAfterApproval` wraps it.
- The client-tool half, which we reuse: a tool with no server execute is client-handled. The
  playground supplies the result through `addToolOutput` (the older `addToolResult` is
  deprecated), and `lastAssistantMessageIsCompleteWithToolCalls` drives the resend. The
  `providerExecuted` flag on a tool part says whether the server ran the tool, so the
  playground can tell a server result from a client call.

The gap is narrow. We have a working round-trip for one fixed interaction. We generalize it so
any client tool can round-trip, then point it at two jobs.

## The primitive: a generic client-tool round-trip

### How it works

A client-executor tool is a tool the playground runs, not the sandbox. The agent calls it like
any other tool. The runner does not execute it. Instead it streams the tool call, parks the
run, and waits. The playground dispatches a widget, the user acts, and the result returns on
the next turn as a `tool_result` keyed to the same call. The agent reads the result as the
tool's return value and continues.

This is the permission flow with two things generalized. The outbound side carries an arbitrary
tool call, not just a permission ask. The inbound side carries an arbitrary tool output, not
just `{approved}`. Everything between, the park, the cold-replay, and the resume, stays as it
is.

### The contract, by role

Two boundaries cross: runner to playground (outbound) and playground to runner (inbound). We
classify each field by the role it plays, not the feature it touches.

The outbound side needs no new Vercel frame. The permission flow projects a bespoke
`tool-approval-request` frame because approval is a separate concern layered on top of the tool
call. A client tool is different: the tool call itself is what the client fulfills. So the call
rides as the standard unsettled tool part the runner already streams (`tool-input-available`,
no output, `providerExecuted` falsy), and the optional presentation hint rides the existing
one-way `data-render` channel (`data-<name>` in `stream.py`). The runner-internal
`interaction_request kind="client_tool"` is what drives the park; it does not need its own
wire frame.

What the playground reads to render the request:

```jsonc
{
  "toolCallId": "call_abc",        // protocol context: ties the result back to the call
  "toolName": "request_connection",// data / identity: the dispatch key
  "input": { "integration": "github" }, // data: the call arguments, owned by the model
  "render": { "kind": "connect" }  // metadata: a presentation hint, on the data-render channel
}
```

- `toolCallId` is protocol context. Correlation, per call, platform-owned. We reuse the
  existing id; we do not mint a parallel one.
- `toolName` is data and the stable dispatch key. `request_connection` maps to a connect
  widget, `commit_revision` to a config-diff widget later, a future tool to its own widget.
- `input` is data. The tool arguments the model produced. The widget reads them to know what to
  show.
- `render` is metadata, a presentation directive. It refines dispatch when the name alone is
  too coarse. It carries no behavior and no secret, and the playground may ignore it.

What the playground sends back, on the next turn's message history:

```jsonc
{
  "type": "tool_result",
  "toolCallId": "call_abc",        // protocol context: the cold-replay anchor
  "toolName": "request_connection",
  "output": { "connected": true, "integration": "github", "slug": "github-main" }
}
```

- `toolCallId` and `toolName` are protocol context. The runner re-keys by
  `approvalKey(name, args)` on resume, the existing match path.
- `output` is data, and for a connection it is a reference, never the credential. The
  connection lives in the project vault, keyed `(project_id, provider_key, integration_key,
  slug)`. The runner re-resolves the real credential server-side on the resumed turn. Putting
  the secret in the stream or the message would leak it into transcripts and traces for no
  gain, since the runner re-resolves anyway.

The single most important rule: the result is a `tool_result` keyed to the call, and it carries
a reference, not a secret.

### Registration: one flag, three layers

"This tool runs on the client" is one field on the execution-location axis of the executor
taxonomy (builtin, gateway, code, client). It is platform-owned and long-lived. It must flow
unchanged from the catalog to the wire to the playground. We do not scatter it across
feature-named fields.

Layer A, the platform catalog (us). `request_connection` is a hard-coded platform op beside
`find_capabilities` and `commit_revision` (`sdks/python/agenta/sdk/agents/platform/`).
One correction from the old draft: the platform op model has no `executor` field today, and
every existing op is server-executed by an HTTP method and path. `request_connection` is the
first op with `executor: "client"` and no method or path, because the playground runs it. So
this is a small new shape in the catalog, not a reuse of an existing one.

Layer B, the spec and the wire (us). The resolver maps a `client` platform op to a
`ClientToolSpec` (`kind: "client"`), the model that already exists. The spec carries the client
marker on the wire to the runner, so the runner knows to emit and park rather than dispatch to
the sandbox. No new wire shape; the `client` spec exists, unused.

Layer C, the playground (Arda). The playground must know which streamed tool calls are its job,
and it must never guess. Two facts make this robust.

- Implicit, from Vercel: any tool call that arrives with no server output is client-handled,
  and `providerExecuted` reads falsy. This seam is already in use; `agentApprovalResume.ts`
  filters `providerExecuted !== true`.
- Explicit, so the playground never guesses: the playground keeps a registry of client-tool
  handlers, keyed by `render.kind` first, then by `name`. A streamed tool call that is not in
  the registry and has no server output is an error surface. The playground renders a generic
  "this app cannot handle that request" widget. It never hangs silently.

The registry is a `Record<string, ClientToolHandler>`. v1 has one entry, `request_connection`.
Each later client tool is one added entry, not a protocol change.

The spec fields, by role:

- `executor: "client"` (`kind: "client"`) is config and routing: the execution location.
  Platform-owned, set in the catalog. The single source of truth for "client-handled."
- `name` is metadata and identity: the dispatch key.
- `input_schema` is data: the argument contract.
- `render` is metadata: the presentation hint that refines dispatch.
- `needs_approval` is policy, and orthogonal. A client tool may also be approval-gated.
  `request_connection` is not, because connecting is its own confirmation.

### Where dispatch lives

The AI SDK offers two entry points. We use the second for any tool that needs a human.

- `onToolCall` fires the instant a client tool call streams in. It fits a fully automatic tool
  that can compute and return at once. It is the wrong place for connect, which needs the user
  for seconds to minutes. We note it as available; v1 does not use it.
- The message-part renderer is the interactive pattern, and where dispatch lives. This is the
  same place `ToolActivity` renders approve and deny today. The renderer sees an unsettled
  client tool part, dispatches the widget by `render.kind` then `name`, and falls back to the
  generic widget. The widget drives the interaction, then calls `addToolOutput`. The part flips
  to settled, and `lastAssistantMessageIsCompleteWithToolCalls` makes `sendAutomaticallyWhen`
  resend.

This needs one generalization of the resume predicate. Today `agentShouldResumeAfterApproval`
wraps the approval predicate. It must also resume on a settled client-tool output. The clean
form is one predicate that returns true when every non-provider-executed tool part on the last
assistant turn is settled (`output-available`, `output-error`, or `approval-responded`) and at
least one was just resolved. That is a small superset of today's function. Whether it stays one
predicate or composes two is Arda's call at the seam.

### The resume envelope

The result is a tool output keyed to the parked call. `addToolOutput` carries it home as the
`tool_result` block shown above. The output is a reference, never the secret: `integration`
plus `slug`, or as little as `{ "connected": true }`.

Failure and cancel must also settle the part. If the user closes the popup or the OAuth flow
fails, the widget calls `addToolOutput` with `{ connected: false, reason }` (or the error form
via `errorText`). The agent then learns it failed and can re-ask. An unsettled part hangs the
resume, so the widget settles the part on every path.

### Showing the resume to the user

The wire envelope is identical either way. This is pure presentation, and it is Arda's call.

- Option U1, an inline status chip (lean). The connect interaction renders as a compact
  tool-activity row, the same visual language as approve and deny: "Connect GitHub" with a
  button, collapsing on success to "GitHub connected" with a check. The raw tool result never
  shows as a chat bubble. This is consistent with the HITL UI, low noise, and treats the result
  as plumbing the user does not need to read.
- Option U2, a plain chat message. The result posts as a visible turn ("Connected GitHub") in
  the transcript. This is maximally legible, but it is noisier, it can imply the user typed
  something they did not, and it duplicates what the agent restates on resume.

Lean: U1, for consistency with the approval UI and lower noise. Move to U2 only if testing
shows people miss that a connection happened.

### The post-connection handoff

The callback says only that the connection now exists. It does not add the tool to the agent.
After the resume, the agent re-runs discovery to wire the tool and use it:

1. The resume turn arrives carrying the connect tool result.
2. The agent re-runs `find_capabilities`. The `ConnectionRequirement` now reads `ready` with a
   `slug`.
3. The agent adds the gateway tool to its config or calls it, and proceeds.

This loop is teaching, not transport. Our primitive delivers the "connection ready" signal. The
agent-skills project owns the skill that teaches the full loop (discover, `request_connection`,
re-discover, add the tool). This is a cross-project dependency. Because connections are
project-scoped, the re-resolve succeeds on the very next turn.

## Application 1: the agent edits its own config

`commit_revision` is a platform op with `default_needs_approval=True` and
`default_permission="ask"`. The running variant id is bound server-side from run context, so
the agent commits to its own default variant. The approval gate is therefore already available
through the HITL flow above. When the agent calls `commit_revision`, the run parks on a
permission gate, the user sees the request, and on approve the commit runs server-side.

Two things follow from D1.

First, the gate stays per-tool. There is no "always approve" to decide, and that is the point.
Whether `commit_revision` parks is the tool's own `needs_approval`. The default is `True`, a
sensible default for "the agent rewrote itself," but it is a default, not a hardcode. An author
or a future auto-commit mode can set it to `False`, and the agent then commits directly. The
refresh below still runs.

The approval widget is generic now and per-tool later. v1 renders the generic approval widget,
which shows the tool input. For `commit_revision` that input is the new config. We do not build
a config diff yet. The frame carries the tool name and a `render` hint, so a later
`render: { kind: "config-diff" }` on `commit_revision` lets the playground swap in a real
before-and-after diff with no protocol change. Raw JSON is a weak approval surface, so the diff
is the expected first per-tool widget, but it is a follow-up.

Second, the refresh is the universal requirement. Today the playground reads the latest revision
per request through `workflowLatestRevisionQueryAtomFamily`. When the agent commits through
`commit_revision`, the playground has no signal that a new revision landed. It needs one, and it
needs it in both paths: the gated path (a human approved, the commit runs on the resume turn)
and the direct path (`needs_approval=False`, the commit runs inside the turn). The clean way to
cover both is to emit the refresh when the commit succeeds, not when it is approved. Success
happens in both paths, so one emit point covers both.

Locked: a named refresh frame (R1). On a successful `commit_revision`, the runner or SDK emits
a one-way `data` event, `data-committed-revision`, with `{ variantId, revisionId, version }`.
The playground listens and invalidates `workflowLatestRevisionQueryAtomFamily`, which refreshes
the panel and the section drawers. This is role-correct: the signal is metadata, "the config
changed, here is the new reference," so it belongs on the one-way `data-<name>` channel, not on
a tool result. (R2 and R3 are recorded under Rejected alternatives.)

## Application 2: the agent needs a connection

The end-to-end flow:

1. The agent learns it needs a connection from discovery. It calls `find_capabilities`, which
   returns a `ConnectionRequirement` with `state` (`ready`, `needs_auth`, or `needs_input`) and
   a `connect` affordance. A skill teaches the discover-then-connect loop (D2).
2. The agent calls `request_connection(integration)`. The runner streams the call and parks.
3. The playground dispatches the connect widget. It shows the integration, calls
   `POST /tools/connections/`, and opens the returned `redirect_url` (the OAuth flow) in a
   popup.
4. The user finishes OAuth. The callback activates the connection in the project vault and posts
   a message to the opener window.
5. The widget hears that message and calls `addToolOutput` with
   `{ connected: true, integration, slug }`, keyed to the parked call. The resume predicate
   fires and the conversation auto-resends.
6. The runner cold-replays, resolves the parked call by `approvalKey(name, args)`, re-resolves
   the connection from the vault, and the agent proceeds.

The connection request is an explicit tool, driven by discovery (D2). The agent calls
`find_capabilities`, sees a requirement that is not `ready`, and calls
`request_connection(integration)`. The `connect` affordance (which endpoint to call, with what
body) rides in the tool input or the render hint, so the playground speaks Agenta, never
Composio. The agent decides when to ask and can explain why in its own words first. This is the
seam the builder-capabilities project depends on for triggers and subscriptions.

The result carries a reference, never the secret:
`{ connected: true, integration: "github", slug: "github-main" }`. The connection persists at
project scope, so a later run needs no re-prompt.

`request_connection` is a client-executed platform op (D5), built per the registration section
above. Its argument and output schema is likely `{ integration }` in and
`{ connected, integration, slug }` out, with a `render` hint of `{ kind: "connect" }`. The
connect affordance is shaped server-side by discovery, which already exists.

## Build-kit alignment

This section references the default-agent-config project (inject-not-commit) and does not
redesign it.

The default platform tools and the authoring skill are an injected, read-only playground build
kit. They are not committed to the agent config. The backend exposes the kit as a read-only
`build_kit` descriptor at `revision.data.build_kit` in the `/inspect` response, grouped into
`skills`, `tools`, and `permissions`; each row carries `key`, `name`, and `description`, and
permission rows add `status`. A per-run flag `flags.inject_build_kit` on the run request turns
injection on or off, defaulting off server-side.

Two consequences for this project.

First, `request_connection` is a platform tool, so it is part of the injected build kit, not the
committed config. It appears as a `tools` row in `build_kit` whenever the kit is injected.
Whether a published agent keeps it after commit is the default-agent-config project's call, not
ours.

Second, the config refresh in Application 1 should also refresh the build-kit display. When a
commit lands, the new revision can change which kit rows apply, so the same
`data-committed-revision` signal that invalidates the config panel should also refresh the
build-kit view. We reference the descriptor and the flag; we do not change their shape.

## Work split

Most of this is frontend, and most of the frontend is Arda's call.

Us (SDK, runner, API):

- Runner: add `onClientTool` to `Responder`; emit the call and park on an unresolved client
  tool exactly as permission parks; resolve from the inbound `tool_result` on resume.
  Generalize the decision extraction beyond `{approved}` to any structured output, keyed by
  `approvalKey(name, args)`.
- SDK: surface a client tool as a standard unsettled tool part plus an optional `data-render`
  hint (no new Vercel frame); widen the inbound `tool_result` parsing for client tools in
  `vercel/messages.py`; add `request_connection` as a `client` platform op (the new
  `executor: "client"`, no method or path) and map it to `ClientToolSpec`.
- API or SDK: emit `data-committed-revision` on commit success, in both the gated and direct
  paths (R1).

Arda (frontend), the calls that are his:

- The client-tool dispatcher in the message-part renderer (sibling to `ToolActivity`): which
  widget renders for which `render.kind` then `name`, the generic widget as fallback, and an
  explicit "cannot handle that" surface for an unknown client tool. v1 ships only the generic
  widget. This is the central new surface.
- The connect widget: the OAuth popup, the callback listener, and the reply through
  `addToolOutput` (success and failure both settle the part).
- The generalized resume predicate: `agentShouldResumeAfterApproval` extended so a settled
  client-tool output resumes, not only an approval.
- The result UX (U1 inline chip versus U2 chat message; lean U1).
- The config-panel and build-kit refresh on `data-committed-revision`, and later the per-tool
  config-diff widget.

Cross-project (coordinated, not ours to build):

- The skill that teaches the discover, `request_connection`, re-discover, add-tool loop:
  agent-skills.
- Whether a new agent keeps `request_connection` after commit: default-agent-config.

## Rejected alternatives

- Two narrow interaction kinds. Keep `permission` and add a dedicated `connect` kind, each with
  a bespoke frame and widget. Smaller blast radius, but the third interaction repeats the work,
  the `client` executor stays dead, and we pay the generalization later with two special cases
  to retire. D3 chose the generic primitive.
- A fresh user message for the connection result ("I connected GitHub"). The parked call would
  never resolve, so the runner would re-raise it or the model would guess. It pollutes the
  transcript with text the user did not write and reuses none of the resume machinery. D4 chose
  the `tool_result`.
- Refresh off the `commit_revision` tool result (R2). The playground keys the panel refresh off
  the tool's output frame. No new frame, possibly fastest, but it couples the playground to a
  platform tool name and output shape, and it must still fire in the direct un-gated path.
  Acceptable only as a short-lived stopgap. Avoid R3, a blind refetch on every turn finish,
  which is wasteful and can race the write.
- Runner auto-interception of a missing-connection failure. The gateway resolve raises
  `ConnectionNotFoundError` mid-run and the runner raises a connect interaction itself, with no
  agent tool call. The control flow is implicit and lives in the runner, and the parked thing is
  a synthetic interaction rather than a real model tool call, so the cold-replay anchor must be
  synthesized carefully. We may add it later as a fallback, so an agent that skips discovery
  degrades to a connect prompt instead of a raw error. Out of v1 (D2).

## Open questions (non-blocking)

These settle during implementation, with Arda, and do not need Mahmoud now.

- The `render.kind` vocabulary (for example `connect`, `config-diff`). The dispatch precedence
  is settled (`render.kind`, then `name`, then generic fallback); only the string values remain.
- The exact `request_connection` argument and output schema, and its `render` hint.
- Whether the resume predicate stays one function or composes two. Same behavior either way.
- The `data-committed-revision` payload beyond `{ variantId, revisionId, version }`, once the
  refresh code names what it needs.

## Cross-project dependencies

- agent-skills owns the skill that teaches the discover-then-connect loop. Our primitive only
  delivers the "connection ready" signal.
- default-agent-config owns the `build_kit` descriptor and `flags.inject_build_kit`, and decides
  whether `request_connection` ships in a published agent. We reference both.
- agent-builder-capabilities rides this primitive for triggers and subscriptions, and gates a
  live subscription test on a connection. We keep the contract general enough to serve it.

## References

Sibling docs (read to align, do not edit):
`../default-agent-config/`, `../advanced-build-kit/`, `../agent-skills/`,
`../agent-builder-capabilities/`, `../agent-builds-an-app/`.

Code anchors (verified 2026-06-28):

- Neutral event and responder: `services/agent/src/protocol.ts`,
  `services/agent/src/responder.ts` (`approvalKey`, decision extraction).
- Park and finish: `services/agent/src/engines/sandbox_agent.ts`.
- Client-tool guard: `services/agent/src/tools/dispatch.ts`.
- Stream and inbound parsing: `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`
  (`tool-approval-request`, `data-<name>`), `.../vercel/messages.py`.
- Tool models: `sdks/python/agenta/sdk/agents/tools/` (`ClientToolSpec`, `kind: "client"`).
- Platform catalog: `sdks/python/agenta/sdk/agents/platform/op_catalog.py`
  (`find_capabilities`, `commit_revision`; no `executor` field yet).
- Frontend: `web/oss/src/components/AgentChatSlice/`,
  `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts`.
- Connections API: `api/oss/src/apis/fastapi/tools/router.py` (`/tools/discover`,
  `/tools/connections/`, OAuth callback `postMessage`, `ConnectionNotFoundError` 404).
