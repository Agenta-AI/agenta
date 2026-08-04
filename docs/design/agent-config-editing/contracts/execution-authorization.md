# Contract: execution authorization for `value_from`

Status: proposed. This contract answers must-fix item 4 and answer section 2 of
`research/design-gate-review-codex.md`.

This contract replaces the tool-call-id cache in `spikes/runner-spike.md`. The cache was not
safe. This document defines what replaces it.

## 1. Why the cache was not safe

The runner resolves `value_from` into a skill value. A human then approves that value. The
runner then executes the call. Three things can go wrong between the approval and the
execution.

The relay directory is writable from inside the sandbox. Any process in the sandbox can write
an execute record. The record does not prove that a dialog ran. The runner-side guard catches
most of this, but it does not catch all of it. Read
`services/runner/src/engines/sandbox_agent/relay-guard.ts` lines 14 to 22. The guard passes
every `ask` verdict on a non-Pi harness. It passes because the harness raises its own dialog,
and the runner records no grant for that dialog. The module comment states the residual risk in
plain words: a forged request file can start an `ask` tool with no dialog.

A cache keyed only on the tool-call id inherits that hole. An attacker in the sandbox writes a
record with the approved tool-call id and different arguments. The cache hits. The runner
executes.

A cache miss is also unsafe. The spike made a cache miss fall back to inline resolution. An
attacker then removes the need for a cache entry. The attacker forges a record for a tool-call
id the runner never gated. The cache misses. The runner reads the folder and commits it.

So the runner needs a record that binds the approval to one exact call. The runner must consume
that record exactly once. A missing record must stop the call.

## 2. The execution authorization

An execution authorization is one record. The runner creates it when it resolves a
`value_from`. The runner consumes it when it executes the call. The record lives in runner
memory only.

### 2.1 Fields

| Field | Type | Purpose |
|---|---|---|
| `authorizationId` | string | A random identifier. The runner uses it in logs. It is not a capability. |
| `toolName` | string | The canonical tool name. It must equal the executed spec's name. |
| `toolCallId` | string | The harness's identifier for the call. It correlates the record. It does not authorize it. |
| `argsDigest` | string | SHA-256 over the canonical form of the model's ORIGINAL arguments. The arguments still hold `value_from`, not the resolved value. |
| `frozenValueRef` | handle | An opaque handle into the frozen-value store. Section 5 defines the store. The record never holds the bytes. |
| `contentDigest` | string | SHA-256 over the canonical form of the FULL resolved value, including every file's bytes. |
| `manifestDigest` | string | SHA-256 over the approval manifest. Section 4 of `workspace-import.md` defines the manifest. |
| `catalogGeneration` | string | The tool-catalog generation that was live when the runner minted the record. |
| `sourcePath` | string | The import path the model asked for. It is used for the card and for logs. |
| `operationIndex` | integer | The index of the operation inside `delta.operations`. One record covers one operation. |
| `createdAtMs` | integer | Mint time. |
| `expiresAtMs` | integer | Hard deadline. Section 6 defines it. |
| `consumed` | boolean | Single-use flag. Section 3.3 defines the transition. |
| `turnId` | string | The turn that minted the record. |
| `sessionId` | string | The session that minted the record. |

### 2.2 What each binding stops

| Binding | Attack it stops |
|---|---|
| `toolName` | A forged record that names a different tool but reuses the tool-call id. |
| `argsDigest` | A forged record that keeps the tool-call id and changes the arguments. This is the same-id argument substitution case. |
| `contentDigest` | A folder that changes on disk between approval and execution. The runner executes the frozen bytes and proves they are the approved bytes. |
| `catalogGeneration` | A record minted under an old tool catalog. The tool's meaning may have changed. |
| `expiresAtMs` | A record replayed long after the approval. |
| `consumed` | A record replayed inside the window. |

### 2.3 Canonical forms

`argsDigest` and `contentDigest` both need one canonical serialization. The runner already has
one. `canonicalJson` in `services/runner/src/responder.ts` sorts object keys and rejects any
value that is not plain JSON. The authorization store must reuse it.

The runner must fail closed when canonicalization fails. It must not fall back to a weaker key.
`ApprovedExecutionGrants.grant` in the same file already fails closed on an unkeyable call. The
authorization store must do the same, but it must also refuse to mint the record. A grant that
cannot be keyed is a silent no-op today. An authorization that cannot be keyed must be an error
the model sees.

## 3. Lifecycle

### 3.1 Mint

The runner mints a record when it resolves a `value_from`. This happens at the permission gate,
before the approval card is built.

The steps run in this order.

1. Read the permission plan verdict for the call.
2. Resolve the `value_from` under the import contract. See `workspace-import.md`.
3. Write the frozen value into the frozen-value store. Get a handle back.
4. Compute `argsDigest`, `contentDigest`, and `manifestDigest`.
5. Read the live `catalogGeneration`.
6. Store the record, keyed on `toolCallId` plus `operationIndex`.
7. Build the approval card from the manifest.

A resolution failure stops the call before step 3. The model receives the structured error from
the import contract. The runner mints no record.

### 3.2 Verify

The runner verifies before every execution. The check runs inside the relay execution guard, or
immediately after it. It must run for every harness. It must not depend on the harness raising a
dialog.

The check is:

1. Look up the record by `toolCallId` and `operationIndex`.
2. A missing record fails closed. Section 4 states the one exception.
3. A `consumed` record fails closed.
4. An expired record fails closed.
5. `toolName` must equal the executed spec's name. Otherwise fail closed.
6. Recompute the digest of the incoming record's arguments. It must equal `argsDigest`.
   Otherwise fail closed.
7. `catalogGeneration` must equal the live generation. Otherwise fail closed.
8. Read the frozen value through `frozenValueRef`. Recompute its digest. It must equal
   `contentDigest`. Otherwise fail closed.

Every failure returns a deny reason as the tool result text. The model loop continues. This is
the same shape a dialog deny uses today.

### 3.3 Consume

The runner marks the record `consumed` before it starts the call. It does not mark it after.
The order matters. A crash between the call and the mark would leave a reusable record.

The mark and the read must be one atomic step in the runner's event loop. A `Map.delete` that
returns the entry gives this for free in JavaScript. Use that shape rather than a read followed
by a write.

The runner then substitutes the frozen value into the call body. It replaces `value_from` with
`value`. It never rereads the folder.

### 3.4 Discard

The runner discards a record on every one of these events.

- The turn ends, for any reason.
- The human denies the gate.
- The record expires.
- The session is evicted from the pool.
- The turn is aborted or the client disconnects.
- The environment is destroyed.

Discard also releases the frozen bytes. Section 5 defines the release.

## 4. Fail closed, and the one exception

A missing record must stop a gated call. The runner must never reread the folder to recover.

The runner may resolve inline only when the permission plan classifies the call as allowed
without a gate. Concretely: `decide()` in `services/runner/src/permission-plan.ts` returns a
`Verdict` of `{kind: "allow"}` for that exact gate descriptor. A `pendingApproval` verdict, an
`ask` verdict, or any verdict the runner cannot compute must fail closed.

This is a narrow and explicit test. It is not a cache miss. The difference matters. A cache miss
is the absence of information. An `allow` verdict is a positive statement by the policy owner.

Three further rules apply to the inline path.

1. The runner must compute the verdict from the permission plan, not from the relay guard's
   pass-through. The relay guard passes `ask` on non-Pi harnesses. That pass is a compatibility
   behavior, not a policy statement. Reading it as one would reopen the hole.
2. The inline path must still mint and consume a record. It mints, verifies, and consumes in one
   step. This keeps one execution path and one set of digests.
3. The inline path must apply the same limits as the gated path. See section 6.

Open product call. Item 4 in `decisions.md` recommends that the runner follows the run's policy
and forces no gate. The gate review recommends the opposite for v1: force a gate, because tool
permission and workspace-read permission are different policies. This contract implements the
narrower behavior the coordinator specified, which allows an ungated path behind an explicit
`allow`. If Mahmoud accepts the reviewer's call, delete section 4's exception and make every
`value_from` operation force a gate. Nothing else in this contract changes.

## 5. Where the frozen bytes live

The frozen value must never travel as ordinary tool arguments.

The reason is concrete. `InteractionRequest.args` in
`services/runner/src/sessions/interactions.ts` is persisted to the API as a durable interaction
row. A skill folder can hold many kilobytes of text. Putting the resolved value into `args`
would write that content into an interaction row on every gated commit. It would also duplicate
content that the commit itself is about to persist. The gate review names this as the
large-payload problem.

So the runner keeps two separate things.

- The **model's arguments** stay exactly as the model wrote them. They still hold
  `value_from: {type, path}`. These arguments go into the approval card's argument view, into
  the stored decision key, and into the durable interaction row. They are small.
- The **frozen value** lives in a per-turn frozen-value store in runner memory. Only the
  authorization record points at it. It is never serialized to the API, never written to the
  relay directory, and never sent to the sandbox.

The store has these rules.

- It is keyed by an opaque handle. The handle is meaningless outside the runner process.
- It holds one entry per authorization record.
- It enforces the aggregate byte budget in section 6.
- It releases an entry when its record is discarded.
- It releases every entry when the turn ends, even if a record leaked.

`ParkedApproval` may hold the handle across a park. It must not hold the bytes inline, for the
same reason: the parked approval is what the runner reports and logs.

## 6. Timeouts, limits, and cleanup

### 6.1 Abort and deadline

Resolution takes an `AbortSignal`. The signal combines the turn's own signal with a hard
resolution deadline. The runner already uses this shape in `callDirect` in
`services/runner/src/tools/direct.ts`.

- Per-source resolution deadline: 30 seconds. A Daytona manifest exec plus reads must finish
  inside it.
- The turn's abort signal cancels resolution at once.
- A cancelled resolution mints no record and releases any partial bytes.

### 6.2 Limits

These limits apply per turn, not per call.

| Limit | Value | Reason |
|---|---|---|
| Sources resolved per call | 8 | Bounds one commit. |
| Sources resolved per turn | 32 | Bounds a loop of commits. |
| Authorization records live per turn | 32 | One per source. |
| Aggregate frozen bytes per turn | 8 MiB | Bounds runner memory. |
| Bytes per source | 2 MiB | Defined in `workspace-import.md`. |

Reaching a limit fails the operation with a structured error. It does not silently truncate.

### 6.3 Record expiry

`expiresAtMs` is the earlier of two values.

- Mint time plus the approval park TTL (`config.approvalTtlMs`).
- Mint time plus 30 minutes.

The second bound exists because the park TTL is configurable and may be set very long. A frozen
snapshot of a folder should not authorize an execution hours later.

### 6.4 Cleanup obligations

The runner must release frozen bytes on every path listed in section 3.4. The turn's `finally`
block is the backstop. It must clear the whole store. A leaked entry is a memory leak on a
long-lived parked session, so the backstop must not be optional.

## 7. Park and cold resume

This is the hardest case. The runner parks a session on an approval gate. The human answers
later. Two things can happen.

### 7.1 Live resume

The pool still holds the environment. `pool.checkoutApproval` succeeds. The runner answers the
gate on the same live session.

The authorization records survive, because the environment survives. The runner carries them on
the parked state beside `ParkedApproval`. The records keep their original `expiresAtMs`. The
runner re-verifies every field at consume time, exactly as section 3.2 says. An expired record
fails closed even on a live resume.

The frozen bytes survive with the records. They count against the turn's byte budget for as long
as the session is parked. This is real memory held across a park. It is bounded by the 8 MiB
aggregate and by the 30-minute expiry.

### 7.2 Cold resume

The runner falls back cold in several cases. Read `services/runner/src/server.ts` around line
856. An approval mismatch, an empty decision set, a resume that throws, or a resume that fails
all lead to `coldAndPark()`. The old environment is destroyed.

Destroying the environment destroys the frozen-value store. The records are gone.

The rule is simple and it must be enforced. **A cold resume must not execute a `value_from`
operation on the strength of the old approval.** The approval named specific bytes. Those bytes
no longer exist in runner memory. The folder on disk may have changed. Re-resolving it and
executing would run content no human ever saw.

So the cold path must do this.

1. The cold turn starts with an empty authorization store.
2. The model replays the conversation and re-issues the tool call, or the approval envelope
   arrives with no matching gate.
3. The runner resolves the `value_from` again, mints a NEW record, and raises a NEW gate.
4. The human sees a new approval card, built from the newly read bytes.

The runner must not treat the incoming `{approved: true}` envelope as an answer to the new gate.
The envelope answers a gate that no longer exists. The runner must surface this clearly, so the
user understands why they are asked twice.

This is honest but it is not free. A user who approves a large skill, then hits a credential
rotation, is asked to approve again. That is the correct trade. The alternative is executing
unapproved bytes.

Open question for the reviewer: should the runner persist the frozen value and its digests
durably, so a cold resume can restore the exact snapshot instead of asking again? This would
remove the second prompt. It would also put skill content into durable storage, which section 5
argues against. This contract chooses to ask again. Record the decision in `decisions.md`.

## 8. Tool-catalog generation

`catalogGeneration` is a new value. It does not exist today.

It is one opaque string per environment. The runner computes it when it builds the tool catalog.
It changes whenever the model-visible catalog changes. `adapter-matrix.md` defines how it is
computed and when it advances.

The authorization record captures it at mint time. The verify step compares it to the live
value. A mismatch fails closed.

The reason is direct. A tool named `commit_revision` under generation N may have a different
schema, a different permission, or a different execution binding under generation N+1. An
approval minted under N does not describe the call that would run under N+1.

## 9. Errors the model sees

Every failure returns a tool result the model can act on. The runner keeps the detail in its own
logs. It gives the model a stable code and a short message.

| Code | When | Retryable |
|---|---|---|
| `authorization_missing` | No record for a gated call. | No. The model must reissue the call. |
| `authorization_consumed` | The record was already used. | No. |
| `authorization_expired` | The record passed `expiresAtMs`. | Yes, after reissuing the call. |
| `authorization_mismatch` | Tool name, arguments, or content digest differ. | No. |
| `catalog_generation_stale` | The catalog changed after the mint. | Yes, after reissuing the call. |
| `source_limit_exceeded` | A turn or call limit was reached. | No. |
| `resolution_timeout` | Resolution passed its deadline. | Yes. |
| `resolution_cancelled` | The turn aborted. | No. |

The import contract owns the `source_*` codes for read failures. See `workspace-import.md`.

## 10. Test obligations

These tests gate the slice. They are a contract, not a suggestion.

**Forged records.**
- A forged relay record for an `ask` tool on a non-Pi harness, with a valid tool-call id and
  substituted arguments, must be refused.
- A forged record for a tool-call id the runner never gated must be refused. It must not
  trigger a folder read.
- A forged record on the Pi path must be refused.

**Single use.**
- The same record consumed twice must fail on the second attempt.
- Two concurrent execute records for one authorization must produce exactly one execution.

**Mutation after approval.**
- Change a file in the folder between the mint and the consume. The execution must use the
  frozen bytes. The committed value must equal the approved value.
- Replace the folder with a symlink that leaves the workspace, between mint and consume. The
  execution must still use the frozen bytes and must not read the new target.

**Timeout, denial, abort.**
- A resolution that exceeds its deadline mints no record and leaks no bytes.
- A denied gate discards the record and releases the bytes.
- An aborted turn releases every record and every byte.

**Expiry.**
- A record consumed after `expiresAtMs` fails closed, on both the live-resume and the ordinary
  path.

**Park and resume.**
- A live approval resume consumes the parked record and commits the approved bytes.
- A cold fallback after an approval mismatch raises a NEW gate. It must not execute the old
  approval, and it must not commit anything.

**Payload placement.**
- The durable interaction row for a gated `value_from` call must hold the model's original
  arguments. It must not hold the resolved value.
- The relay request file must not hold the resolved value.

**Catalog generation.**
- A record minted under generation N, consumed after the catalog advances to N+1, fails closed.

**Limits.**
- Exceeding the per-turn source count or the aggregate byte budget produces a structured error
  and releases every partial allocation.

All of the above must run on both the local relay host and the Daytona relay host. The gate
review is explicit that static inspection does not prove Daytona behavior.

## 11. Documents to update when this contract is accepted

- `spikes/runner-spike.md`, section "Where the resolution step should really live". Replace the
  tool-call-id cache with this contract.
- `decisions.md`, the runner-spike block. Replace the "frozen per tool-call id, with inline
  resolution at execution as the fallback" line.
- `decisions.md`, open product call 4. Record Mahmoud's answer on the forced gate.
- `plan.md`. Split slice 3 into source codec, authorization and freeze integration, and approval
  user interface, as must-fix item 7 requires.
