# Security — what collapsing 13 ops behind one tool name breaks

**Verified 2026-07-26** against the runner on `main`. This is the risk register for the
**discovery meta-toolset** (Slice 3). It does **not** apply to the schema diet (Slices 1–2), which
changes no name, no spec, and no gate.

Earlier drafts covered this in one bullet ("the invoker builds the gate from the target op's
spec"). That understates it by an order of magnitude, and it also puts the work in the wrong
place. The gates do **not** run inside the invoker's dispatch — they run *upstream of and
independently from* the relay execution path, on both harnesses.

## Root cause: `toolName` is the discriminator for every permission decision

Today each op arrives under its own name, and that name does two jobs: it **resolves the private
spec** the gate reads its fields from, and it is **itself matched** by policy rules. The decision
ladder (`effectivePermission`, `services/runner/src/permission-plan.ts:125`) consumes both:

```text
gate.specPermission   (from resolved spec)  -> short-circuits the rest when set
gate.serverPermission (MCP server)          -> n/a for platform ops
matchingRulePermission(gate, rules)         -> matches on gate.toolName itself
defaultPermission(mode, gate)               -> allow_reads: gate.readOnlyHint ? allow : ask
```

**The regression is not disclosure itself — it is building the gate from the invoker's spec instead
of re-resolving the target.** Get that right at every site and each input above keeps working;
`gate.toolName` restored to the target name even keeps existing op-name rules matching. Get it wrong
at any one site and that site silently evaluates thirteen ops against one spec.

The sections below are therefore **failure modes to design against**, not inevitable outcomes. They
are listed because each has a distinct fix and a distinct test, and because the fix has to land in
four places (see "The four sites").

### 1. `readOnlyHint` — the `allow_reads` default (the core failure mode)

`defaultPermission` (`permission-plan.ts:248`) is the whole policy for the default `allow_reads`
mode:

```ts
if (mode === "allow_reads") return gate.readOnlyHint === true ? "allow" : "ask";
```

`readOnlyHint` comes from `spec.readOnly`, which the catalog sets per op
(`op_catalog.py`: `query_spans` read-only, `commit_revision`/`remove_schedule` not). The invoker
is **one spec with one `readOnly` value covering thirteen ops**, so:

- `readOnly: true` → **every write executes silently.** `commit_revision`, `remove_schedule`,
  `remove_subscription` lose their approval prompt. This is the security regression.
- `readOnly: false` → **every read prompts.** `list_schedules` and `query_spans` now interrupt the
  user. Habituated click-through is a worse outcome than not prompting at all.

There is no correct static value. The gate must resolve `readOnly` from the *target* op per call.

### 2. `specPermission` — same collapse, higher priority

`spec.permission` short-circuits the whole ladder (`permission-plan.ts:129`). One invoker spec
means one permission for thirteen ops, and it wins over any rule.

### 3. Policy rules stop matching — silent fall-through (not previously documented)

`ruleMatches` (`permission-plan.ts:214`) compares the pattern against `gate.toolName` **exactly**,
or parses a `tool(prefix:*)` form that still requires `prefixPattern.toolName === gate.toolName`.

This one is unique in the list: it keys on the **name itself**, not on the resolved spec. Any
operator- or config-authored rule written against an op name — `commit_revision: ask`,
`remove_schedule: deny` — **stops matching** if the call reaches the ladder still named `agenta_op`.
It does not error; it falls through to the default, so a `deny` rule silently becomes whatever
`allow_reads` decides.

**Fix:** set `gate.toolName` to the *target* op's name (not the invoker's) before `decide()` runs.
Then existing rules keep matching unchanged and no operator has to rewrite a policy. That
substitution has to happen at all four sites, which is exactly why the shared resolver below
returns a `gateName` rather than leaving each site to name the gate itself.

### 4. Grant / stored-decision keys — safe, but must stay consistent

Both the turn's grant ledger (`ApprovedExecutionGrants`, `responder.ts:85`) and the replayed
approval store (`ConversationDecisions.take`, `responder.ts:255`) key on
`approvedCallKey(toolName, args)` — **name plus a canonical hash of the arguments**, not name
alone.

Because the invoker's args contain the target op (`{op: "remove_schedule", args: {…}}`), distinct
ops produce distinct keys. **An approval for one op does not unlock another.** Granularity is
preserved for free.

> Correction to an earlier review note: there is no cross-op approval-leak here. The args are part
> of the key.

The residual requirement is **consistency**: `grant()` and `consume()` must key on the same name
(both the target's, or both the invoker's). Mismatch fails *closed* — every Pi write is refused
with "was not approved via the permission dialog" — which is a functional break, not a security
one, but it will look like a mysterious bug.

## The four sites that must each resolve the target

Each independently resolves a spec from a name and builds its own `GateDescriptor`. All four need
the same "if this is the invoker, re-resolve from `args.op`" logic. **Missing one does not fail
closed — it uses the invoker's permission, which is the fail-open direction if the invoker is
marked read-only.**

| # | Site | Path | How it resolves today |
| --- | --- | --- | --- |
| 1 | `buildRelayExecutionGuard` | `engines/sandbox_agent/relay-guard.ts:53` | reads `spec.name` / `spec.permission` / `spec.readOnly` from the spec the relay looked up by `req.toolName` |
| 2 | `buildGateDescriptor` | `engines/sandbox_agent/acp-interactions.ts:516` | Claude/ACP dialog; `toolSpecsByName.get(bareToolName(displayName))` |
| 3 | `buildPiGateDescriptor` | `engines/sandbox_agent/acp-interactions.ts:456` | Pi dialog; **fails closed on an unknown name** (`:473`) — the invoker must be present in `piToolSpecsByName` |
| 4 | `piDialogAllows` call | `extensions/agenta.ts:318` | in-sandbox; passes `spec.name` and raw `params` up the gate envelope |

Site 4 has an extra wrinkle: the in-sandbox extension only ever sees the **advertised** set
(`AGENTA_TOOL_PUBLIC_SPECS`). Under disclosure it no longer holds the target's `readOnly` or
`permission`, so it cannot decide `gateViaDialog` locally and must forward raw args for the runner
to classify. That is arguably *better* (the trust decision moves fully runner-side), but it is a
real behavior change on a path whose current design assumes the sandbox knows the tool it called.

## Required: one shared resolver, not four implementations

Four copies of a security-sensitive lookup, where a missed copy fails **open**, is the wrong shape.
The mitigation is structural, and it is a hard requirement of the design rather than an
implementation detail.

Define exactly one runner-side primitive and have all four sites consume it:

```ts
resolveDisclosedTarget(toolName, args, specsByName)
  -> { spec, gateName, args } | undefined
```

- Returns `undefined` when `toolName` is not the invoker, so every non-disclosed call keeps its
  current path byte-for-byte.
- Validates `args.op` against the **same fixed spec map** the gates already trust, returning
  `undefined` for unknown or malformed values — so an unresolvable target fails closed everywhere,
  by construction rather than by four separate `if` statements.
- Returns `gateName` = the **target op's** name, so the caller's `GateDescriptor` carries it into
  `ruleMatches` and existing op-name policy rules keep matching (failure mode 3).
- Returns the **unwrapped** inner args, so `assertRequiredArguments` and the grant/decision keys all
  operate on the same canonical value at every site (failure mode 4's consistency requirement).

With this in place, "resolve the target" becomes one reviewable function with one test suite, and
the four sites reduce to a two-line call each. Without it, the review surface is four hand-written
lookups in code paths that are individually hard to exercise.

## What is *not* a new risk

> Correction to an earlier review note: routing the decision through a sandbox-supplied `args.op`
> field is **not** a new trust exposure.

The tool **name** is already sandbox-supplied today — the Pi gate envelope is written from inside
the sandbox, and `acp-interactions.ts:307` says so explicitly ("The envelope is sandbox-origin and
untrusted"). It is safe because the name is validated against a fixed map of known specs and fails
closed otherwise (`:473`). Reading `args.op` and validating it against the same map is the
identical pattern at the identical trust level.

The real cost is **surface area**, not trust level: the validated-lookup pattern now has to be
duplicated correctly in four places instead of living in one.

## Non-permission risks

- **Loss of pre-call argument validation.** Pi registers each tool with its real JSON Schema
  (`registerTool({parameters: specInputSchema(spec)})`, `extensions/agenta.ts:305`) and
  `assertRequiredArguments` checks required fields (`:318`, and again in the relay at
  `tools/relay.ts:369`). A generic invoker makes `args` an opaque blob, so both checks degrade to
  the invoker's loose schema. Malformed op calls stop being caught before dispatch and surface as
  server 4xx instead. Mitigated by having the invoker re-run `assertRequiredArguments` against the
  **target** spec before execution — cheap, and it should be an explicit requirement.
- **Fetched schemas become history-resident.** A schema moved out of the prompt into a tool result
  does not disappear — it sits in the conversation transcript for the rest of the session, in a
  position far less cache-friendly than a stable tool-definition prefix. For a real build session
  (as opposed to a "hi" turn), disclosure **without** the diet can cost more than today. This is a
  strong argument for the diet landing first regardless.

## Required test coverage before this ships

Non-negotiable, per mutating op (`commit_revision`, `create_schedule`, `create_subscription`,
`remove_schedule`, `remove_subscription`, `annotate_trace`, `test_run`):

1. `agenta_op` execute-mode produces the **same verdict** as calling the op directly, on **both**
   harness paths — not just the relay guard.
2. Under `allow_reads`, read-only ops execute without a prompt and writes still prompt.
3. A policy rule written against an **op name** still matches through the invoker.
4. An approval granted for one op does **not** satisfy a later call to a different op.
5. `$ctx` bindings still fill server-side and the model cannot retarget another variant — on
   **both** execution branches: `assembleBody`/`call.context` for endpoint-mode ops, and
   `applyContextBindings` for handler-mode `test_run`. A test that only covers `commit_revision`
   misses half the mechanism.
6. Describe-mode has no side effect, triggers no approval, and cannot execute.
7. An unknown or malformed `op` value fails **closed** on all four sites.
8. `test_run` (the only handler-mode op) is disclosed *and* executable through the invoker —
   guarding against the direct-`call`-only eligibility and dispatch bugs that the first draft had.
9. `resolveDisclosedTarget` is unit-tested directly against the failure modes above, so the four
   call sites only need a thin integration assertion each.

## Recommendation

The permission rework is the dominant cost and risk of this project, and it buys ~14% of the token
bill (see [baseline.md](baseline.md)). **Land the schema diet first and independently** — it
touches none of this. Only open the meta-toolset once the diet is measured, prompt caching is
understood, and there is a demonstrated reliability problem that fewer visible tools actually
fixes.
