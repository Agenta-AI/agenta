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
4. **The harness** (Claude Code or Pi). The actual coding agent. Claude Code has its own
   built-in permission system and asks for permission before running gated tools. Pi has
   none; it never asks.
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
"approve tool prompts automatically"; `deny` means "refuse them". Confusingly, this one knob
has three names depending on where you stand:

- Authors write it as `runner.interactions.headless` in the agent config
  (parsed in `sdks/python/agenta/sdk/agents/dtos.py:1087-1102`).
- The SDK stores it as `permission_policy` (`dtos.py:571`).
- The wire to the runner calls it `permissionPolicy` (`services/runner/src/protocol.ts:427`).

The playground labels it "Permission policy" and always sends `auto` unless the author
changes it (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:262`).

**2. Per-tool permission.** Each configured tool (a gateway tool, meaning a hosted
integration action from the Composio catalog; a code tool; an MCP server) can carry its own
`permission`: `allow`, `ask`, or `deny`
(`sdks/python/agenta/sdk/agents/tools/models.py:26`). `allow` means run it without asking.
`ask` means a human must approve each call. `deny` means never run it. A tool with no
explicit permission falls back through a ladder (`effective_permission`,
`models.py:273-292`): a legacy `needs_approval: true` flag means `ask`; a catalog `read_only`
hint defaults reads to `allow` and writes to `ask`; otherwise the tool defers to the global
policy. The output of this ladder is what the rest of this workspace calls the tool's
**disposition**: its final, resolved allow/ask/deny. The tool editor exposes the field as a
Permission select with an "Inherit policy" placeholder (`web/.../ToolFormView.tsx:47-51`).

**3. Claude harness rules.** For the Claude harness only, authors can write raw Claude Code
permission rules (`harness.permissions`: a `default_mode` plus `allow`/`ask`/`deny` rule
lists like `Bash(npm run:*)`). These pass through to Claude's own settings file
(`web/.../ClaudePermissionsControl.tsx`).

**4. Sandbox permission.** Network and filesystem boundaries (`sandbox_permission`). This is
a security boundary, not an approval flow, so this document leaves it aside. It matters here
only because it also renders deny rules into Claude's settings.

Note the vocabulary mismatch: the global policy speaks `auto | deny`, the per-tool field
speaks `allow | ask | deny`. "Auto" and "allow" mean the same thing. The global vocabulary
has no `ask`, which turns out to be central to the bug.

## Where permission is enforced: three gates

A tool call passes through up to three enforcement points, depending on the tool and the
harness. (Strictly there is a fourth site, the sandbox boundary from knob 4, which renders
its own deny rules; it is a security wall rather than an approval gate, so counts of "three
gates" here and "four enforcement sites" in the reviews are the same list with and without
it.)

**Gate 1: Claude's own settings file.** Claude Code checks every tool call against
`.claude/settings.json` before doing anything. The SDK renders that file
(`sdks/python/agenta/sdk/agents/adapters/claude_settings.py:201-258`) by merging four rule
sources: the author's raw Claude rules, denies derived from the sandbox permission, per-MCP-
server permissions, and per-tool permissions. The rendering is deliberately conservative: a
per-tool `allow` becomes an allow rule (Claude runs the tool with no prompt), a `deny`
becomes a deny rule, but `ask` and unset produce no rule at all, which leaves Claude's gate
raised. The docstring at `claude_settings.py:22-31` states the intent: `permission_policy:
"auto"` is not a blanket bypass; an unlisted tool still triggers a permission request.

An important consequence: at the next gate, the runner cannot tell "the author said ask"
from "the author said nothing". Both arrive as the same raised gate.

**Gate 2: the runner's ACP responder.** When Claude's settings do not settle a tool, Claude
raises an ACP permission request to the runner. The handler
(`attachPermissionResponder`, `services/runner/src/engines/sandbox_agent/permissions.ts:38-134`)
does two things, in this order:

1. It emits an `interaction_request` event of kind `user_approval` into the run's event
   stream, unconditionally, before any decision is made (`permissions.ts:93-105`). This is
   the event the frontend turns into Approve/Deny buttons.
2. It asks a "responder" object what to do (`permissions.ts:106-107`).

The responder for product runs is `HITLResponder`
(`services/runner/src/responder.ts:194-232`; HITL stands for human-in-the-loop). Its
decision procedure is three branches, in order:

```ts
async onPermission(request) {
  const stored = this.lookupPermission(request);   // 1. a decision from a previous turn?
  if (stored) return stored;                       //    use it
  if (this.hasHumanSurface) return "park";         // 2. a human might be watching? stop and wait
  return this.basePolicy === "deny" ? "deny" : "allow";  // 3. headless: apply the policy
}
```

Three outcomes are possible. `allow` replies "once" to Claude (approve this single call,
never "always") and the tool runs. `deny` replies "reject" and the tool is refused. `park`
is the interesting one: the runner sends no reply at all, tears the session down, and ends
the turn with `stopReason: "paused"` (`sandbox_agent.ts:640-649, 766-767`). Park means "a
human must answer, and the answer will arrive on a future turn, not this one".

`hasHumanSurface`, the flag branch 2 keys on, is computed from one signal: does the run
request carry a non-empty session id (`sandbox_agent.ts:627`).

**Gate 3: the tool relay.** Gateway and code tools do not run inside the harness; the runner
executes them itself through its tool relay. The relay enforces the per-tool permission
directly (`services/runner/src/tools/relay.ts:143-152`): `allow` runs, `deny` refuses, and
`ask` or unset collapses onto the global policy, with an explicit `TODO(S5): surface ask to
HITL` (S5 is the open-issues slice label for that deferred work). So today, a relay-executed
tool marked `ask` never actually asks anyone; the same authored `ask` behaves differently
depending on which gate handles the tool.

One special tool kind crosses these gates differently: **client tools** (`kind: "client"`,
for example `request_connection`). A client tool is fulfilled by the user's browser, not by
the harness or the relay. When one is called, the runner parks the turn and emits an
`interaction_request` of kind `client_tool`; the frontend fulfills it and the output comes
back on the next turn the same way an approval does. Client tools matter to this review for
two reasons: they are a second park path, wired separately from the approval one, and today
they skip the per-tool permission check entirely (see code-review M4).

Why do gateway tools hit Gate 2 at all, if the relay is Gate 3? Because on Claude, resolved
tools are delivered as tools of an internal MCP server (`mcp__agenta-tools__<NAME>`), and
Claude raises its own gate before the call ever reaches the relay. That is why the settings
rendering (Gate 1) exists: without an allow rule, even an `allow` tool would stop at Gate 2
(this was bug F-046, fixed by rendering per-tool permissions into the settings file).

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
4. Claude runs the three reads without asking (allow rules from their `read_only` hints).
   Their `tool_call` and `tool_result` events stream to the frontend as they happen.
5. Claude wants `SEND_MESSAGE`. No allow rule matches, so Claude raises an ACP permission
   request.
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
   re-sends the entire conversation. Deny re-sends too; the model should hear "no" and
   continue, not hang.
10. On the way back in, the SDK's message adapter folds your decision into a `tool_result`
    content block whose output is the envelope `{"approved": true}`
    (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:103-192`).
11. The runner starts a fresh session (every turn is a cold replay: same conversation, new
    session) and pre-extracts all `{approved}` envelopes from the incoming messages into a
    decision map (`extractApprovalDecisions`, `responder.ts:306-343`). Decisions are keyed
    by tool name plus canonicalized arguments, never by name alone, so approving one call
    does not approve a different call to the same tool.
12. Claude replays the conversation and re-raises the same gate. This time branch 1 of the
    responder finds the stored decision: `allow`. The runner replies "once", the tool runs,
    its result streams, and the turn finishes normally.

That is the designed happy path, and it works. The bug is what happens on step 6 when no
human is on the other end of the stream: the run parks anyway, because "park or not" looks
at the session id instead of the policy. [the-bug.md](the-bug.md) picks up from here.

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
chat open.

Today this plane is deliberately half wired:

- The runner writes to it: it creates a pending row on park and marks the row resolved when
  a stored decision later settles the gate. But only for committed revisions; playground
  drafts skip it entirely (`sandbox_agent.ts:664-670`).
- The only reader is the debug Session Inspector. Its Approve button calls the respond
  endpoint, which does not resume the parked turn; it fires a fresh, detached re-invoke of
  the same revision (`api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:31-76`).
- The product chat UI never touches it.

So think of the interactions plane as an audit shadow with future ambitions. The real
decision loop is the messages plane. Any fix must keep the interactions writes intact (they
are the seed of the future durable flow) without depending on them.

## Harness differences

Only Claude gates. Pi reports `permissions: false` and never raises an ACP permission
request, so nothing parks on Pi and the permission policy does nothing there (the UI hides
the field for Pi with a note, hardcoded by harness name at
`web/.../useModelHarness.tsx:113`). For Pi, the only permission enforcement is Gate 3, the
relay, where `ask` currently degrades to the policy. Real per-tool HITL on Pi would need the
relay to learn to park (tracked as open-issues slice S5.2; see `../hitl-fix/plan.md`).

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
