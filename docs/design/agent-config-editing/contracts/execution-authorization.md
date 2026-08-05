# Contract: execution authorization for workspace file references

Status: proposed. This contract answers must-fix item 4 and answer section 2 of
`research/design-gate-review-codex.md`.

> **Renamed by the 5 August consolidation.** The workspace source is no longer a `value_from`
> object on an operation. It is an inline `{"@ag.file": "<path>"}` marker that may appear in
> ANY string position of an operation's `value`. `change-set.md` sections 6.1 and 6.6 own the
> new shape. Read every remaining `value_from` in this file as "one `@ag.file` marker", with
> one substitution that matters: **a record is keyed per MARKER, not per operation**, because
> one operation can now carry several. Section 3.4 states the record key and the set rules in
> full. The security argument, the lifecycle, the fail-closed rules, and the limits are
> unchanged; only the unit changed. A full rename pass through this file belongs to
> runner-spike, who owns it.

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
| `operationIndex` | integer | The index of the operation inside `delta.operations`. |
| `valuePointer` | string | The JSON Pointer of the `@ag.file` marker inside that operation's `value`, e.g. `/body` or `/files/0/content`. With `operationIndex` it identifies exactly one marker: one record covers one MARKER, not one operation. Section 3.4. |
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

`argsDigest` and `contentDigest` need an EXACT canonical serialization. The runner must build a
new serializer for this. It must not reuse `canonicalJson` from
`services/runner/src/responder.ts`.

#### 2.3.1 Why the existing serializer is unsafe here

`canonicalJson` calls `normalizeJsonish` before it serializes. Read
`services/runner/src/responder.ts` line 124 and the function below it. `normalizeJsonish` parses
any string that looks like a JSON object or array, and replaces the string with the parsed
value. `parseJsonContainer` even tolerates up to three stray trailing closers.

So these two argument sets produce the same digest:

```json
{"value": "{\"x\":1}"}
{"value": {"x": 1}}
```

And so does this third one:

```json
{"value": "{\"x\":1}}}"}
```

An ordered operation's `value` field holds arbitrary JSON. A skill body is a string. A file's
content is a string. Any of them can look like JSON. So an attacker can write an authorized
call whose arguments differ from the executed call, and both digest the same. That defeats the
whole binding. It is the same-identifier argument-substitution hole the record exists to close.

#### 2.3.2 The normalization is correct for its own job

Do not remove `normalizeJsonish` from `ApprovedExecutionGrants`. It exists for a real reason,
recorded in its own comment: a model copying object-valued arguments out of a flattened replay
transcript writes them back as a JSON string. The stored approval and the re-issued gate must
still meet at one key. That is a matching problem, and lenient matching is the right answer for
it.

Authorization is a different problem. It is an exact binding. Lenient matching is the wrong
answer for it.

So the runner keeps two serializers with two jobs. This must be stated in both call sites, or a
later reader will "simplify" them back into one.

| Serializer | Job | Behavior |
|---|---|---|
| `canonicalJson` (existing) | Approval-key matching across a replay | Lenient. Parses JSON-looking strings. |
| `strictCanonicalJson` (new) | Authorization digests | Exact. Never parses a string. |

#### 2.3.3 `strictCanonicalJson`

The new serializer has these rules.

1. **It never inspects the content of a string.** A string serializes as a JSON string literal,
   always. No parsing, no trimming, no trailing-closer tolerance.
2. **It preserves JSON types exactly.** A string stays a string. A number stays a number. A
   boolean stays a boolean. `null` stays `null`. It never coerces between them.
3. **It sorts object keys** by the code-unit order of their UTF-16 representation. This makes the
   output independent of insertion order.
4. **It preserves array order.** An array is ordered data.
5. **It rejects, rather than encodes, every value JSON cannot represent exactly.** This covers
   `undefined`, a function, a symbol, `NaN`, `Infinity`, `-Infinity`, a `BigInt`, and any object
   with a prototype other than `Object.prototype` or `Array.prototype`.
6. **It rejects a cycle.**
7. **It encodes a number by its shortest round-trip form**, which is what `JSON.stringify`
   already produces. `-0` serializes as `0`, matching JSON.
8. **It escapes a string exactly as `JSON.stringify` does**, and it additionally escapes every
   lone surrogate as `\uXXXX`, so an unpaired surrogate cannot make two different strings encode
   to the same bytes.
9. **It does not honour a `toJSON` method.** A `toJSON` hook would let a crafted object choose
   its own digest input.
10. **It reads only own enumerable properties.** It never walks a prototype chain.

The digest is SHA-256 over the UTF-8 encoding of the serializer's output.

#### 2.3.4 Fail closed

Rejection is an error, not a fallback. The runner must not degrade to a weaker key when the
strict serializer refuses a value.

At mint time, a rejection refuses to mint the record. The model sees the error. This is stricter
than `ApprovedExecutionGrants.grant`, which silently does nothing on an unkeyable call. A silent
no-op is acceptable for a matching heuristic. It is not acceptable for an authorization.

At verify time, a rejection fails the verification closed.

#### 2.3.5 Test obligations for the serializer

- The three example argument sets in section 2.3.1 must produce three different digests.
- A JSON-looking string never changes type. `{"a": "[]"}` and `{"a": []}` differ.
- Key order does not change the digest. Array order does.
- `1`, `"1"`, and `true` all differ.
- `undefined`, `NaN`, `Infinity`, a `BigInt`, a `Date`, a `Map`, and a cycle each raise an error.
- A lone surrogate and a valid pair produce different digests.
- An object carrying `toJSON` digests by its own properties, not by the hook's output.
- A property added to `Object.prototype` never enters the digest.

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
6. Store the record, keyed on `toolCallId` plus `operationIndex` plus `valuePointer`.
7. Build the approval card from the manifest.

A resolution failure stops the call before step 3. The model receives the structured error from
the import contract. The runner mints no record.

### 3.2 Verify

The runner verifies before every execution. The check runs inside the relay execution guard, or
immediately after it. It must run for every harness. It must not depend on the harness raising a
dialog.

The check is:

1. Look up the record by `toolCallId`, `operationIndex`, and `valuePointer`.
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

### 3.4 Multi-source commits

**Renamed by the 5 August consolidation.** The source is no longer a `value_from` object on
an operation. It is an inline `{"@ag.file": "<path>"}` marker, and it may appear in ANY
string position of an operation's `value` — so one operation can carry several. See
`change-set.md` sections 6.1 and 6.6.

Nothing in the logic below changes. Only the unit of the set changes:

| Was | Is |
|---|---|
| the set of operations carrying a `value_from` | the set of `@ag.file` markers in the whole commit |
| one record per operation | one record per MARKER |
| record key: `toolCallId` + `operationIndex` | record key: `toolCallId` + `operationIndex` + `valuePointer` |

`valuePointer` is the JSON Pointer of the marker inside that operation's `value`, for
example `/body` or `/files/0/content`. Two markers in one operation are two records, and
the pointer is what keeps them apart. Without it, a set with two markers in one operation
could not be verified member by member, and the "no missing member" check below would pass
with one of the two frozen values substituted.

One commit may carry up to eight markers (section 6.2 limits). Sections 3.1 to 3.3 describe
one record. This section defines how the runner handles a set of them. The rule is that the
set behaves as one unit.

#### 3.4.1 Mint: check the policy before any read

The runner must decide the permission verdict for the whole call BEFORE it reads any file.

The order is fixed:

1. Parse the call. Walk every operation's `value` and collect every `@ag.file` marker.
   Record the operation index and the value pointer of each.
2. Read the permission plan verdict for the call. A `deny` verdict stops here. The runner returns
   the deny reason. **It performs no workspace read at all.**
3. Check the per-call and per-turn limits in section 6.2 against the collected count. A breach
   stops here, again before any read.
4. Resolve the markers in operation order, then in pointer order within an operation. Mint
   one record per marker.

Step 2 matters on its own. A denied call must not touch the filesystem. Reading a file for a
call that will never run leaks the file's existence and its content into runner memory, and it
spends the turn's byte budget. Worse, on Daytona it runs a process inside the sandbox for a call
the policy already refused.

If any marker fails to resolve, the whole mint fails. The runner discards every record it minted
for that call and releases their bytes. It returns the failing operation's index, the failing
value pointer, and its structured error. A commit is one atomic change, so a partially resolvable
commit has no useful meaning.

The records for one call share one `catalogGeneration`, read once at step 4. They share one
expiry, computed once. This stops a set from ageing apart.

#### 3.4.2 Verify: all or nothing

The runner verifies the complete set before it consumes any of it.

1. Determine the required set: every `{operationIndex, valuePointer}` pair in the executed
   call that holds an `@ag.file` marker.
2. Look up a record for each required pair, keyed by `toolCallId` plus that pair.
3. Run every check in section 3.2 against every record.
4. Every record must pass. One failure fails the whole call.

Two extra checks apply to the set, and neither is implied by the per-record checks:

- **No missing member.** Every required pair must have a record. A call carrying three
  markers with only two records fails closed.
- **No extra member.** Every record held for this `toolCallId` must correspond to a required
  pair in the executed call. A record with no matching marker means the executed call is not
  the approved call. This catches an attacker who removes an operation, or removes one marker
  from an operation, in an approved multi-marker commit to change what the commit does.

The `argsDigest` check already covers both cases when it passes, because it binds the whole
argument document. These two checks exist so the runner reports the real reason rather than an
opaque digest mismatch, and so the set logic holds even if the argument shape later changes.

#### 3.4.3 Consume: one atomic step

The runner consumes the complete set in one synchronous step, with no `await` inside it.

```
verifyAll(requiredIndexes)      // no mutation
  -> consumeAll(requiredIndexes) // synchronous, no await
  -> substituteAll(callBody)     // synchronous
  -> execute(callBody)           // the first await
```

`consumeAll` removes every record from the store, in one pass. JavaScript runs it to completion
without interleaving, so no second execute record can consume a member in the middle.

The runner must not verify-and-consume one record, then await a read for the next. Any `await`
between two consumes opens a window where a concurrent forged record consumes the rest of the
set and executes a different commit.

If `consumeAll` finds any record already consumed, it must restore nothing and execute nothing.
It fails the whole call. A partially consumed set is a bug, not a recoverable state, because
verification passed moments earlier under the same synchronous turn.

#### 3.4.4 Substitute: all frozen values, then execute

The runner replaces `value_from` with `value` for every required index, using each record's
frozen value. It does this after the consume, on a copy of the call body.

It executes once, with the fully substituted body. It never executes a partly substituted body,
and it never issues one API call per source.

#### 3.4.5 Failure and cleanup

Any failure in 3.4.2, 3.4.3, or 3.4.4 discards every record for that `toolCallId` and releases
every frozen value. The runner does not leave a surviving member for a retry. A retry must
re-mint the whole set, so the human re-approves the whole commit.

### 3.5 Discard

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

**Decided, 5 August.** `decisions.md` open call 3 is closed: gate by default, with inline
resolution only on an explicit `allow` verdict from the permission plan. That is exactly the
behavior this section already specifies, so nothing here changes and the exception stays.

The alternative the gate review preferred — force a gate on every import, because tool
permission and workspace-read permission are different policies — was not taken. If it is
ever revisited, the change is to delete this section's exception and make every marker force
a gate; nothing else in this contract moves.

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

The runner must release frozen bytes on every path listed in section 3.5. The turn's `finally`
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

**Multi-source commits.**
- A denied permission verdict on a call carrying three sources performs ZERO workspace reads.
  Assert on the reader, not only on the result.
- A commit with three sources mints three records, all sharing one `catalogGeneration` and one
  expiry.
- One source failing to resolve discards the other two records and releases their bytes.
- A call missing one of its three records fails closed, and consumes none of the other two.
- A call carrying a record for an operation index the executed call does not have fails closed.
- Removing one operation from an approved three-operation commit fails closed.
- Two concurrent execute records for the same multi-source call produce exactly one execution.
- The executed API call carries all three substituted values in one request.
- A failure during substitution releases all three frozen values.

**Strict serializer.**
- The three argument sets in section 2.3.1 produce three different digests.
- The full list in section 2.3.5 passes.
- An authorization minted with the strict serializer does not verify against a digest computed
  with `canonicalJson`. This guards against a later refactor merging the two.

All of the above must run on both the local relay host and the Daytona relay host. The gate
review is explicit that static inspection does not prove Daytona behavior.

## 11. Documents to update when this contract is accepted

**All four are done.** Kept as a record of what moved, so a later reader can tell a settled item
from an outstanding one.

- ~~`spikes/runner-spike.md`, section "Where the resolution step should really live". Replace the
  tool-call-id cache with this contract.~~ Done. The section carries a superseded banner: its
  finding (resolve at the gate, freeze, execute the frozen bytes) stands and shipped; its
  mechanism (a `toolCallId` cache with a resolve-inline-on-miss fallback) is marked as the
  problem statement, not the design.
- ~~`decisions.md`, the runner-spike block. Replace the "frozen per tool-call id, with inline
  resolution at execution as the fallback" line.~~ Done, as an amendment that keeps the original
  wording visible and says why both halves were unsafe.
- ~~`decisions.md`, open product call 4. Record Mahmoud's answer on the forced gate. Gate 2 notes
  that calls 4 and 8 are one decision, so merge them.~~ Done. Calls 4 and 8 were merged into
  decision 3 and closed on 5 August: gate by default, inline only on an explicit `allow` verdict.
  Section 4 states the same rule.
- ~~`plan.md`. Split slice 3 into source codec, authorization and freeze integration, and approval
  user interface, as must-fix item 7 requires.~~ Done: S3a (import codec and readers), S3b
  (authorization, wired into the gate), S3c (the approval card).

### 11.1 What implementation changed in this contract's own terms

Two things the implementation settled that this document did not anticipate.

- **`catalogGeneration` did not exist.** Section 8 assumed it. It is now computed per
  `adapter-matrix.md` section 2.4 — a strict canonical digest over the sorted tool document,
  including the execution-plan fields and excluding what rotates.
- **The old text for the section 8.4 diff cannot come from `read_config` alone**, which is
  head-only. The runner requires the read's `base_revision_id` to equal the operation's and fails
  closed otherwise. `workspace-import.md` section 8.4.2.1 owns that rule and the recorded
  fallback.

## 12. Gate 2 resolution

| Gate 2 point | Where it is answered |
|---|---|
| New problem 1: `argsDigest` is not exact; `canonicalJson` parses JSON-looking strings | §2.3.1 states the collision with the three colliding examples. §2.3.2 explains why the lenient serializer stays for approval matching. §2.3.3 specifies `strictCanonicalJson` with ten rules. §2.3.4 makes rejection an error. §2.3.5 and §10 give the tests. |
| New problem 2: multi-source commits lack atomic verify-and-consume | §3.4 is new. §3.4.1 puts the permission verdict before any workspace read. §3.4.2 verifies the complete set with no-missing and no-extra checks. §3.4.3 consumes synchronously with no `await` between members. §3.4.4 substitutes every value and executes once. §3.4.5 defines cleanup. §10 adds thirteen tests. |
| Item 4 status: record, lifecycle, frozen store, expiry, cold resume | Unchanged from gate 1. §2, §3.1 to §3.3, §5, §6, §7. |

Not resolved here, by design:

- Gate 2 product calls 4 and 8 are one decision and remain open. §4 states the two candidate
  behaviors and says which one this contract implements.
- Gate 2 new problem 9 concerns the approval manifest for `set` with `value_from`. It belongs to
  `workspace-import.md` §8 and `change-set.md` §5.1.
- Gate 2 item 7, the slice plan, belongs to `plan.md`.
