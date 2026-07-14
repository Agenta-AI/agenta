# Research: the full HITL path, read-only trace

> Superseded: the permission/approval model described here was redesigned in [projects/approval-boundary/](../approval-boundary/) (2026-07). Kept as a dated record.

All citations are to the tree at `gitbutler/workspace` (v0.104.2). The HITL round-trip
crosses four layers. The renderer, the egress, and the cross-turn resume are correct. The
break is a single conflicting reply in the **runner**, which poisons the wire so the
correct egress part is overwritten by a tool error.

## Layer 1 — Runner: how the gate is handled (THE BUG)

### The wiring

`services/agent/src/engines/sandbox_agent.ts:350-361` builds the responder per run:

```ts
const hasHumanSurface = !!(request.sessionId && request.sessionId.trim());
attachPermissionResponder({
  session,
  run,
  responder:
    deps.responderFactory?.(request.permissionPolicy) ??
    new HITLResponder(
      extractApprovalDecisions(request),
      policyFromRequest(request.permissionPolicy),
      hasHumanSurface,
    ),
});
```

`hasHumanSurface` is true on the `/messages` (playground) path because that endpoint stamps a
`sessionId` on every turn; it is false on headless `/invoke`. Correct.

`services/agent/src/engines/sandbox_agent/permissions.ts:21-44` is `attachPermissionResponder`.
On every ACP permission request it does TWO things:

1. Emits the protocol-neutral event (correct — this is what the FE needs):

```ts
run.emitEvent({
  type: "interaction_request",
  id,                       // ACP permission id -> Vercel approvalId
  kind: "permission",
  payload: { toolCallId: req?.toolCall?.toolCallId, toolCall: req?.toolCall, availableReplies, options },
});
```

2. Asks the responder for a decision and **replies to the harness with it**:

```ts
void responder.onPermission({ id, availableReplies, raw: req })
  .then((decision) => session.respondPermission(req.id, decisionToReply(decision, availableReplies)))
  .catch(() => {});
```

### The park decision

`HITLResponder.onPermission` (`services/agent/src/responder.ts:87-92`):

```ts
async onPermission(request) {
  const stored = this.lookup(request);
  if (stored) return stored;                 // resume path: a prior turn decided
  if (this.hasHumanSurface) return "deny";   // PARK: do not run the unapproved tool this turn
  return this.basePolicy === "deny" ? "deny" : "allow"; // headless parity
}
```

On the playground first turn there is no stored decision and `hasHumanSurface` is true, so it
returns `"deny"` to "park". The comment says denying "just declines to run the unapproved tool
this turn; the turn ends safely". That reasoning is the bug.

### Why park-by-reject poisons the wire

`decisionToReply("deny", ...)` (`responder.ts:177-189`) maps `deny` to the ACP `reject`
reply. So `attachPermissionResponder` calls `session.respondPermission(req.id, "reject")`.

For the **Claude** harness, replying `reject` to a permission request is not a no-op — Claude
treats it as the user refusing, and produces a **failed tool call**: a `tool_call_update`
with `status: "failed"` whose content is "User refused permission to run tool".

The runner's event state machine turns that into a tool-error event.
`services/agent/src/tracing/otel.ts:1040-1054` (`maybeCloseTool`):

```ts
const status = update?.status;
if (status !== "completed" && status !== "failed") return;
const out = acpToolContentText(update.content) || acpToolContentText(update.rawOutput);
...
record({ type: "tool_result", id, output: out, isError: status === "failed" });
```

So for the SAME `toolCallId` the runner emits, in order on one turn:

1. `tool_call` (the input) — possibly,
2. `interaction_request` (kind `permission`) — the part the FE needs,
3. `tool_result` with `isError: true`, output "User refused permission to run tool".

### The net effect

The egress (Layer 2) faithfully turns (2) into `tool-approval-request` and (3) into
`tool-output-error`, both keyed to the same `toolCallId`. The AI SDK merges parts by
`toolCallId`, so the later `output-error` **clobbers** the `approval-requested` state. The FE
renders the final state: ERROR "User refused permission to run tool" — exactly the symptom.
The gate fired, the approval part WAS emitted, but the runner's own `reject` reply destroyed it
on the same turn.

This is why F-024 reads "the gate fires but no prompt": the prompt is emitted and immediately
overwritten by the refusal the runner itself triggered.

## Layer 2 — Protocol / stream egress (CORRECT)

The protocol-neutral IR has the HITL event:
`services/agent/src/protocol.ts:231-236` defines
`{ type: "interaction_request"; id; kind: "permission" | "input" | "client_tool"; payload? }`.

The Vercel egress maps it correctly:
`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:149-151` routes
`interaction_request` to `_interaction_parts`, and `:201-242` emits, for `kind == "permission"`:

- a synthesized `tool-input-start` / `tool-input-available` if no tool call preceded it
  (so the approval has a tool part to attach to), then
- `{ "type": "tool-approval-request", "approvalId": <event id>, "toolCallId": <id> }`.

`TOOL_APPROVAL_REQUEST = "tool-approval-request"`
(`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:14`).

The inbound direction is also correct. The approval reply rides back as a
`tool-approval-response` UIMessage part; `messages.py:79-80,139-148` (`_approval_response_blocks`)
converts it to a `tool_result` block whose `output` is `{ "approved": boolean }`. The runner's
`extractApprovalDecisions` (`responder.ts:127-159`) reads exactly that envelope to build the
cross-turn decision map. The two sides agree on the wire.

Conclusion: the egress already emits `tool-approval-request` when the gate fires. The problem
is purely that the runner ALSO emits a clobbering `tool-output-error` on the same turn.

## Layer 3 — Frontend (CORRECT)

`web/oss/src/components/AgentChatSlice/components/ToolPart.tsx`:

- `STATE_META` includes `"approval-requested": {label: "Awaiting approval", color: "warning"}`
  (`:47`) and `"output-error"`, `"output-denied"` states.
- When `state === "approval-requested" && approval?.id`, it renders "Run this tool?" with
  Approve and Deny buttons (`:153-176`) calling
  `onApprovalResponse({id: approval.id, approved: true|false})`.

`web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:93,99,243`:

- destructures `addToolApprovalResponse` from `useChat`,
- sets `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` (auto-resume),
- passes `onApprovalResponse={addToolApprovalResponse}` down to the tool part.

The outbound transport carries the decision: `assets/transport.ts` + `assets/toAgentaMessage.ts`
fold the approval into the request (Track A sends UIMessage parts verbatim; Track B surfaces it
in a `tool_approvals` side field). The `/messages` egress + `extractApprovalDecisions` consume it.

Conclusion: the FE renders Approve/Deny and resumes correctly IF it receives a surviving
`approval-requested` part. It does not, only because the runner overwrites it.

## Layer 4 — Pi permission model (NOT WIRED BY DESIGN)

Pi never raises a permission gate:

- `services/agent/src/engines/sandbox_agent/capabilities.ts:111` static fallback sets
  `permissions: !isPiHarness` — Pi reports `permissions: false`.
- `sdks/python/agenta/sdk/agents/dtos.py:662-709` (`PiAgentConfig`) hardcodes
  `"permissionPolicy": "auto"  # Pi never gates tool use` and carries no permission policy at
  all; the docstring says "Pi does not gate tool use, so no permission policy applies".
- `PermissionPolicy = Literal["auto", "deny"]` (`dtos.py:110`) — there is no `ask` value, and
  the policy is Claude-only in effect.

The FE "Permission policy" field (`AgentConfigControl.tsx:675-678`) is schema-driven from
`props.permission_policy`, whose enum is the SDK `PermissionPolicy` (`auto`/`deny`). So Pi (and
the policy field generally) cannot express `ask`. There is no Pi code path that would surface an
`interaction_request`, so even if the form offered `ask` for Pi, nothing would honor it on the
harness path.

The only way to gate a Pi tool is the runner-side **relay** for resolved `code`/gateway tools,
and that path explicitly degrades `ask` to the headless policy and returns a refusal string —
it cannot park/emit/resume. This is the separately-tracked open issue "Relay-tool HITL:
resolved code/gateway tools cannot park/emit/resume (S5.2)"
(`docs/design/agent-workflows/scratch/open-issues.md`), with `TODO(S5)` markers at
`services/agent/src/tools/relay.ts:65` and `:128`.

## Cross-check: SDK QA

A parallel SDK QA pass is checking whether the SDK HITL path has the same break. From this
code trace, the SDK egress/ingest (Layer 2) is correct in both directions: it emits
`tool-approval-request` and ingests `tool-approval-response` into the `{approved}` envelope.
So the SDK HITL helpers are not the cause; the same runner `reject`-clobber would surface to an
SDK consumer too (the run stream would carry the approval part followed by the error part).
Fold the SDK QA result in when available; the expectation is that fixing the runner fixes both
surfaces, because they share the egress and the runner.

## The one-line root cause

The runner parks an `ask` gate by replying `reject` to the harness AND emitting the
approval-request event. For Claude, `reject` produces a failed tool call ("User refused
permission") that the egress projects as `tool-output-error` on the same `toolCallId`,
overwriting the `approval-requested` part. Park and surface contradict each other on the wire.
