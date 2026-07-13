# Permission Responder

> Superseded terms: this file used to describe `PolicyResponder`/`HITLResponder` and "park".
> Those are gone. It now describes `ApprovalResponder` and "pause", the current implementation.

When a harness asks to use a tool, something has to answer. `ApprovalResponder` is that
something. It answers every ACP permission gate and every client-tool request from one shared
decision function, so there is one policy instead of separate headless and human-in-the-loop
paths. Because a paused approval spans two turns, the resume-matching logic here is subtle and
worth reading before you touch it.

## The contract

```typescript
interface Responder {
  onPermission(request: PermissionGateRequest): Promise<Verdict>;
  onClientTool(
    request: ClientToolGateRequest,
    opts?: { consume?: boolean },
  ): Promise<ClientToolVerdict>;
}

type Verdict =
  | { kind: "allow" }
  | { kind: "deny" }
  | { kind: "pendingApproval" };
```

`ApprovalResponder` is the only implementation. It holds a `PermissionPlan` (the parsed
`permissions: {default, rules}` block from the run request) and a `ConversationDecisions`
store (approvals and denials recovered from the replayed message history).

**`onPermission`.** Calls `decide(gate, plan, decisions)` from
`services/runner/src/permission-plan.ts`, the same shared function the tool relay uses:

1. Resolve the gate's effective permission: the tool's or MCP server's explicit `permission`
   if set, else a matching authored rule, else the policy's `default` mode (`allow_reads`
   consults the tool's read-only hint; no hint counts as a write).
2. `deny` refuses. `allow` runs, in place, no pause.
3. `ask` looks for a stored decision from a previous turn (matched by stable anchor, see
   below). Found, it applies once and is consumed. Not found, the verdict is
   `pendingApproval`: the run pauses and waits for a human.

**`onClientTool`.** Client tools (browser-fulfilled, for example `request_connection`) resolve
the same way but default to `allow` when unset, since their whole purpose is to reach the
browser. A stored output already fulfills the call without asking again.

**Resume matching.** `extractApprovalDecisions` scans the incoming message history for
`tool_result` blocks carrying an `{approved: boolean}` envelope, and keys each one by
`approvedCallKey(name, args)`: a stable tool name plus canonicalized arguments, never a
display title. The name anchor differs by executor: the spec's own name for relay/client
tools (it cannot drift), and the recorded `tool_call` name for harness gates (Claude Code
today). A stored decision matches only the same call; different arguments are a different
call and pause for a fresh approval, visibly. A stored decision is consumed on first match,
so one approval authorizes one execution, and a config changed to `deny` always beats it
because the effective permission is resolved before the stored decision is consulted.

## How it fits with the relay

`ApprovalResponder` is Gate 2, for tools the harness gates natively (Claude Code's
`.claude/settings.json` layer decides first; anything it leaves undecided reaches this
responder over ACP). The tool relay (`services/runner/src/tools/relay.ts`) is Gate 3, for
tools the runner executes itself (gateway, code, client) and, since the pi-builtin-gating
slice, for Pi's own builtins too: the bundled Pi extension's `tool_call` hook reports each
builtin call over the relay directory as a permission record, and the relay decides it
through this same `decide()` before answering. Both gates call the same
`effectivePermission`/`decide` pair from `permission-plan.ts`, so they can never disagree
about a tool's permission. The relay's DIALOG enforcement is only needed on Pi, since
Claude's Gate 1 and Gate 2 already decide before a call reaches the relay. Separately, the
relay re-checks every execute record with a runner-side execution guard on EVERY harness
(`buildRelayExecutionGuard`, `services/runner/src/engines/sandbox_agent/relay-guard.ts`): the
relay dir is sandbox-writable, so a forged request file must never run a denied tool. `ask`
splits by harness there — Pi consumes a dialog-recorded execution grant; a non-Pi MCP harness
passes `ask` because its own dialog gated the call before the shim. See the relay-guard notes
in [runner-to-mcp-server](../cross-service/runner-to-mcp-server.md).

## Owned by

- `services/runner/src/permission-plan.ts`: the shared decision function (`effectivePermission`,
  `decide`), the `PermissionPlan` and `GateDescriptor` types, and `permissionsFromRequest`
  (parses the wire `permissions` block, applies the `SANDBOX_AGENT_DENY_PERMISSIONS`
  kill-switch).
- `services/runner/src/responder.ts`: `ApprovalResponder`, `ConversationDecisions`,
  `extractApprovalDecisions`, `approvedCallKey`.
- `services/runner/src/engines/sandbox_agent.ts` and
  `services/runner/src/engines/sandbox_agent/acp-interactions.ts`: how the responder wires
  into the ACP run (`attachPermissionResponder`), and the pause/teardown when a verdict is
  `pendingApproval`.

## Watch for when changing

- **One decision function.** Both gates call `effectivePermission`/`decide`. Do not let a
  gate grow its own copy of the ladder; that is the bug this redesign fixed.
- **Resolve before checking stored decisions.** The effective permission must be computed
  first, so a config change to `deny` beats a stale approval. Reordering breaks that
  guarantee.
- **Stable anchors only.** Resume matching keys on the spec name or the recorded `tool_call`
  name plus canonical args, never a harness display title. A drifted key reintroduces the
  approval loop this redesign closed.
- **Emit only on pause.** `interaction_request(user_approval)` fires only when the verdict is
  `pendingApproval`. Emitting before the decision (the old order) produces false prompts for
  gates that were actually auto-approved.
- **Consume once.** A stored approval or denial applies to exactly one execution.
