# Permission Responder

When a harness asks to use a tool, something has to answer. The responder is that something.
It abstracts two modes behind one interface: a headless policy that auto-approves or denies,
and a human-in-the-loop flow that parks the request for browser approval and resumes it on a
later turn. Because the browser approval spans two turns, the matching logic here is subtle,
and worth reading before you touch it.

## The contract

```typescript
interface Responder {
  onPermission(request: PermissionRequest): Promise<PermissionDecision>;  // "allow" | "deny"
}
```

- **`PolicyResponder`** is headless. It returns `deny` when the policy is `deny`, else `allow`.
- **`HITLResponder`** handles human approval across turns. It holds the approval decisions
  extracted from the message history, a base policy, and whether a human surface exists:
  1. look the request up in the decisions map (by tool-call id, then by tool name),
  2. if found, apply it (the resume path),
  3. if not found and a human can answer, return `deny` to park it (the browser will be asked),
  4. if not found and no human surface, fall back to the base policy (fully headless).

**Decision extraction.** `extractApprovalDecisions(request)` scans the message history for
`tool_result` blocks whose output is `{approved: boolean}`, and indexes each by both its
`toolCallId` and its `toolName`. The tool name is the fallback because a cold replay can mint
a fresh permission id each turn, so the stable anchor is the name.

**Policy precedence.** `deny` from the request wins, then the
`SANDBOX_AGENT_DENY_PERMISSIONS` env override, else `auto`.

## Owned by

- `services/agent/src/responder.ts`: the responders and decision extraction.
- `services/agent/src/engines/sandbox_agent/permissions.ts`: how they wire into the ACP run.

## Watch for when changing

- **Policy precedence.** Request, env override, default. Reordering changes who can approve.
- **Cross-turn matching.** Tool-call id first, tool name as the fallback for cold replays.
  Breaking the fallback breaks approval after a replay.
- **Parking behavior.** Whether a session has a human surface decides park-versus-headless.
  An interactive run parks unapproved tools; a headless `/invoke` applies the base policy.
