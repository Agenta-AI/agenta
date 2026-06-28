# The interactive frontend round-trip

Status: design draft, round 3, 2026-06-28. Owner: agent-workflows. Audience: Arda (most of
the frontend work), us (SDK, runner, API). The decisions below are locked. Round 3 adds the
detailed client-tool mechanism (Part 1b), grounded in the Vercel AI SDK.

## The problem in one sentence

An agent sometimes needs the human. It wants to change its own config, or it needs a
connection that does not exist. In both cases the agent must pause, show the user something
in the playground, wait for the user to act, and then continue with the result.

Both cases are the same shape. This doc designs that shape once, then applies it twice.

## Decisions (locked 2026-06-28)

These were the four open questions; Mahmoud answered them. The rest of the doc is written
around them.

- **D1 — config-change approval is per-tool, not hardcoded.** Whether a commit needs
  approval is the tool's own `needs_approval`, handled by the existing approval boundary. Do
  not force "always approve." The new universal requirement is the **refresh**: after a commit
  lands, the playground refreshes the config panel — whether a human approved it or the agent
  committed directly. The refresh signal fires in **both** paths. Do not build a config diff
  now; v1 ships a generic approval UI. But the frame must carry enough identity (tool name
  plus a render hint) for the playground to dispatch a per-tool UI later.
- **D2 — connection trigger is an explicit tool, skill-driven.** The agent learns from
  discovery that a connection is missing and the skill teaches it to call `request_connection`.
  Auto-interception is **out for v1**: the agent handles its own connection needs explicitly.
  Runner auto-interception of a call-time failure stays only a noted future option.
- **D3 — build the generic primitive, not a narrow one.** One client-tool round-trip carries
  both config-approval and connection-request, and it retires the dead `client` executor.
- **D4 — the result returns as a structured tool result (the "callback").** It is keyed to the
  parked tool call and carries a **reference** (integration plus slug, or "connection ready"),
  never the secret. The runner re-resolves the real credential from the vault on resume. The
  "frontend auto-sends a follow-up message" framing maps to this structured result, not a
  free-text user message.
- **D5 — `request_connection` is a hard-coded platform tool with a client executor.** It lives
  in the same platform catalog as `find_capabilities` and `commit_revision`
  (`PLATFORM_OPS` in `op_catalog.py`), except it is client-executed instead of server-executed.
  This resolves the earlier "client-executor tool versus platform tool" question: it is both —
  a platform-catalog tool whose executor is `client`. Because it is a platform tool, it can
  ship in the default embedded set; coordinate with the default-agent-config project on whether
  a new agent gets it by default.

The builder-capabilities project (triggers, subscriptions) rides this same primitive, so the
contract stays general enough to serve those too.

## What we already have (verified in code)

We are not starting from zero. The human-in-the-loop approval flow already does a full
round-trip, and it is the model for everything below.

Today, when a tool needs approval:

1. The runner raises a neutral `interaction_request` event with `kind: "permission"`
   (`services/agent/src/protocol.ts`).
2. The stream adapter projects that event to a Vercel `tool-approval-request` frame
   (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`).
3. The run **parks**: the runner ends the turn with stop reason `paused`, disposes the
   sandbox, and emits a clean `finish` frame (`services/agent/src/engines/sandbox_agent.ts`).
4. The playground renders approve or deny in `ToolActivity` and, the moment the user
   decides, auto-resends via `sendAutomaticallyWhen: agentShouldResumeAfterApproval`
   (`web/oss/src/components/AgentChatSlice/`).
5. The next turn carries the decision back as a `tool_result` block with an `{approved}`
   envelope. The runner cold-replays the conversation and resolves the parked gate, keyed by
   `approvalKey(toolName, args)` (`services/agent/src/responder.ts`).

So the transport exists: out through the stream, park, render, wait, resume on the next
message. The decision even rides home in the right place — a `tool_result` keyed to the tool
call, not a free-floating field.

Two more facts matter:

- The neutral event already declares `kind: "permission" | "input" | "client_tool"`. Only
  `permission` is wired. `client_tool` is the slot reserved for exactly this work, and the
  `Responder` interface has no `onClientTool` yet.
- The `client` executor exists as a tool model (`ClientToolConfig`, `ClientToolSpec`) but the
  runner forbids executing it everywhere, on purpose. The rails are laid; nothing runs on
  them.

The gap is narrow and clear. We have a working round-trip for one fixed interaction
(approve/deny). We need to generalize it so an arbitrary client-side tool can round-trip, and
then point it at two concrete jobs.

## Part 1 — the shared primitive: a client-executor tool that round-trips

### The idea

A client-executor tool is a tool the **playground** runs, not the sandbox. The agent calls
it like any other tool. The runner does not execute it; instead it emits an interaction
request, parks the run, and waits. The playground dispatches a widget, the user acts, and the
result comes back on the next turn as a `tool_result` keyed to the same tool call. The agent
reads the result and continues.

This is the permission flow with two things generalized:

- The **outbound** request carries an arbitrary tool call, not just a permission ask.
- The **inbound** result carries an arbitrary `tool_result` output, not just `{approved}`.

Everything between (park, cold-replay, resume, the auto-resend predicate) stays as is.

### The contract (design-interfaces applied)

The round-trip crosses two boundaries: runner to playground (the stream frame) and playground
to runner (the next message). Each field below is classified by role, not by feature.

**Outbound — the neutral `interaction_request` event (runner-internal, then projected to a
stream frame).**

```jsonc
{
  "type": "interaction_request",
  "id": "acp-perm-123",          // protocol context: correlation id, per-call
  "kind": "client_tool",         // routing: selects the playground dispatcher
  "payload": {
    "toolCallId": "call_abc",    // protocol context: ties the result back to the call
    "toolCall": {                // data: what the tool asked (name + args), for the widget
      "name": "request_connection",
      "input": { "integration": "github" }
    },
    "render": { "kind": "connect", "...": "..." }  // metadata: a presentation hint
  }
}
```

Role classification:

- `id`, `toolCallId` — **protocol context**. Correlation, per-call, platform-owned. Reuse the
  existing names; do not invent a parallel id.
- `kind` — **routing**. It picks which playground widget handles the request. Keep it a closed
  enum at the boundary (`permission`, `input`, `client_tool`; later `connect` if we specialize
  — see Q3). Routing chooses a destination; that is exactly what `kind` does here.
- `toolCall.name` / `toolCall.input` — **data**. The tool and its arguments. The widget reads
  these to know what to show. Caller-owned (the model produced them).
- `render` — **metadata** (a presentation directive). It tells the playground how to draw the
  request. It must never carry behavior or secrets; it is a hint, and the playground may
  ignore it. This reuses the existing `data-render` channel.

**Per-tool dispatch is the load-bearing extensibility (D1).** The contract must let the
playground pick a tool-specific widget later without a protocol change. Two fields make that
possible, and both are already in the frame above:

- `toolCall.name` is the stable dispatch key. `commit_revision` can map to a config-diff
  widget, `request_connection` to a connect widget, a future tool to its own widget.
- `render.kind` is the explicit hint when name alone is too coarse (one tool, several
  presentations).

The dispatcher reads `render.kind` first, falls back to `toolCall.name`, and falls back again
to a generic widget when it recognizes neither. So v1 ships only the generic widget, and every
later per-tool UI is an added case in the dispatcher, not a new frame. The same rule applies to
the approval frame: a `tool-approval-request` already carries `toolCallId`, and the playground
can read the tool name and render hint off the matching tool part, so approvals dispatch
per-tool by the identical mechanism.

**Inbound — the result on the next turn's message history (a `tool_result` content block).**

```jsonc
{
  "type": "tool_result",
  "toolCallId": "call_abc",      // protocol context: matches the parked call
  "toolName": "request_connection",
  "output": { "connected": true, "integration": "github", "slug": "github-main" }
}
```

Role classification:

- `toolCallId` / `toolName` — **protocol context**. The cold-replay anchor. The runner already
  re-keys by `approvalKey(name, args)`, so this is the existing match path.
- `output` — **data**. The result of the interaction, owned by the playground (it ran the
  tool). For approval today, `output` is `{approved}`. For a connection, it is a **reference**
  (`integration`, `slug`), never the credential.

The single most important interface rule here: **the result is a `tool_result` keyed to the
tool call, and it carries a reference, never a secret.** The connection itself lives in the
project vault, keyed `(project_id, provider_key, integration_key, slug)`. The runner
re-resolves it server-side on the resumed turn. Putting the secret in the stream or the
message would leak it into transcripts and traces for no benefit, because the runner has to
re-resolve from the vault anyway.

### Options for the substrate

**Option A — one generic client-tool round-trip (chosen, D3).** Any tool with
`executor: client` round-trips through the playground. `request_connection` is just the first
instance; a config-diff approval, an elicitation form, or a "pick one of these" widget are
later instances with no new transport. The runner gains one `onClientTool` responder that
parks and resolves exactly like `onPermission`. The stream adapter projects `client_tool` to a
generic client-tool frame. The playground gains one dispatcher that routes by tool name or
`render.kind`.

- Motivation: the cost is front-loaded once. Every future "ask the human something" feature
  is then a tool plus a widget, not a protocol change. It matches the executor taxonomy we
  already committed to (builtin / gateway / code / client) and finally makes `client` real.
- Cost: more upfront design on the widget dispatcher, and a generic contract is easier to get
  subtly wrong than a narrow one.

**Option B — two narrow interaction kinds.** Keep `permission` as is and add a dedicated
`connect` kind for Problem 2. No generic client executor yet. Each kind has a bespoke frame
and a bespoke widget.

- Motivation: smaller blast radius, ships Problem 2 fastest, every field is concrete.
- Cost: the third interaction (and there will be a third) repeats the work. The `client`
  executor stays a dead model. We pay the generalization later anyway, with two
  special cases to retire.

**Locked: Option A (D3).** Mahmoud chose the general solution. The second application
(Problem 2) and the likely third (richer config approval, elicitation, and the
builder-capabilities triggers/subscriptions) all want the same transport, and we already carry
the `client_tool` slot and the `client` executor as debt. Building A pays both off. Option B is
recorded only as the rejected narrow alternative.

### What this part costs, split by owner

- Runner (us, TypeScript): add `onClientTool` to `Responder`; park on an unresolved
  client-tool call exactly as permission parks; resolve from the inbound `tool_result` on
  resume. Generalize `extractApprovalDecisions` to also extract generic client-tool results,
  keyed by `approvalKey(name, args)`.
- SDK (us, Python): project `interaction_request kind="client_tool"` to a stream frame in
  `vercel/stream.py`; parse the inbound `tool_result` for client tools in `vercel/messages.py`
  (the approval parsing already exists; widen it). Define the client-tool spec shape.
- Playground (Arda): the **client-tool dispatcher** — render a widget by tool name or
  `render.kind`, and the **resume predicate** — generalize `agentShouldResumeAfterApproval` so
  a settled client-tool part (not only an approval) triggers the auto-resend. This is the
  biggest new frontend surface.

## Part 1b — the client-tool mechanism in detail (grounded in the Vercel AI SDK)

This part answers three questions in detail: how a client tool is registered end to end, where
the dispatch logic lives and what fires in the playground, and the return path plus its UX.

The headline: **we do not invent a transport. The Vercel AI SDK already ships both halves we
need.** The HITL approval flow we run today uses one half. Client tools are the sibling half.

- **The approval half (in use today).** `useChat`'s `addToolApprovalResponse` records the
  decision, and `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`
  auto-resends. Our `agentShouldResumeAfterApproval` wraps that predicate.
- **The client-tool half (what we reuse here).** A tool with no server `execute` is
  client-handled. The playground supplies the result through `onToolCall` and/or
  `addToolOutput` (the API was `addToolResult`, now deprecated in favor of `addToolOutput`),
  and `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` auto-resends. The
  standard `providerExecuted` flag on a tool part says whether the server ran the tool, so the
  playground can tell a server result from a client call.

All symbols above are exported by the installed `ai@6` / `@ai-sdk/react@3` (verified). The work
is to wire our runner and stream to the client-tool half and to add the per-tool widgets — not
to build new streaming.

### How it maps to our runner

- **Server-executed tools** (builtin, gateway, code): the sandbox runs them; the runner streams
  `tool-output-available`. The part arrives **settled**, with `providerExecuted` truthy. The
  playground shows the result; there is nothing to handle.
- **Client-executed tools** (`executor: client`): the runner does **not** execute them. It
  streams the tool call (`tool-input-available`) with no output and **parks** (stop reason
  `paused`), exactly as a permission gate parks. The part arrives **unsettled**, with
  `providerExecuted` falsy, so the Vercel layer treats it as client-handled. The runner already
  forbids executing client tools; we turn "forbid" into "emit and park."

### 1. Registration — three layers, one flag

Design-interfaces first: "this tool runs on the client" is a single config field on the
execution-location axis of the executor taxonomy (builtin / gateway / code / client). It is
platform-owned and long-lived. It must flow unchanged from the catalog to the wire to the
playground. Do not scatter it across feature-named fields.

**Layer A — the platform catalog (server, us).** `request_connection` is a hard-coded platform
op in `PLATFORM_OPS` (`op_catalog.py`), beside `find_capabilities` and `commit_revision`,
except it carries the client executor (D5). One source of truth for "client-handled" starts
here.

**Layer B — the spec and the wire (us).** The resolver emits the tool spec with the client
marker (`ClientToolSpec` / `kind: "client"`). On the wire to the runner the spec carries that
marker, so the runner knows to emit-and-park rather than dispatch to the sandbox. No new wire
shape; the `client` spec already exists, unused.

**Layer C — the playground (Arda).** The playground must know which streamed tool calls are
its job. Two grounding facts make this robust:

- *Implicit, from Vercel:* any tool call that arrives with no server output is client-handled —
  `onToolCall` fires and the part stays unsettled until the playground supplies output.
  `providerExecuted` is the standard field that marks a server-run tool, so client parts read
  falsy. This seam is already in use (`agentApprovalResume.ts` filters `providerExecuted !==
  true`).
- *Explicit, so the playground never guesses:* the playground registers a handler per client
  tool, keyed by `render.kind` then tool `name`. The dispatcher knows its closed set
  (`request_connection` for v1; more later). A tool call whose name is **not** in the registry
  and has **no** server output is an error surface — render a generic "this app cannot handle
  that request" fallback, never a silent hang.

The registration contract on the spec, by role:

- `executor: "client"` (`kind: "client"`) — **config / routing**: the execution location.
  Platform-owned, set in the catalog. The single source of truth for "client-handled."
- `name` — **metadata / identity**: the playground dispatch key.
- `input_schema` — **data**: the call-argument contract.
- `render` (optional) — **metadata**: a presentation hint that refines dispatch.
- `needs_approval` — **policy**, orthogonal: a client tool *may* also be approval-gated, but
  `request_connection` is not (connecting is its own confirmation).

The playground registry is a `Record<string, ClientToolHandler>` keyed by `render.kind` or
`name`. v1 has one entry. Each later client tool is one added entry, not a protocol change.

### 2. Dispatch location — what fires in the playground

The AI SDK gives two entry points; we use the second for any tool that needs human action.

- **`onToolCall({ toolCall })` on `useChat`** fires the instant a client tool call streams in.
  It fits a **fully automatic** client tool that can compute and return (or call
  `addToolOutput`) immediately. It is the wrong place for connect, whose result needs the user
  for seconds to minutes. Note it as available; v1 does not use it.
- **Render-from-parts plus `addToolOutput`** is the **interactive** pattern, and where dispatch
  lives. The tool part sits in `input-available` (unsettled). The message-part renderer — the
  same place `ToolActivity` renders approve and deny today — dispatches the per-tool widget by
  `render.kind` then `name`, falling back to a generic widget. The widget drives the
  interaction, then calls `addToolOutput({ tool, toolCallId, output })`. The part flips to
  `output-available`, and `lastAssistantMessageIsCompleteWithToolCalls` makes
  `sendAutomaticallyWhen` auto-resend.

So dispatch lives in the message-part renderer, not in `onToolCall`, for interactive tools.

Concretely, for `request_connection`:

1. The stream delivers `tool-input-available` for `request_connection` (plus an optional
   `data-render`). The part is unsettled.
2. The runner parks; the turn finishes cleanly.
3. The renderer sees an unsettled client tool part named `request_connection` and dispatches
   the connect widget.
4. The widget calls `POST /tools/connections/`, opens the returned `redirect_url` in a popup,
   and listens for the callback `postMessage`.
5. On completion it calls `addToolOutput({ tool: "request_connection", toolCallId, output: {
   connected: true, integration, slug } })`.
6. `lastAssistantMessageIsCompleteWithToolCalls` is now true, so `useChat` auto-resends.
7. The runner cold-replays, resolves the parked call by `approvalKey(name, args)`, and the
   agent continues.

This needs one generalization of the resume predicate. Today `agentShouldResumeAfterApproval`
wraps the approval predicate. It must also resume on a settled client-tool output — compose it
with `lastAssistantMessageIsCompleteWithToolCalls`. The clean form is one predicate that
returns true when every non-provider-executed tool part on the last assistant turn is settled
(`output-available`, `output-error`, or `approval-responded`) and at least one was just
resolved. That is a small superset of today's function. Arda owns it; we supply the contract.

### 3. Return path and UI

**The resume envelope (the callback).** The result is a tool output keyed to the parked call.
`addToolOutput` carries it home as a `tool_result` block in the next message's history:

```jsonc
{
  "type": "tool_result",
  "toolCallId": "call_abc",          // protocol context: the cold-replay anchor
  "toolName": "request_connection",
  "output": { "connected": true, "integration": "github", "slug": "github-main" }
}
```

- `toolCallId` / `toolName` — **protocol context**. The runner re-keys by
  `approvalKey(name, args)` on resume.
- `output` — **data**, and a **reference**, never the secret: `integration` plus `slug` (or as
  little as `{ "connected": true }`). The runner re-resolves the real credential from the vault.
- Failure and cancel must also settle the part. If the user closes the popup or OAuth fails, the
  widget calls `addToolOutput` with `{ connected: false, reason }` (or the error form via
  `errorText`). The agent then learns it failed and can re-ask. Never leave the part unsettled;
  an unsettled part hangs the resume.

**The UX of showing the result — Arda's call.** The wire envelope is identical either way; this
is pure presentation.

- **Option U1 — an inline status chip (lean).** The connect interaction renders as a compact
  tool-activity row, the same visual language as the approve/deny row: "Connect GitHub" with a
  button, collapsing on success to "GitHub connected" with a check. The raw tool result is not
  shown as a chat bubble.
  - Motivation: consistent with the existing HITL UI, low noise, and the result is plumbing the
    user does not need to read. This matches Mahmoud's "hidden behind a status indicator."
- **Option U2 — a plain chat message.** The result posts as a visible turn ("Connected GitHub")
  in the transcript.
  - Motivation: maximally legible; the conversation literally shows what happened. But it is
    noisier, it can imply the user typed something they did not, and it duplicates what the
    agent will restate on resume.

Lean: **U1**, for consistency with the approval UI and lower noise. Move to U2 only if testing
shows people miss that a connection happened.

### The post-connection handoff

The callback says only "the connection now exists." It does **not** add the tool to the agent.
After the resume, the agent must re-resolve or re-run discovery to actually wire and use the
tool:

1. The resume turn arrives carrying the connect tool result.
2. The agent re-runs `find_capabilities` (or re-resolves the gateway tool). The
   `ConnectionRequirement` now reads `ready` with a `slug`.
3. The agent adds the gateway tool to its config (or calls it) and proceeds.

This loop is **teaching, not transport**. Our primitive delivers the "connection ready" signal;
the **agent-skills / agent-creation-skills project owns the skill** that teaches the agent the
full loop (discover, `request_connection`, re-discover, add the tool). Flag this as a
cross-project dependency. Because connections are project-scoped, the re-resolve succeeds on the
very next turn.

## Part 2 — Problem 1: the agent changes its own config

### What happens today

`commit_revision` is a platform op with `default_needs_approval=True` and
`default_permission="ask"`. The running variant id is server-bound from the run context, so
the agent commits to its own default variant. The approval gate is therefore **already
available** through the permission flow in Part 1's "what we have." When the agent calls
`commit_revision`, the run parks on a permission gate; the user sees the request; on approve
the commit runs server-side; on deny it does not.

Two pieces follow from D1: the approval gate stays a per-tool choice (we do not hardcode it),
and the refresh must fire whether or not a human approved.

### Step 1 — the approval gate is per-tool (D1)

There is no "always approve" decision to make here, and that is the point. Whether
`commit_revision` parks for a human is the tool's own `needs_approval`, read by the existing
approval boundary:

- `commit_revision` ships with `default_needs_approval=True`, so by default the run parks and
  the user approves before the commit takes effect (park-before-run semantics). This is a
  sensible default for "the agent rewrote itself," but it is a default, not a hardcode.
- An author (or a future "auto-commit" mode) can set `needs_approval=False` on the tool config.
  The agent then commits directly, with no gate. The refresh in step 3 still runs.

So Problem 1 needs no new gate logic. It needs the **refresh** (step 3), plus the
**per-tool approval UI hook** the contract now carries.

**The approval UI: generic now, per-tool later.** v1 renders the generic approval widget — it
shows the tool input, which for `commit_revision` is the new config under
`workflow_revision.data`. Do not build a config diff yet. But the frame carries the tool name
and a `render` hint (Part 1, "per-tool dispatch"), so a later `render: { kind: "config-diff" }`
on `commit_revision` lets the playground swap in a real before/after diff with no protocol
change. Raw JSON is a weak approval surface for anything non-trivial, so the diff is the
expected first per-tool widget — but it is a follow-up, not v1.

### Step 2 — the new commit on the default variant

No design choice here; the platform op already targets the running variant and appends a
revision. Worth stating only so the refresh in step 3 knows what to listen for: a successful
`commit_revision` produces a new revision id and version on the default variant.

### Step 3 — refresh the config panel (the universal requirement, D1)

This is the one piece D1 makes mandatory. Today the playground reads the latest revision per
request via `workflowLatestRevisionQueryAtomFamily`. When the agent commits through
`commit_revision` (server-side, not the playground's own commit modal), the playground has no
signal that a new revision landed. It needs one, and it needs it **in both paths**: the gated
path (a human approved, the commit runs on the resume turn) and the direct path
(`needs_approval=False`, the commit runs inside the turn).

The clean way to satisfy both: emit the refresh signal when `commit_revision` **succeeds**, not
when it is approved. Success happens in both paths, so one emit point covers both.

**Option R1 — a named "revision committed" data frame (locked).** On a successful
`commit_revision`, the runner or SDK emits a one-way `data` event,
`data-committed-revision`, with `{ variantId, revisionId, version }`. The playground listens
and invalidates `workflowLatestRevisionQueryAtomFamily`, which refreshes the panel and the
section drawers (#4881). Emitting on success (not on approval) is what makes it fire in both
the gated and the direct path.

- Motivation: this is the role-correct design. The signal's role is metadata — "the config
  changed, here is the new reference." It belongs on the existing one-way `data-<name>`
  channel, not piggybacked on a tool result. It is explicit, typed, and decoupled from any one
  tool's output shape. The #4904 "committed revision reference" work is the natural home.

**Option R2 — key off the `commit_revision` tool result (pragmatic).** The playground already
sees the `tool-output-available` frame for `commit_revision`. Its output carries the new
revision id. The playground invalidates the query when it sees that specific tool settle.

- Motivation: no new frame; possibly works today with #4904 already in place. Fastest.
- Cost: couples the playground to a platform tool name and its output shape. If the tool is
  renamed or its output changes, the refresh silently breaks.

**Option R3 — blind refetch on turn finish.** Refetch the latest revision whenever a turn
finishes.

- Motivation: trivial.
- Cost: wasteful and racy; refetches on every turn whether or not anything changed, and can
  race the commit's write.

Locked: **R1**, emitted on commit success. It is the clean contract, it matches where #4904
already points, and emitting on success is what gives us both paths for free. **R2** is an
acceptable stopgap if #4904 already exposes the committed reference on the tool result and we
want Problem 1 visibly working this week — but it must still trigger in both paths, so confirm
the tool-output frame appears for a direct (un-gated) commit before relying on it. Avoid R3.

### Problem 1 owner split

- Approval gate: already wired and per-tool (D1); no new gate work for us.
- Generic approval UI: the shared dispatcher's generic widget (Arda), built in Part 1.
- Per-tool config-diff render (follow-up): SDK attaches `render: { kind: "config-diff" }` (us);
  the diff widget is Arda.
- Refresh signal (R1): emit `data-committed-revision` on commit success in both paths (us,
  SDK/runner); listen and invalidate the query (Arda).

## Part 3 — Problem 2: the agent needs a connection that does not exist

### The end-to-end flow

1. The agent learns it needs a connection from **discovery**: it calls `find_capabilities`
   (the discovery platform op), which returns a `ConnectionRequirement` with `state`
   (`ready` / `needs_auth` / `needs_input`) and a `connect` affordance. A skill teaches the
   agent the discover-then-connect loop (D2).
2. The agent calls `request_connection(integration)`. The runner raises a client-tool
   interaction: "connect GitHub." The run parks.
3. The playground dispatches a **connect widget**: it shows the integration, calls
   `POST /tools/connections/`, and opens the returned `redirect_url` (the OAuth flow) in a
   popup.
4. The user finishes OAuth. The callback (`GET /tools/connections/callback`) activates the
   connection in the project vault and posts a message to the opener window.
5. The moment the connect widget hears that message, it writes the result back as a
   `tool_result` (`{ connected: true, integration, slug }`) keyed to the parked tool call. The
   resume predicate fires and the conversation auto-resends.
6. The runner resumes, re-resolves the tool (the connection now exists in the vault), and the
   agent proceeds.

### Where the connection request comes from

**Locked: an explicit `request_connection` tool, driven by discovery (D2).** The agent calls
`find_capabilities`, sees a `ConnectionRequirement` that is not `ready`, and calls
`request_connection(integration)`. A skill teaches that loop. The call round-trips through
Part 1's primitive. The `connect` affordance (which endpoint to call, with what body) rides in
the tool input or the render hint, so the playground speaks Agenta, never Composio.

- Motivation: explicit and legible. The agent decides when to ask and can explain why in its
  own words first. It reuses the client-tool primitive with zero new transport. Connection
  state is reported by discovery, not guessed. This is the seam the builder-capabilities
  project depends on for its trigger and subscription work.
- Cost: the agent must know to call it, so the skill must teach the discover-then-connect loop.
  That skill already exists in spirit (the tool-discovery setup skill).

**Rejected as primary, kept as an optional later safety net: runner auto-interception.** This
is the runner catching a missing-connection *failure at call time* — the gateway tool resolve
raises `ConnectionNotFoundError` mid-run, and the runner raises a connect interaction itself,
with no agent tool call. Mahmoud finds this murky and prefers the agent to act on discovery
plus skill guidance. The control flow would be implicit and live in the runner, and the thing
that parks would be a synthetic interaction rather than a real model tool call, so the
cold-replay anchor (`approvalKey(name, args)`) would have to be synthesized carefully. We may
add it later only as a fallback, so an agent that skips discovery degrades to a connect prompt
instead of a raw error. It is not in scope for v1.

### How the result comes back and resumes the agent

Mahmoud described step 5 as "the frontend automatically sends a follow-up message with the
result." There are two ways to send it, and the choice matters.

**Option P1 — a `tool_result` keyed to the parked tool call (recommended).** The connect
widget writes the result as the parked client tool's output. Because it is a settled tool
part, the (generalized) resume predicate auto-resends, exactly like an approval today. The
runner resolves the parked call and the agent reads "connected" as the tool's return value.

- Motivation: it reuses the entire HITL machinery — park, cold-replay, the auto-resend
  predicate, the `tool_result` envelope. The agent gets the answer in the right place: as the
  return value of the tool it called. No fake turns, no transcript pollution. It is the same
  envelope as approve/deny, so one code path covers both.

**Option P2 — a fresh user message ("I connected GitHub").** The playground appends a normal
user message and resends.

- Motivation: conceptually simplest; it is just another user turn.
- Cost: the parked tool call is never resolved, so the runner either re-raises it or the model
  is left guessing. It pollutes the transcript with a message the user did not write. It does
  not reuse the resume predicate. It is the worse fit on every axis.

Locked: **P1 (D4).** It matches "send the result back and resume" while reusing the proven
path. The "follow-up message" framing maps to this structured result, not a literal chat
message; P2 is recorded only as the rejected alternative.

What the result carries: a **reference**, never the secret.
`{ connected: true, integration: "github", slug: "github-main" }`. The connection lives in the
project vault; the runner re-resolves the real credential on resume. The connection is
project-scoped, so it persists beyond the session, and a later run needs no re-prompt.

### Problem 2 owner split

- `request_connection` as a platform-catalog tool with a `client` executor, plus its
  argument/output schema and render hint (D5): us (SDK / catalog), with the connect affordance
  shaped server-side by discovery (already built).
- The **connect widget** — show the integration, call `POST /tools/connections/`, open the
  OAuth popup, listen for the callback `postMessage`, call `addToolOutput`: Arda. This is the
  main new frontend surface for Problem 2.
- Generalized resume predicate (a settled client-tool output triggers resend): Arda (the
  `agentShouldResumeAfterApproval` seam, composed with
  `lastAssistantMessageIsCompleteWithToolCalls`).
- The **skill** that teaches the discover, `request_connection`, re-discover, add-tool loop:
  the agent-creation-skills project (cross-project dependency; our primitive only delivers the
  "connection ready" signal).
- Default-set membership (does a new agent get `request_connection`?): the default-agent-config
  project.
- Optional later safety net (runner auto-interception): us (runner + API); out of v1 scope.

## The frontend-versus-us split, at a glance

Most of this is frontend, and most of the frontend is Arda's call.

**Us (SDK, runner, API):**

- Runner: `onClientTool` responder (emit + park + resume), built as the generic client-tool
  path (D3); generalize result extraction beyond `{approved}` to any structured tool output,
  keyed by `approvalKey(name, args)`.
- SDK: project `interaction_request kind="client_tool"` to a stream frame; parse the inbound
  client-tool `tool_result` (widen the approval parsing); define the `request_connection`
  platform op with a `client` executor (D5); carry `toolCall.name` plus `render` on the frame so
  the playground can dispatch per-tool UIs later (D1).
- API/SDK: emit the `data-committed-revision` refresh frame on commit success, in both the
  gated and direct paths (R1, D1).
- Out of v1 scope: runner auto-interception of a missing-connection failure (the rejected
  safety net, D2).

**Arda (frontend), the decisions that are his:**

- The client-tool **dispatcher**, living in the message-part renderer (sibling to today's
  `ToolActivity` approval UI): which widget renders for which `render.kind` then tool `name`,
  with a generic widget as the fallback and an explicit "cannot handle that" surface for an
  unknown client tool. v1 ships only the generic widget; per-tool widgets are added cases later
  (D1, D3). This is the central new surface and the main "is this how we want it to look and
  behave" call.
- The **connect widget**: the OAuth popup, the callback listener, and the reply via
  `addToolOutput` (success and the failure/cancel case both settle the part).
- The result **UX** (U1 inline status chip versus U2 chat message; lean U1).
- The **config-panel refresh** on the new revision (R1), and later the per-tool **config-diff**
  approval widget.
- The generalized **resume predicate**: `agentShouldResumeAfterApproval` composed with
  `lastAssistantMessageIsCompleteWithToolCalls`, so a settled client-tool output resumes, not
  only an approval.

## Residual open items (not blocking; for the consolidation PR)

The headline decisions (D1-D5) are locked. These smaller choices fall out during implementation
and do not need Mahmoud now:

- The exact `render.kind` vocabulary (for example `connect`, `config-diff`). The dispatch
  precedence is settled (`render.kind` then `name` then generic fallback); only the string
  values remain, an implementation detail to settle with Arda.
- The `request_connection` arguments and output schema (likely `{ integration }` in, `{
  connected, integration, slug }` out) and its exact `render` hint.
- Whether the resume predicate stays one function that covers both approvals and client-tool
  outputs, or two composed predicates. Same behavior; Arda's call at the seam.
- The `data-committed-revision` payload's exact fields beyond `{ variantId, revisionId,
  version }` (for example a human-readable label), once the panel-refresh code names what it
  needs.

Resolved in round 3: `request_connection` is a platform-catalog tool with a `client` executor
(D5), not an either/or; the default-agent-config project decides whether it ships in a new
agent's default tool set.
