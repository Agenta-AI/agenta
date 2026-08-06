# Contract: `read_config`, the editable scope, and the call description

Status: proposed. It answers must-fix item 3 of the design gate review.
Owner: engine-spike. Date: 4 August 2026.

Three contracts live here, because they share one surface: the builder tools the
playground gives an agent over its own configuration.

1. `read_config`: how the agent reads its configuration (sections 2 to 10).
2. The editable scope: which fields a commit may never write (section 11).
3. The R12 `description`: the per-call text, and how it differs from the commit message
   (section 12).

## 1. Why the agent needs this

RFC user story US-5. The agent cannot read its own configuration today. It guesses, and
after a save it can report the wrong model (#5186). US-7 needs the same tool: after a 409
the agent must read the new head and retry.

The tool is playground-only, like the other builder tools. A shared agent does not get it.

## 2. The catalog entry

`read_config` is a platform op. The catalog owns everything except the payload.

```python
PlatformOp(
    op="read_config",
    description=_READ_CONFIG_DESCRIPTION,
    method="POST",
    path="/api/workflows/revisions/read-config",
    input_schema=_READ_CONFIG_INPUT_SCHEMA,
    context_bindings={
        "target.workflow_variant_id": "$ctx.workflow.variant.id",
        "target.run_is_draft":        "$ctx.workflow.is_draft",
    },
    read_only=True,
    timeout_ms=15000,
)
```

The first binding gives the self-target guarantee. The model cannot name another variant,
because the field is stripped from the model-visible schema and filled server-side
(`sdks/python/agenta/sdk/agents/platform/op_catalog.py:91`).

### 2.1 Two bindings, because the endpoint cannot compute the draft state

Gate 2, new problem 5, is correct: a variant id alone does not tell the endpoint whether
the run is a draft. The variant is the same on a draft run and on a committed run. The
draft fact lives in the run context, in the runner, and it must be carried in.

One more binding carries it, and it always resolves.

**Gate 3, finding 1, corrected this section.** The gate 2 version also bound
`target.run_revision_id` to `$ctx.workflow.revision.id`. That value does not resolve on a
draft run, and an unresolved binding is a hard failure:
`assembleBody` throws `missing run-context value for direct-call binding '<path>'`
(`services/runner/src/tools/direct.ts:228`), and `applyContextBindings` throws the same way
(`:257`). So the third binding would have made every draft `read_config` call fail, which
is the exact run where the draft answer matters most.

**The fix, chosen from the two options: drop the revision binding.** `read_config` binds
`workflow_variant_id` and `is_draft` only.

**The runner change this needs: none.** That is why this option wins over an
optional-binding marker. No new catalog syntax, no new resolver branch, and no new failure
mode. Section 2.2 records the marker as a later option, for the day a real need appears.

`is_draft` is exactly as available as `workflow_variant_id`, so the new binding adds no new
way to fail:

| Run | `$ctx.workflow.variant.id` | `$ctx.workflow.is_draft` |
|---|---|---|
| pinned to a committed revision | resolves | resolves to `false` |
| a playground draft | resolves | resolves to `true` |
| no workflow identity at all | does not resolve | does not resolve |

The third row already fails today, on the variant binding alone, and `read_config` could
not answer without a variant anyway. `RunContextWorkflow.is_draft` is set unconditionally
whenever the run has any workflow identity, as `revision is None`
(`sdks/python/agenta/sdk/agents/tracing.py:166`), and `False` survives the `exclude_none`
dump. `resolveCtxToken` walks any dotted path against the run-context blob; the unit test
at `services/runner/tests/unit/tool-direct.test.ts:314` asserts the `is_draft` token
resolves.

**What we give up.** The gate 2 draft said the response would carry
`run_revision_is_head`, computed from the bound revision id. That field is removed from
section 4. No requirement asked for it. It was a convenience, and it is not worth a runner
mechanism.

### 2.2 The optional-binding marker, if it is ever needed

A future op may really need a binding that can be absent. Two things must then change
together, and neither is in scope now:

1. The catalog needs a way to mark a binding optional. A separate
   `optional_context_bindings` dict is clearer than a token suffix, because it stays
   readable in the op definition and it cannot be confused with a token value.
2. `assembleBody` and `applyContextBindings` must, for an optional binding only, delete
   the path and continue instead of throwing.

**A defect to fix when that work happens, or sooner.** The `assembleBody` docstring already
claims the behavior the code does not have: "a token that does not resolve is left unset
(the field is simply absent)" (`services/runner/src/tools/direct.ts:208`). The code throws.
A reader who trusts the comment will design another broken binding, exactly as this
contract did. Correct the comment even if nothing else changes.

The op needs a new endpoint. The existing retrieve endpoint returns a whole revision. It
cannot do partial reads, it cannot receive these bindings, and it returns fields the model
must not see.

## 3. The request

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["target"],
  "properties": {
    "target": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "workflow_variant_id": {"type": "string"},
        "run_is_draft": {"type": "boolean"},
        "path": {"$ref": "#/$defs/Target"}
      }
    },
    "max_bytes": {"type": "integer", "minimum": 1024, "maximum": 262144, "default": 65536}
  }
}
```

`path` uses the change-set target grammar without any change: a string segment is an
object field, a `{"list", "key"}` segment is one named list entry. See `change-set.md`
section 4. One grammar for read and write is the point. What the agent reads, it can then
name in an operation.

An absent `path` means the whole readable configuration.

`workflow_variant_id` and `run_is_draft` are server-bound. Section 2.1
explains them. They are stripped from the model-visible schema, so the model never writes
them.

Examples:

| Ask | `path` |
|---|---|
| the whole configuration | absent |
| the model | `["parameters","agent","llm"]` |
| the tool list | `["parameters","agent","tools"]` |
| one skill | `["parameters","agent",{"list":"skills","key":"release-qa"}]` |
| one skill body | `["parameters","agent",{"list":"skills","key":"release-qa"},"body"]` |
| one bundled file | `["parameters","agent",{"list":"skills","key":"release-qa"},{"list":"files","key":"scripts/check.py"},"content"]` |

## 4. The response

```json
{
  "revision": {
    "id": "019c...",
    "version": "17",
    "workflow_variant_id": "019c...",
    "created_at": "2026-08-04T18:22:31Z"
  },
  "base_revision_id": "019c...",
  "is_draft": false,
  "path": ["parameters", "agent", "llm"],
  "value": {"model": "openai/gpt-5", "extras": {"reasoning_effort": "high"}},
  "bytes": 74,
  "warnings": []
}
```

- `revision` says exactly which version answered. This is RFC requirement 3 on the tool.
- `base_revision_id` is the value the agent **must copy** into its next commit. It equals
  `revision.id`. It is a separate field because the agent must not have to guess which id
  the commit wants. Section 10.1 makes this the single rule, on every kind of run.
- `is_draft` comes from the `$ctx.workflow.is_draft` binding of section 2.1. The endpoint
  echoes it; it does not compute it. Section 10 explains what it means for the answer.
- `path` echoes the resolved target, so a truncated model context still knows what it got.
- `value` is the raw value at that path.

## 5. Exact bytes

`value` carries the stored string, byte for byte. The endpoint does not normalize Unicode.
It does not fold line endings. It does not trim whitespace. It does not strip a BOM. It
does not re-indent JSON inside a string.

This is not a style choice. `edit_text` matches exactly (`change-set.md` section 5.6). If
the read cleaned a string, every anchor the agent built from that read would fail against
the stored bytes. Read and write must see the same bytes.

The transport is JSON, so the string travels as a JSON string. JSON string escaping is
lossless for every code point we store.

## 6. Output limits

A read answers fully, or it refuses. It never returns a shortened string.

```text
if len(json_encode(value)) > max_bytes:
    refuse with output_too_large
```

The refusal carries what the agent needs to narrow the read:

```json
{
  "detail": {
    "code": "read_config_rejected",
    "reason": {
      "code": "output_too_large",
      "message": "The value at that path is 184232 bytes; the limit is 65536. Read a narrower path.",
      "bytes": 184232,
      "limit": 65536
    },
    "path": ["parameters", "agent"],
    "children": ["instructions", "llm", "tools", "mcps", "skills", "harness", "runner", "sandbox"],
    "retryable": true
  }
}
```

`children` lists the field names, or the item keys, one level under the refused path. The
agent then reads a smaller piece without guessing. For a list, `children` holds the item
keys, which are exactly the selector keys it may use.

**Why no truncation.** A truncated string is a trap. The agent would build an `edit_text`
anchor from text that ends in the middle of a line, or it would believe a phrase occurs
one time when the hidden tail holds it again. A refusal costs one extra call. A truncated
read costs a wrong commit. The same rule holds for the whole-configuration read: a large
agent must be read in parts.

## 7. Errors

Target resolution reuses the change-set reason codes, so the agent learns one vocabulary.

| Reason code | HTTP | When |
|---|---|---|
| `target_not_found` | 422 | A segment does not exist. |
| `target_type_mismatch` | 422 | A segment walks into a scalar. |
| `item_not_found` | 422 | No entry has that key. |
| `duplicate_item_key` | 422 | Two entries share that key. |
| `unkeyed_collection` | 422 | A selector names a list with no key field. |
| `invalid_operation` | 422 | A malformed segment. |
| `out_of_scope` | 422 | The path names a field the agent may not read. |
| `output_too_large` | 422 | Section 6. |
| `revision_not_found` | 404 | The variant has no revision. |

The envelope matches the commit error envelope, with `code: "read_config_rejected"` and
`path` in place of `operation_index` / `operation` / `target`.

## 8. What the read may return

The read scope and the write scope are not the same. The agent may read more than it may
write, because reading `uri` helps it understand itself, and writing `uri` would break it.

| Field | Read | Write |
|---|---|---|
| `parameters` and everything under it | yes | yes, section 11 |
| `uri` | yes | no |
| `url` | no | no |
| `schemas` | no | no |
| `flags` | yes | no |

`url` and `schemas` are server-derived and large. They tell the model nothing it can act
on. Reading them wastes context. A path into them is `out_of_scope`.

## 9. A read is not a lease

The head can move between the read and the commit. The read takes no lock and creates no
reservation. `base_revision_id` is what makes the pair safe: the commit fails with 409 if
the head moved (`commit-transaction.md` section 6). The tool description must say this in
one line, so the agent learns the loop:

> read → build the operations → commit with `base_revision_id` → on 409, read again.

A read that returns a head which is already stale is not an error. The commit catches it.

## 10. The draft-run caveat

This is the hole the review named, spelled out.

A playground draft lives in the browser and in the runner's memory. No server endpoint can
return it. `is_draft` is true exactly when the run carries workflow identity but no
committed revision reference (`sdks/python/agenta/sdk/agents/tracing.py:166`). On such a
run `$ctx.workflow.revision.id` is absent, and `$ctx.workflow.variant.id` is present.

So on a draft run:

- `read_config` returns the **committed head**, not the configuration that is running.
- The commit also applies to the committed head. So the read and the write still agree.
  The agent's edit lands on a coherent base.
- The agent's own running instructions may differ from what it just read. It must not
  assume that the text it reads is the text it is following.

The response must say this, not only through a flag:

```json
{
  "is_draft": true,
  "warnings": [
    {
      "code": "draft_run",
      "message": "This run executes unsaved playground changes. The values below come from the committed head, revision 17. Your commit will also apply to the committed head."
    }
  ]
}
```

### 10.1 Who fills `base_revision_id`: one rule

Gate 2 found a contradiction between section 4 and this section. Section 4 told the model
to copy the value. This section told the runner to fill it "from the read", and it named
no state for that. The runner keeps no read result, so that rule could not be built.

**The single rule: the model always supplies `base_revision_id` for an ordered delta. It
copies the value from the `read_config` response. The runner never fills it for an ordered
delta.**

The state source is the model's own context. The value travels from the response of one
tool call into the arguments of the next tool call. That is the only place it lives, and
it needs no new runner state.

The runner keeps exactly one defaulting behavior, and only for the legacy form:

| Delta form | Run | Who fills `base_revision_id` |
|---|---|---|
| ordered | any | the model, from the read response. Missing is 422. |
| legacy | committed | the runner, from `$ctx.workflow.revision.id`, only when the model omitted it. |
| legacy | draft | nobody. The context value does not resolve, so no base check runs. |

Three points close the rule:

1. The default never overwrites a model value. It is not a `context_bindings` entry.
   `commit-transaction.md` section 8 explains why: a bound value would pin an agent to its
   stale run revision after a 409, and it could never retry inside the same run.
2. On a draft run an ordered delta is still safe, because the model carries the id it read.
   A legacy draft-run delta keeps today's last-write-wins behavior, and the response
   carries a warning that says so.
3. `read_config` is therefore a hard prerequisite for ordered commits. Gate 1 item 7
   already asks the plan to order the slices that way.

Two consequences we accept for v1:

1. An agent on a draft run can silently overwrite the user's unsaved browser edits, in the
   sense that its commit does not include them. The commit is still correct against the
   head, and the browser draft is untouched.
2. An `edit_text` anchor an agent copies from its own running instructions can fail on a
   draft run, because the head holds different text. The failure is loud
   (`text_not_found`), which is the behavior we want.

### 10.2 The read is head-only, and the approval card depends on that

This endpoint answers for the variant's CURRENT head. It has no revision selector: `target`
carries `workflow_variant_id`, `run_is_draft`, and `path`, and nothing else (section 3).

That matters beyond this contract, because `workspace-import.md` section 8.4.2 requires the
approval card for a field replaced from a file to diff against the text at the operation's own
`base_revision_id` — not against whatever the session happens to be running. Those two facts look
contradictory and are not, because of one check.

**The runner calls this endpoint for the operation's target and requires the response's
`base_revision_id` to equal the one the operation carries.** Equal means the head IS the base, so
the projected text is exactly the old side the commit replaces. Unequal fails the operation closed
with `source_base_unavailable`; it never diffs against the wrong side. `workspace-import.md`
section 8.4.2.1 carries the full argument, including why re-implementing this projection on the
runner was rejected and what the additive fallback would be.

The consequence for THIS contract is small but real: a caller cannot use `read_config` to read a
revision that is no longer the head, and the card inherits that limit. It costs nothing a commit
would not already cost, since `base_revision_id` is a precondition and a stale base answers 409
either way.

## 11. The editable scope for commits

R7 says server-owned fields stay outside the model's control. The prototype's commit
policy is `allow_all`. That is the gap.

The model-facing catalog already narrows the envelope: `_COMMIT_REVISION_INPUT_SCHEMA`
exposes `workflow_variant_id`, `message`, and `delta` only
(`sdks/python/agenta/sdk/agents/platform/op_catalog.py`). The model cannot send `data`,
`flags`, `name`, `description`, `tags`, or `meta`. So the hole is inside the delta: a
`set` on `uri`, `schemas`, or `flags` passes today.

### 11.1 The policy

`AGENT_COMMIT_SCOPE` is a scope policy in the sense of `change-set.md` section 9. It runs
for every commit that arrives through the `commit_revision` platform tool. It does not run
for a human or an SDK caller on the normal API.

The policy is an allow-list, not a deny-list. It names what the agent may write. Everything
else is refused with `out_of_scope`.

| Target prefix | Rule |
|---|---|
| `parameters.agent` | allowed, minus the refused subtrees below |
| every other `parameters` subtree | refused in v1. Section 11.1.1. |
| every other root | refused |

Inside `parameters.agent`, five subtrees are refused:

| Path | Why |
|---|---|
| `harness.kind` | It is an identity and rebuild boundary. Section 11.1.1. |
| `harness.permissions` | The allow / ask / deny rules that gate the agent's own tools. |
| `runner.permissions` | The runner-enforced execution policy. |
| `sandbox.kind` | The sandbox provider is a security and cost boundary. |
| `sandbox.permissions` | The security boundary the agent runs inside. |

An agent that could widen its own permission lists could grant itself any tool. An agent
that could switch its sandbox could leave the boundary a human chose. Both are privilege
escalation, and both are silent.

**A write to an ancestor of a refused path is a write to that path.** Naming
`parameters.agent.harness` and sending `{"kind": "codex"}` changes the same stored field as
naming `parameters.agent.harness.kind`, so the rule is stated on the result and not on the
target: whatever an operation would leave at a refused path must equal what is stored there
now. An omission counts as a write for `set`, which replaces its target wholesale, and for
`remove`, which deletes it; it does not count for `merge`, which leaves absent keys alone.
The alternative, refusing every write to the three selector objects, was rejected because
`harness.extras` and `runner.kind` are not refused and sit beside keys that are: it would
have cost real capability to close the hole, and this rule costs none.

#### 11.1.1 Two v1 defaults, both fail-closed

Gate 2 says product calls 10 and 11 leave the security scope unfinished, and that the
contract allows more than the recommendation. Both calls stay open for Mahmoud. Until he
answers, the contract takes the fail-closed side:

| Call | v1 default | Reason |
|---|---|---|
| 10. `harness.kind` | **not writable** | It selects the coding agent, and it forces a full rebuild. A wrong self-directed switch can leave an agent that cannot run, and only a human can undo it. |
| 11. `parameters` outside `agent` | **not writable** | A workflow revision can hold other subtrees, such as `prompt`. A builder agent has no reason to write them in v1. |

The direction of the default matters, and it is not symmetric. Widening an allow-list
later is additive: no stored configuration breaks, and no caller has to change. Narrowing
it later is a breaking change: a playbook that worked stops working, and the failure looks
like a bug to the user. So the safe default is the narrow one, in both cases.

An answer from Mahmoud replaces either row. It does not change any other part of this
contract.

### 11.2 Where it runs

The policy is a parameter of `apply_change_set`, and the ROUTE decides which policy is
passed. There are two commit routes over the same handler flow:

| Route | Caller | Policy |
|---|---|---|
| `POST /api/workflows/revisions/commit/agent` | the `commit_revision` platform tool | `AGENT_COMMIT_SCOPE` |
| `POST /api/workflows/revisions/commit` | a human or SDK caller | none |
| (not built) a run override, RFC Q6 | out of scope for v1 | `PARAMETERS_ONLY` |

The scoped route is the enforcement point, and the separation is what makes the
confinement unforgeable. The agent never chooses the URL: the path comes from the
server-side op catalog (`op_catalog.py`), the runner makes the call from OUTSIDE the
sandbox, and the sandbox holds no credential. So an agent cannot reach the unscoped route,
and there is no request field it could set or omit to widen its own scope. A signal carried
in the request instead, such as a header the runner adds, would fail OPEN whenever it went
missing; a route cannot go missing.

**The unscoped route stays unscoped, by design.** A human editing in the playground and an
SDK caller own the whole revision, including `harness` and `sandbox`. Narrowing that route
would break every non-agent writer, and it protects nothing: those callers hold real
credentials and are already authorized for `EDIT_WORKFLOWS`.

The scoped route also refuses a full-data commit (422, `full_data_not_committable`): a whole
configuration carries every field the scope exists to protect, so the shape is refused
rather than filtered. The agent's tool only ever sends a delta.

The refusal is 422 with `out_of_scope`, and it is not retryable
(`change-set.md` section 10). Both delta arms are scoped: the ordered arm checks every
operation's target, and the legacy arm walks the `set` tree deep enough to reach the
refused sub-paths, which are deeper than the allowed prefix. The refusal names the path it
refused, and its `next_step` names the subtree the agent may write.

### 11.3 A note on defence in depth

The catalog schema is the first gate. The scope policy is the second. Final validation is
the third: `AgentTemplateSchema` is closed, so an invented field fails even if both gates
missed it. Keep all three. The catalog can be widened by mistake in one line.

## 12. R12: the per-call description

R12 asks for an optional agent-written description on every builder tool call, shown in
the frontend with the call and its result.

### 12.1 A name collision to avoid

`RevisionCommit` already has a persisted `description` field, beside `name` and `message`
(`api/oss/src/dbs/postgres/git/dao.py:1596`). It is a revision field. It is stored, and it
appears in the history.

The R12 text is not that. It is a per-call note about what the agent is doing and why. Two
different things must not share one field name on one object.

### 12.2 The contract

| Field | Where | Persisted | Purpose |
|---|---|---|---|
| `description` | the tool-call envelope, beside `workflow_revision` | **no** | The agent explains this call to the human watching. |
| `message` | inside `workflow_revision` | yes | The commit message on the revision. |
| `RevisionCommit.description` | server-side only | yes | An existing revision field. The model never sets it. |

```json
{
  "description": "Adding the pdf-tools skill you asked for, and pointing the instructions at it.",
  "workflow_revision": {
    "message": "Add the pdf-tools skill.",
    "base_revision_id": "019c...",
    "delta": { "operations": [ ] }
  }
}
```

Rules:

1. `description` is optional on every builder tool: `commit_revision`, `read_config`,
   `test_run`, and any later one. It is a catalog-level field, so it is defined once.
2. It is ephemeral. The runner reads it, attaches it to the tool-call record the frontend
   renders, and **removes it before it builds the HTTP request**. The API never receives
   it. No endpoint schema changes.
3. It is free text, maximum 500 characters. Longer is truncated for display, and the
   truncation is visible.
4. It is never a substitute for `message`. `message` describes the change in the history.
   `description` describes the call in the conversation. A commit may set one, both, or
   neither.
5. On an approval card, `description` is shown as the agent's stated intent. It is model
   text. The card must never present it as a fact about what the call does. The card
   shows the real diff beside it.

### 12.3 Why the runner strips it

Two reasons. First, no API schema has to change, so the field costs nothing on the server.
Second, an ephemeral note must not become part of the audit trail by accident. If we later
want to persist it, we do that on purpose, with a decision.

## 13. Open items

1. **Product call 10, `harness.kind` writability.** The v1 default is now "not writable"
   (section 11.1.1). Mahmoud can widen it. Widening is additive.
2. **Product call 11, `parameters` beyond `agent`.** The v1 default is now "not writable"
   (section 11.1.1). Mahmoud can widen it. Widening is additive.
3. **Product call 12, storing the authored operations for audit.** The RFC promises to
   store the diff with the commit. This contract does not do it. It needs its own
   decision, because it adds a column or a meta field.
4. **`max_bytes` default.** 65536 is a guess. Measure a real agent configuration before we
   fix it.
5. **Draft reads, later.** Section 10 accepts that a draft run reads the head. RFC Q3
   Option C (the runner answers from memory) stays parked. If users find the caveat
   confusing, that option comes back.
6. **A stale running configuration.** An agent on a committed run can be running revision
   N while the head is N+1. This contract no longer reports that, because the field that
   reported it needed the removed binding (section 2.1). The commit still fails safely
   with 409. If agents need the earlier warning, add it to the endpoint from the head read
   plus the run's own revision, carried some other way.

## 14. Gate 2 resolution

Gate 2 marked item 3 PARTIAL. New problem 5 restates the first point.

| Gate point | Answered in |
|---|---|
| The catalog binds only `workflow_variant_id`, so no draft flag reaches the endpoint | Section 2.1. One more server-bound context binding, `$ctx.workflow.is_draft`. It resolves through today's `resolveCtxToken`; the unit test at `services/runner/tests/unit/tool-direct.test.ts:314` proves it. |
| The draft claim must be implemented or dropped | Implemented. Section 2.1 carries the flag in, section 4 echoes it, and section 10 states what it means. The endpoint never computes it. |
| §4 and §10 contradict each other about `base_revision_id` | Section 10.1. One rule: the model always copies it from the read response for an ordered delta. The state source is the model's own context, carried call to call. The runner defaults it only for a legacy delta on a committed run. |
| Calls 10 and 11 leave the security scope unfinished | Section 11.1.1. Both take the fail-closed default in v1, with the reason that widening an allow-list later is additive and narrowing it is a breaking change. Section 13 keeps both open for Mahmoud. |

`commit-transaction.md` section 8 now points at section 10.1, so the two contracts state
one rule.

## 15. Gate 3 resolution

Gate 3 marked item 3 PARTIAL and new problem 5 UNRESOLVED. Both name one defect.

| Gate point | Answered in |
|---|---|
| Finding 1. The `target.run_revision_id` binding makes every draft call fail, because `direct.ts:228` treats an absent binding as a hard failure | Section 2.1. The binding is removed. `read_config` binds `workflow_variant_id` and `is_draft` only. The chosen option needs **no runner change**, which is why it beats an optional-binding marker. |
| The cited test proves only that `is_draft` resolves, not that optional bindings work | Section 2.1 no longer claims optional bindings work. It claims only what the test proves, and it adds the table showing that `is_draft` fails in exactly the cases where `workflow_variant_id` already fails. |
| New problem 5. Draft `is_draft` | Resolved. The draft call now dispatches, because no binding on the op can be absent. |

Supporting changes: section 3 drops `run_revision_id` from the request, section 4 drops
`run_revision_is_head` from the response, and section 13 item 6 records what that costs.

Section 2.2 records the optional-binding marker as a later option, and it reports a defect
found while checking this: the `assembleBody` docstring at
`services/runner/src/tools/direct.ts:208` describes an absent binding as "left unset",
while the code throws. The comment misled this contract once already. Fix it.
