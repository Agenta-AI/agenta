# Flows: today, Option A, Option B

Three views per flow where they differ: the harness/ACP wire, our `/messages` stream
parts, and what the user sees. Tool A is `mcp__agenta-tools__commit_revision`, tool B
is `mcp__agenta-tools__create_subscription`. Both are `ask`-gated write tools, so the
CLI schedules them serially (research.md §2b).

## 1. Today: the broken flow

### 1a. Harness / ACP wire

```mermaid
sequenceDiagram
    participant CLI as claude CLI (sandbox)
    participant ACP as claude-agent-acp
    participant D as sandbox-agent daemon
    participant R as runner

    Note over CLI: assistant message streams<br/>two tool_use blocks (A, B)
    CLI->>ACP: content_block_start tool_use A
    ACP->>D: session/update tool_call A (pending, rawInput {})
    D->>R: event tool_call A
    CLI->>ACP: content_block_start tool_use B
    ACP->>D: session/update tool_call B (pending, rawInput {})
    D->>R: event tool_call B
    CLI->>ACP: full assistant message
    ACP--)D: tool_call_update A (real args)
    ACP--)D: tool_call_update B (real args)  [delivery races the teardown below]

    Note over CLI: serial scheduler starts tool A
    CLI->>ACP: control_request can_use_tool(A)
    ACP->>D: session/request_permission A (rawInput = real args)
    D->>R: onPermissionRequest(A)
    Note over R: decide() = pendingApproval<br/>latch.tryAcquire() = true
    R->>R: emit interaction_request(A), pause()
    R->>D: destroySession (never replies to gate A)
    D-->>ACP: gate A resolves outcome=cancelled
    ACP-->>CLI: canUseTool(A) throws "Tool use aborted"

    Note over CLI: scheduler unblocks, tries tool B
    CLI->>ACP: control_request can_use_tool(B)
    ACP->>D: session/request_permission B  [teardown race]
    D->>R: onPermissionRequest(B)
    Note over R: latch.tryAcquire() = false<br/>return. B is DROPPED silently.
    Note over D: teardown resolves gate B<br/>outcome=cancelled
```

### 1b. /messages stream and the playground

```mermaid
sequenceDiagram
    participant R as runner
    participant E as egress (stream.py)
    participant C as AI SDK client
    participant U as user

    R->>E: tool_call A ({}), tool_call B ({})
    E->>C: tool-input-start/available A ({}), B ({})
    R->>E: interaction_request A (real args)
    E->>C: tool-input-available A (real args) + tool-approval-request A
    R->>E: done (stopReason paused)
    E->>C: finish (finishReason "other")

    Note over C: part A: approval-requested<br/>part B: input-available, ORPHAN
    C->>U: ApprovalDock shows gate A
    Note over C: turn ended, B unsettled, no handler:<br/>UnhandledClientTool settles B with<br/>"This app can't handle the ... request."
    C->>U: tool B chip shows FAILED (fake)

    U->>C: Approve A
    Note over C: predicate: all parts settled -> auto resend
    C->>R: POST /messages (full history: A approved, B fake error)
    Note over R: cold replay. Stored decision allows A.<br/>Model re-calls A, executes.<br/>Model sees B's fake error, retries B (real args).
    R->>C: tool-approval-request B (second pause)
    C->>U: SECOND approval prompt (B)
    U->>C: Approve B
    C->>R: POST /messages (resume #2)
    Note over R: stored decision allows B. Executes. Turn completes.
```

### 1c. What the user sees

| Step | UI |
|---|---|
| Turn streams | Two tool chips appear (A and B). |
| Turn pauses | Approval dock asks about A. B's chip flips to `failed` with "This app can't handle the ... request." |
| Approve A | New turn block streams. A runs. Model retries B. Dock asks about B. |
| Approve B | New turn block streams. B runs. Done. |

Two approval round-trips, one fabricated failure, and (issue 1, out of scope here) the
repeated turn blocks.

## 2. Option A: settle the losing sibling deterministically

Only the pause step changes. Before teardown, the runner scans its own event log for
announced tool calls with no result (excluding the paused one) and emits a truthful
terminal `tool_result` for each.

### 2a. Wire (delta only)

```mermaid
sequenceDiagram
    participant R as runner
    participant E as egress (stream.py)
    participant C as AI SDK client

    Note over R: pause(): latch winner is A.<br/>Scan events: tool_call B has no tool_result.
    R->>E: tool_result B {isError: true, output:<br/>"Not executed: the turn paused for approval of<br/>another tool call. Call the tool again if needed."}
    E->>C: tool-output-error B (honest server-side state)
    R->>E: interaction_request A, done(paused)
    Note over C: part B settled -> classifier never<br/>parks it, no fake browser error
```

Nothing changes at the ACP layer. Gate B (if it arrives in the teardown race) still
loses the latch and is still ignored; its tool call is already settled.

### 2b. Resume (same shape as today, honest content)

The history now carries B's deterministic "not executed" error instead of the browser's
"can't handle" text. The replayed transcript renders
`[mcp__agenta-tools__create_subscription error: Not executed: ...]`
(`transcript.ts:53-55`), the model retries B, the gate pauses, the user approves
second. Still two round-trips, but every state shown was true.

### 2c. What the user sees

| Step | UI |
|---|---|
| Turn pauses | Dock asks about A. B's chip shows "Not executed: waiting on another approval" (error-styled but truthful; exact copy TBD). |
| Approve A | A runs, model retries B, dock asks about B. |
| Approve B | B runs. Done. |

## 3. Option B: batch all pending approvals into one pause

The runner cannot wait for the harness to raise gate B (research.md §3). Instead, at
pause time it synthesizes the sibling's approval request from its own record: any
announced, unresolved tool call whose `decide()` verdict would be `pendingApproval`
and whose recorded args are trustworthy. Everything downstream already supports it.

### 3a. Wire and stream

```mermaid
sequenceDiagram
    participant R as runner
    participant E as egress (stream.py)
    participant C as AI SDK client
    participant U as user

    Note over R: gate A wins the latch.<br/>pause(): scan events for siblings.<br/>B: unresolved + decide()=ask + real args recorded
    R->>E: interaction_request A (harness gate)
    R->>E: interaction_request B (synthetic, from recorded call)
    R->>E: tool_result for any OTHER unresolved call (Option A fallback)
    E->>C: approval-request A + approval-request B
    Note over C: parts A and B: approval-requested
    C->>U: dock shows "1 of 2" (queue already built)
    U->>C: Approve A, Approve B (or "Approve all")
    Note over C: predicate holds resume until BOTH settle,<br/>then ONE auto resend
    C->>R: POST /messages (history: A approved, B approved)
    Note over R: cold replay with TWO stored decisions.<br/>Model re-calls A -> gate matched -> runs.<br/>Model re-calls B -> gate matched -> runs.
    R->>C: single continuation stream, turn completes
```

### 3b. What the user sees

| Step | UI |
|---|---|
| Turn pauses | Dock shows "Approval needed, 1 of 2" with A's payload. B's chip shows "Awaiting approval". |
| Approve A (or Approve all) | Dock slides to B. |
| Approve B | One resume. Both tools run in order. Done. |

One approval interaction, one round-trip, no fabricated state.

### 3c. The fallback inside Option B

A sibling that fails the trust check falls back to Option A's deterministic settle:

- recorded args are `{}` or absent (the refresh lost the race, research.md §4). Asking
  a human to approve an invisible payload is unacceptable, and the stored decision key
  `name#{}` would not match the re-raised gate anyway (`responder.ts:65-76`), forcing a
  second prompt regardless.
- `decide()` says `allow` or `deny` for the sibling (it never needed a human), but it
  cannot run because the session is dying: settle it with the deferred error so the
  model retries it after resume.

## 4. Example frames (obfuscated, shapes verified)

ACP announcement the runner receives (first encounter, streamed):

```json
{"sessionUpdate": "tool_call", "toolCallId": "toolu_01AbC...", "status": "pending",
 "title": "create_subscription", "kind": "other", "rawInput": {},
 "_meta": {"claudeCode": {"toolName": "mcp__agenta-tools__create_subscription"}}}
```

ACP permission request (the gate; carries real args):

```json
{"sessionId": "sess_...", "options": [
   {"kind": "allow_always", "name": "Always Allow", "optionId": "allow_always"},
   {"kind": "allow_once", "name": "Allow", "optionId": "allow"},
   {"kind": "reject_once", "name": "Reject", "optionId": "reject"}],
 "toolCall": {"toolCallId": "toolu_01AbC...",
   "rawInput": {"plan": "pro", "seats": 3}}}
```

Runner `interaction_request` event (what the egress projects; the synthetic Option B
sibling uses the same shape, mirroring the Pi relay emission at
`sandbox_agent.ts:777-792`):

```json
{"type": "interaction_request", "id": "toolu_01AbC...", "kind": "user_approval",
 "payload": {"toolCallId": "toolu_01AbC...",
   "toolCall": {"toolCallId": "toolu_01AbC...", "resolvedName":
     "mcp__agenta-tools__create_subscription", "rawInput": {"plan": "pro", "seats": 3}},
   "availableReplies": ["once", "reject"]}}
```

Stream parts the client receives for one gated call:

```json
{"type": "tool-input-available", "toolCallId": "toolu_01AbC...",
 "toolName": "mcp__agenta-tools__create_subscription",
 "input": {"plan": "pro", "seats": 3}}
{"type": "tool-approval-request", "approvalId": "toolu_01AbC...",
 "toolCallId": "toolu_01AbC..."}
```

Approval decision as it returns in the next request's history (after ingress folding,
`messages.py:174-181`):

```json
{"type": "tool_result", "tool_call_id": "toolu_01AbC...",
 "tool_name": "mcp__agenta-tools__create_subscription",
 "output": {"approved": true}}
```
