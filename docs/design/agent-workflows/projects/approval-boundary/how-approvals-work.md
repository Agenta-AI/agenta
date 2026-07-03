# How tool permissions and approvals work

This document explains the whole flow in plain words: what an author can configure, what
happens when an agent wants to run a tool, who decides whether it runs, and how a human
approval travels from a button in the playground back into the run. It describes the code as
it is today, with current paths (the runner lives in `services/runner/`; older docs say
`services/agent/`, which was renamed).

Read this before [the-bug.md](the-bug.md). The bug is a five-line story once you know the
flow; without the flow it is incomprehensible.

## The cast: five systems touch a tool call

One tool call can cross five systems. Each has one job in the permission story.

1. **The playground frontend** (`web/`). Renders the config form (permission policy,
   per-tool permission, Claude rules). During a run, it renders tool activity, shows
   Approve/Deny buttons when a run pauses for approval, and re-sends the conversation after
   you answer.
2. **The agent service** (`services/oss/src/agent/app.py`, Python). The HTTP front door.
   It parses the agent config, resolves tools, and forwards one run request to the runner.
   It serves both shapes: batch (`/invoke`, one JSON reply) and streaming (the playground's
   path, every event as it happens).
3. **The runner** (`services/runner/`, TypeScript). Drives the harness inside the sandbox
   over ACP, the Agent Client Protocol (spoken to a small "sandbox-agent" daemon that hosts
   the harness process). This is where our permission decisions live: the runner answers
   the harness's permission requests, executes gateway/code tools through its "tool relay",
   and emits every event the frontend sees.
4. **The harness** (Claude Code or Pi today; Codex or OpenCode would slot in the same way).
   The actual coding agent. Every harness brings its own native permission behavior, and
   that behavior differs: Claude Code has a full built-in permission system and asks before
   running gated tools; Pi's ACP bridge reports `permissions: false` and never asks anyone
   about anything. How each harness behaves at each gate is summarized in "How this
   generalizes across harnesses" below.
5. **The API interactions plane** (`api/oss`, `/sessions/interactions`). A durable store of
   approval requests, built for the future ("answer an approval hours later, from anywhere").
   Today the runner writes records into it, but the product answers approvals through the
   frontend instead. See "The two planes" below.

The Python SDK (`sdks/python/agenta/`) is the glue between 2 and 3: it defines the config
schema, renders Claude's settings file, and translates the runner's event stream to the
Vercel AI SDK wire format the frontend speaks.

## What an author can configure

Four knobs control what an agent may do without asking. They live at different levels and,
today, under inconsistent names.

**1. The global permission policy.** One value per agent: `auto` or `deny`. `auto` means
"approve tool prompts automatically"; `deny` means "refuse them". Your mental model is
correct: this is the agent-wide default, and each tool can override it; a tool that sets
nothing inherits it. Two things make the current shape confusing, and both are addressed in
the plan:

- The vocabulary does not match the per-tool one (`auto | deny` here, `allow | ask | deny`
  per tool), and it cannot express "ask for everything". The natural set of agent-wide
  behaviors ("approve everything", "ask for everything", "deny everything", "ask only for
  writes") is exactly what the plan's target shape gives you: a `default_permission` of
  `allow | ask | deny`, with "ask only for writes" falling out of the per-tool defaults
  (reads default to `allow`, writes to `ask`; see knob 2). The `deny` default exists for
  lockdown ("this agent runs no tools unless a tool is explicitly allowed"); it is
  legitimate, just rarely what you want.
- The knob has three names depending on where you stand. Authors write it as
  `runner.interactions.headless` in the agent config (parsed in
  `sdks/python/agenta/sdk/agents/dtos.py:1087-1102`); the SDK stores it as
  `permission_policy` (`dtos.py:571`); the wire to the runner calls it `permissionPolicy`
  (`services/runner/src/protocol.ts:427`). "Headless" was meant as "what should the runner
  answer when no human is watching", which is also why it sits under an `interactions`
  section; the name describes one consumer of the value, not the value itself. The stored
  name predates the authored one (the field was flat `permission_policy` first, then the
  authoring surface moved under `runner.interactions` without renaming the storage). The
  plan retires all three in favor of one name in the permission family
  ([plan.md](plan.md), "One wire contract").

The playground labels it "Permission policy" and always sends `auto` unless the author
changes it (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:262`).

**2. Per-tool permission.** Each configured tool (a gateway tool, meaning a hosted
integration action from the Composio catalog; a code tool; an MCP server) can carry its own
`permission`: `allow`, `ask`, or `deny`
(`sdks/python/agenta/sdk/agents/tools/models.py:26`). `allow` means run it without asking.
`ask` means a human must approve each call. `deny` means never run it. A tool with no
explicit permission falls back through a ladder (`effective_permission`,
`models.py:273-292`), in order:

1. an explicit `permission` wins;
2. else `needs_approval: true` means `ask` (`needs_approval` is the older boolean form of
   the same idea, from before the three-valued `permission` field existed; stored configs
   still carry it, so the ladder honors it; the plan deprecates it at the config edge);
3. else the catalog's `read_only` hint applies its default: reads are safe to auto-run
   (`allow`), writes should prompt (`ask`). This is our own convention, applied by our SDK;
   the hint comes from the Composio catalog's tags.
4. else nothing is set, and the tool inherits the global policy (knob 1).

The output of this ladder is what the rest of this workspace calls the tool's
**disposition**: its final, resolved allow/ask/deny. The tool editor exposes the field as a
Permission select with an "Inherit policy" placeholder (`web/.../ToolFormView.tsx:47-51`).

**3. Claude harness rules.** For the Claude harness only, authors can write raw Claude Code
permission rules (`harness.permissions`): a `default_mode` plus `allow`/`ask`/`deny` rule
lists like `Bash(npm run:*)` (`web/.../ClaudePermissionsControl.tsx`). These pass through to
Claude's own settings file. `default_mode` is Claude Code's own top-level switch and worth
knowing: `default` prompts on each gated tool, `acceptEdits` auto-accepts file edits,
`plan` is read-only planning, and `bypassPermissions` skips every gate. Under
`bypassPermissions`, Claude never raises a permission request at all, so nothing in this
document's Gate 2 ever runs; the author has told the harness itself to stop asking.

**4. Sandbox permission.** Network and filesystem boundaries (`sandbox_permission`). This is
a security boundary, not an approval flow, so this document leaves it aside. It matters here
only because it also renders deny rules into Claude's settings.

## Where permission is enforced: three gates

A tool call passes through up to three enforcement points, depending on the tool and the
harness. (Strictly there is a fourth site, the sandbox boundary from knob 4, which renders
its own deny rules; it is a security wall rather than an approval gate, so counts of "three
gates" here and "four enforcement sites" in the reviews are the same list with and without
it.)

A structural remark before the detail, because it answers the natural "why three?"
reaction: the three gates exist because tools physically pass through different choke
points (inside the harness, at the protocol boundary, in the runner's own executor). That
part is unavoidable. What is *not* unavoidable is that today each gate carries its own copy
of the decision logic, consulting its own subset of the config. The plan keeps the three
choke points but gives them one shared decision function, so the gates become dumb
enforcers of one policy instead of three opinions ([design-review.md](design-review.md) §3,
[plan.md](plan.md) "One decision function").

**Gate 1: the harness's own permission layer.** Some harnesses check tool calls themselves
before asking anyone. This gate is harness-specific by nature:

- **Claude Code** checks every tool call against `.claude/settings.json` before doing
  anything. Our SDK renders that file
  (`sdks/python/agenta/sdk/agents/adapters/claude_settings.py:201-258`) by merging four rule
  sources: the author's raw Claude rules (knob 3), denies derived from the sandbox
  permission, per-MCP-server permissions, and per-tool permissions. The merge is additive,
  not overriding: the author's rules are kept verbatim and our derived rules are appended
  (duplicates removed). We never delete or rewrite an author rule. Conflicts are settled by
  Claude's own precedence at match time, where deny beats allow; so an author `deny` always
  holds, and an author `allow` can be beaten only by a derived deny (for example the
  sandbox saying "no network"), which is intended.
- **Pi** has no such layer. Nothing is checked inside the harness.

For per-tool permissions, the Claude rendering is deliberately conservative: a per-tool
`allow` becomes an allow rule (Claude runs the tool with no prompt), a `deny` becomes a deny
rule, but `ask` and unset produce **no rule at all**, which leaves Claude's gate raised so
the call falls through to Gate 2. The docstring at `claude_settings.py:22-31` states the
intent: `permission_policy: "auto"` is not a blanket bypass; an unlisted tool still
triggers a permission request.

One consequence to hold on to, because it constrains the fix: since `ask` and unset both
render as "no rule", they look identical by the time a call reaches Gate 2. The runner
cannot tell "the author explicitly wants a human" from "the author said nothing, apply the
default" unless it consults the tool's disposition from the run request. Today it consults
nothing (that is the bug); the fix makes Gate 2 look the disposition up.

**Gate 2: the runner's ACP responder.** When Gate 1 does not settle a tool, a gating
harness raises a permission request to the runner over ACP. This is not a stream event: it
is a blocking request/response call inside the protocol, like a function call from the
harness to us. The harness stops and waits for our answer before touching the tool. The
`interaction_request` you see in the event stream is a separate thing: an event the runner
chooses to emit so the frontend knows a gate exists. Gate 2 itself is harness-agnostic; any
ACP harness that raises permission requests lands in the same handler. Today Claude is the
only harness that does. Pi never calls it; a future Codex/OpenCode harness would land here
with no runner changes.

The handler (`attachPermissionResponder`,
`services/runner/src/engines/sandbox_agent/permissions.ts:38-134`) does two things, in this
order:

1. It emits the `interaction_request(user_approval)` event into the run's stream,
   unconditionally, before any decision is made (`permissions.ts:93-105`).
2. It asks a "responder" object what to do (`permissions.ts:106-107`).

That order is itself a design flaw: it means the event fires even for a gate the responder
would have answered by itself, so the event cannot mean "a human must act". The plan
inverts it: decide first, emit only when the decision is "wait for a human"
([design-review.md](design-review.md) §4).

To make sense of the responder's logic you need one piece of context first: **decisions can
arrive from a previous turn.** As the journey section below shows in full, a paused run is
resumed by re-sending the whole conversation, and the human's answer travels *inside* that
conversation. The re-run replays from scratch, the harness re-raises the same gate, and the
answer that is already sitting in the transcript settles it. So when a gate arrives, the
responder's first question is "did a previous turn already answer this exact call?".

With that, the decision procedure of `HITLResponder`
(`services/runner/src/responder.ts:194-232`; HITL stands for human-in-the-loop) reads:

```ts
async onPermission(request) {
  const stored = this.lookupPermission(request);   // 1. an answer already in the transcript?
  if (stored) return stored;                       //    use it (this is the resume path)
  if (this.hasHumanSurface) return "park";         // 2. someone might answer? stop and wait
  return this.basePolicy === "deny" ? "deny" : "allow";  // 3. nobody will: apply the policy
}
```

Three outcomes are possible. `allow` replies "once" to the harness (approve this single
call, never "always") and the tool runs. `deny` replies "reject" and the tool is refused.
`park` is the interesting one: the runner sends no reply at all, tears the session down, and
ends the turn with `stopReason: "paused"` (`sandbox_agent.ts:640-649, 766-767`). Park means
"a human must answer, and the answer will arrive on a future turn, not this one".

Branch 2 is where the intended logic and the actual logic part ways. The *intended* logic
was: an interactive surface (someone in the playground) should get the question; a headless
call (nobody watching) should be answered by the policy, because parking a run nobody can
resume just kills it. That intent is defensible. The *implementation* reduced "is a human
watching" to one signal: does the run request carry a non-empty session id
(`hasHumanSurface`, `sandbox_agent.ts:627`). Session ids were a plausible proxy when only
the playground sent them; the SDK now mints one for every request, so the proxy is always
true and branch 3 is dead code. That, plus the fact that the policy should not have been
shadowed by surface detection in the first place, is [the-bug.md](the-bug.md). The fix
removes branch 2 entirely: whether to park becomes a property of the tool's disposition
(`ask`), not of who might be watching.

**Gate 3: the tool relay.** Gateway and code tools do not run inside the harness; the runner
executes them itself through its tool relay. The relay enforces the per-tool permission
directly (`services/runner/src/tools/relay.ts:143-152`): `allow` runs, `deny` refuses, and
`ask` or unset collapses onto the global policy, with an explicit `TODO(S5): surface ask to
HITL` (S5 is the open-issues slice label for that deferred work). So today, a relay-executed
tool marked `ask` never actually asks anyone; the same authored `ask` behaves differently
depending on which gate handles the tool.

If having the executor also check permissions strikes you as mixed responsibilities, that
instinct is right, and the plan agrees: deciding whether a call may run and executing it are
different jobs. In the target design the decision is made once, by the shared decision
function, before execution; the relay executes what was already permitted and carries no
permission logic of its own ([plan.md](plan.md), "One decision function").

Why do gateway tools hit Gate 2 at all, if the relay is Gate 3? This is a Claude-specific
consequence of Gate 1: resolved tools are delivered to Claude as tools of an internal MCP
server (`mcp__agenta-tools__<NAME>`), and Claude gates them like any other tool before the
call ever reaches the relay. That is why the settings rendering exists: without an allow
rule, even an `allow` tool would stop at Gate 2 (this was bug F-046, fixed by rendering
per-tool permissions into the settings file). On Pi there is no Gate 1 and no Gate 2, so
the relay is the only gate a gateway/code tool passes.

One special tool kind crosses these gates differently: **client tools** (`kind: "client"`,
for example `request_connection`). A client tool is fulfilled by the user's browser, not by
the harness or the relay. When one is called, the runner parks the turn and emits an
`interaction_request` of kind `client_tool`; the frontend fulfills it and the output comes
back on the next turn the same way an approval does. Today client tools skip the per-tool
permission check entirely (code-review M4). The right model, and the one the plan adopts,
is that nothing skips the ladder: client tools resolve through the same decision function
as everything else and simply default to `allow` (their whole purpose is to reach the
browser; the surface interaction is the fulfillment, not an approval). If a use case ever
needs a gated client tool, `ask`/`deny` then work with no special casing.

## How this generalizes across harnesses

The gates are a general model; what varies per harness is which gates exist:

| Harness | Gate 1 (native) | Gate 2 (ACP responder) | Gate 3 (relay) |
| --- | --- | --- | --- |
| Claude Code | `.claude/settings.json`, rendered by our SDK | yes, for anything Gate 1 leaves undecided | yes, for the tools it executes (but Gate 1+2 fire first) |
| Pi | none (`permissions: false`) | never fires (Pi never asks) | the only gate |
| future Codex/OpenCode | whatever native config that harness has (rendered by a new adapter) | works unchanged if the harness raises ACP permission requests | works unchanged |

Read Pi's row carefully, because it surprises people: **on Pi, today, everything is
effectively auto-approved except tools the relay refuses.** Pi's bridge does not implement
the ACP permission plane, so Pi executes its builtins without asking, and for
gateway/code tools only the relay's check applies, where `ask` currently degrades to the
policy. There is no human-in-the-loop on Pi at all today. The playground UI is honest about
the policy field (it hides "Permission policy" for Pi with a note, hardcoded by harness name
at `web/.../useModelHarness.tsx:113`), but per-tool `ask` on a Pi agent is silently not
honored. The plan's fix is structural: once the relay consults the shared decision function,
an `ask` disposition parks at the relay exactly like a Claude gate parks at the responder,
and Pi gets real approvals through the same machinery (this is the old S5.2 item; scope
decision 3 in [status.md](status.md)).

## The journey of one gated tool call (the playground path)

Concrete example: the `uc9-digest` agent, Claude harness, policy `auto`. Three read-only
tools are effectively allowed; `SEND_MESSAGE` posts to Slack and ends up gated.

1. You send a message in the playground. The frontend posts the whole conversation to the
   agent service's streaming endpoint.
2. The SDK's request normalizer resolves a session id, minting a fresh UUID if the request
   has none (`sdks/python/agenta/sdk/middlewares/running/normalizer.py:307`,
   `sdks/python/agenta/sdk/models/shared.py:13-22`). The id flows into the run request the
   service sends the runner.
3. The runner starts a Claude session in the sandbox, writing the rendered
   `.claude/settings.json` into the workspace first.
4. Claude runs the three reads without asking: their catalog `read_only: true` hint
   resolved them to `allow` (knob 2's ladder), so our SDK rendered allow rules for them
   into the settings file, and Gate 1 settles the calls inside Claude. Nothing reaches the
   ACP layer for these three, no permission events exist for them anywhere; their
   `tool_call` and `tool_result` events stream out as they happen, and that is all.
5. Claude wants `SEND_MESSAGE`. No allow rule matches (a write, so the ladder said `ask`),
   and Claude raises an ACP permission request: a blocking call to the runner, Claude now
   waits.
6. The runner emits `interaction_request(user_approval)` into the stream, then consults
   `HITLResponder`. No stored decision exists, the request has a session id, so: **park**.
   The runner records a pending interaction row in the API (only when the run belongs to a
   committed revision), sends Claude no answer, destroys the session, and ends the turn with
   `stopReason: "paused"`.
7. The SDK's stream adapter translates the interaction event into a Vercel AI SDK
   `tool-approval-request` chunk on the tool part
   (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:398-437`) and maps the paused
   stop into a benign finish reason.
8. The playground renders the gated tool with "Run this tool?" and Approve/Deny buttons
   (`web/.../ToolActivity.tsx:89-115`). It shows "Waiting for approval", and anything you
   type meanwhile is queued, not sent.
9. You click Approve. The Vercel SDK marks the tool part `approval-responded`, and an
   auto-resume predicate (`sendAutomaticallyWhen: agentShouldResumeAfterApproval`,
   `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:108-122`)
   re-sends the entire conversation. A Deny click re-sends the same way; that is
   deliberate, because the denial must reach the model as information ("the human refused
   this call") so it can continue without the tool. Without the re-send, a denied run would
   just sit paused forever (that dead-end was bug F-036).
10. On the way back in, the SDK's message adapter folds your decision into a `tool_result`
    content block whose output is the envelope `{"approved": true}`
    (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:103-192`).
11. The runner starts a fresh harness session and replays the conversation from scratch.
    Two different "sessions" are in play here, which is why this step looks odd: the
    *Agenta* session id (step 2) is the conversation's identity and persists across turns;
    the *harness* session is a live process inside the sandbox, and the park in step 6
    destroyed it. Nothing server-side holds harness state between turns; each turn is a
    cold replay of the transcript into a new harness session. Before the replay, the
    runner pre-extracts all `{approved}` envelopes from the incoming messages into a
    decision map (`extractApprovalDecisions`, `responder.ts:306-343`), keyed by tool name
    plus canonicalized arguments (never by name alone, so approving one call does not
    approve a different call to the same tool).
12. Claude replays the transcript in the new session. The transcript shows it wanted to
    call `SEND_MESSAGE` and never got a result, so Claude issues the call again, and the
    gate rises again exactly like in step 5; the approval message in the conversation is
    information for the *model*, but Claude Code's permission machinery still demands a
    protocol-level answer for the re-raised gate. This time branch 1 of the responder finds
    the stored decision: `allow`. The runner replies "once", the tool runs, its result
    streams, and the turn finishes normally. (Why does it have to flow through the runner
    again at all? Because only the runner can answer an ACP permission request; the
    approval in the transcript is not something the harness itself reads as an
    authorization.)

That is the designed resume mechanism. **Live behavior warning, now diagnosed:** QA
(Mahmoud, 2026-07-03) showed the happy path looping: clicking Approve re-parked and
re-prompted forever. PR #5054 (Arda's empirical fix) plus our review of it pinned the loop
to two independent bugs that compound, and notably *neither* is the argument-drift we first
suspected:

- **Frontend re-send loop.** The SDK's stream egress sent a constant `messageId: "msg-1"`
  on every turn (`stream.py`; the caller never passed an id), so the Vercel client saw all
  turns as one ever-growing assistant message. The resume predicate
  (`agentApprovalResume.ts`) is level-triggered with no "already resumed" guard, so the
  stale `approval-responded` part kept satisfying it after every later turn, and the
  frontend re-sent the conversation forever. This alone reproduces the infinite loop.
- **Backend key miss, but on the name, not the args.** Claude-over-ACP names the same tool
  call differently in different frames: the `tool_call` stream event carries a category
  title ("Terminal") while the permission frame carries the specific invocation. The
  stored decision is keyed by name plus canonical args; the two frames disagree on the
  *name* half, so the key missed even with byte-identical arguments, and the gate
  re-parked on every resume.

Argument drift (code-review M2) remains a real latent risk of the match-on-replay model,
and the `approvalId`-only drop (M3) is untouched by #5054 and still open. The diagnosis
strengthens the plan's direction: any key that must be reassembled from replayed frames is
fragile, which is why the plan has the runner replay the approved call directly instead of
matching a re-issued one ([plan.md](plan.md), phase 4). Reproducing and pinning the loop
stays an acceptance case (phase 6).

## The two planes: messages and interactions

The approval answer travels on what the code calls the **messages plane**: the decision
rides inside the conversation itself (the `{approved}` envelope in a tool result block) and
takes effect when the frontend re-sends the conversation. This is the plane the product uses
today, end to end.

There is a second, newer **interactions plane**: a `session_interactions` table plus
`/sessions/interactions` endpoints in the API (create, query, transition, respond;
`api/oss/src/apis/fastapi/sessions/router.py:591-882`). The vision (spec:
`docs/designs/sessions/interactions/extend/specs.md`) is durable approvals: a parked run
leaves a pending record that anyone can answer later from any surface, without holding a
chat open. In that future flow, the park creates the row (as it already does), a respond
from any surface records the decision, and a resume replays the conversation with the
decision available, which is exactly the same settle-by-stored-decision mechanism as the
messages plane; the deferred piece is the "whoever reacts first" resolver that reconciles
the two planes and feeds an API-plane answer into a run.

Today this plane is deliberately half wired:

- The runner writes to it: it creates a pending row on park and marks the row resolved when
  a stored decision later settles the gate. But only when the run references a committed
  revision; playground drafts skip it entirely (`sandbox_agent.ts:664-670`). The reason is
  the respond side: answering an interaction re-invokes the workflow, and a re-invoke needs
  a stable revision reference to re-run; an uncommitted draft has none. (Whether the future
  design should key durable approvals on the session instead, so drafts get them too, is a
  fair question for that design; today the guard simply reflects what respond can re-run.)
- The only reader is the debug Session Inspector. Its Approve button calls the respond
  endpoint, which does not resume the parked turn; it fires a fresh, detached re-invoke of
  the same revision (`api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:31-76`).
- The product chat UI never touches it.

So think of the interactions plane as an audit shadow with future ambitions. The real
decision loop is the messages plane. Any fix must keep the interactions writes intact (they
are the seed of the future durable flow) without depending on them.

## Where each piece of code lives

| Piece | File |
| --- | --- |
| Decision logic (responders, decision keys, envelope extraction) | `services/runner/src/responder.ts` |
| ACP gate wiring (emit event, apply decision, park) | `services/runner/src/engines/sandbox_agent/permissions.ts` |
| Human-surface flag, responder construction, park teardown, interactions calls | `services/runner/src/engines/sandbox_agent.ts:590-770` |
| Relay enforcement for runner-executed tools | `services/runner/src/tools/relay.ts:143-152, 230-240` |
| Run request shape (`sessionId`, `permissionPolicy`, per-tool `permission`) | `services/runner/src/protocol.ts:348-474` |
| Interactions API client (create/resolve/cancel-stale) | `services/runner/src/sessions/interactions.ts` |
| Config schema: policy, per-tool permission ladder | `sdks/python/agenta/sdk/agents/dtos.py`, `sdks/python/agenta/sdk/agents/tools/models.py` |
| Claude settings rendering (Gate 1) | `sdks/python/agenta/sdk/agents/adapters/claude_settings.py` |
| Stream egress (interaction event to approval chunk) | `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:384-475` |
| Message ingress (button click to `{approved}` envelope) | `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:103-192` |
| Service handlers (batch and stream) | `services/oss/src/agent/app.py:207-321` |
| Approve/Deny UI and auto-resume | `web/.../ToolActivity.tsx`, `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts` |
| Interactions API (durable plane) | `api/oss/src/apis/fastapi/sessions/router.py:591-882` |
