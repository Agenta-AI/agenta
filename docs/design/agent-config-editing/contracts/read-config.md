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
    context_bindings={"target.workflow_variant_id": "$ctx.workflow.variant.id"},
    read_only=True,
    timeout_ms=15000,
)
```

The binding gives the self-target guarantee. The model cannot name another variant,
because the field is stripped from the model-visible schema and filled server-side
(`sdks/python/agenta/sdk/agents/platform/op_catalog.py:91`).

The op needs a new endpoint. The existing retrieve endpoint returns a whole revision. It
cannot do partial reads, it cannot answer the draft question, and it returns fields the
model must not see.

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
        "path": {"$ref": "#/$defs/Target"}
      }
    },
    "max_bytes": {"type": "integer", "minimum": 1024, "maximum": 262144, "default": 65536}
  }
}
```

`path` uses the change-set target grammar without any change: a string segment is an
object field, a `{"field", "key"}` segment is one named list entry. See `change-set.md`
section 4. One grammar for read and write is the point. What the agent reads, it can then
name in an operation.

An absent `path` means the whole readable configuration.

Examples:

| Ask | `path` |
|---|---|
| the whole configuration | absent |
| the model | `["parameters","agent","llm"]` |
| the tool list | `["parameters","agent","tools"]` |
| one skill | `["parameters","agent",{"field":"skills","key":"release-qa"}]` |
| one skill body | `["parameters","agent",{"field":"skills","key":"release-qa"},"body"]` |
| one bundled file | `["parameters","agent",{"field":"skills","key":"release-qa"},{"field":"files","key":"scripts/check.py"},"content"]` |

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
- `base_revision_id` is the value the agent must copy into its next commit. It equals
  `revision.id`. It is a separate field because the agent must not have to guess which id
  the commit wants.
- `is_draft` says whether the run targets a committed revision or an unsaved playground
  draft. Section 10 explains what it means for the answer.
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

The runner must fill `base_revision_id` for a draft-run commit from the read, not from
`$ctx.workflow.revision.id`, because that context value is absent
(`commit-transaction.md` section 8).

Two consequences we accept for v1:

1. An agent on a draft run can silently overwrite the user's unsaved browser edits, in the
   sense that its commit does not include them. The commit is still correct against the
   head, and the browser draft is untouched.
2. An `edit_text` anchor an agent copies from its own running instructions can fail on a
   draft run, because the head holds different text. The failure is loud
   (`text_not_found`), which is the behavior we want.

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

| Target root | Rule |
|---|---|
| `parameters` | allowed |
| everything else | refused, `out_of_scope` |

Inside `parameters`, four subtrees are refused:

| Path | Why |
|---|---|
| `parameters.agent.sandbox.kind` | The sandbox provider is a security and cost boundary. |
| `parameters.agent.sandbox.permissions` | The security boundary the agent runs inside. |
| `parameters.agent.harness.permissions` | The allow / ask / deny rules that gate its own tools. |
| `parameters.agent.runner.permissions` | The runner-enforced execution policy. |

An agent that could widen its own permission lists could grant itself any tool. An agent
that could switch its sandbox could leave the boundary a human chose. Both are privilege
escalation, and both are silent.

`parameters.agent.harness.kind` stays writable. Changing the harness costs a rebuild, and
it is a normal authoring choice, not a security boundary. This is a product call; section
13 lists it.

### 11.2 Where it runs

The policy is a parameter of `apply_change_set`. The commit wrapper picks it from the
caller:

| Caller | Policy |
|---|---|
| the `commit_revision` platform tool | `AGENT_COMMIT_SCOPE` |
| a run override (RFC Q6, out of scope for v1) | `PARAMETERS_ONLY` |
| a human or SDK caller on the API | none |

The refusal is 422 with `out_of_scope`, and it is not retryable
(`change-set.md` section 10).

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

1. **`harness.kind` writability** (section 11.1). It is currently writable. Is a
   self-directed harness switch acceptable? A wrong choice can make an agent unable to
   run, and only a human can undo it.
2. **`parameters` beyond `agent`.** A workflow revision can hold other `parameters`
   subtrees, such as `prompt`. Should a builder agent be able to write them? The current
   policy allows it.
3. **Storing the authored operations for audit.** The RFC promises to store the diff with
   the commit. This contract does not do it. The review lists it as missing. It needs its
   own decision, because it adds a column or a meta field.
4. **`max_bytes` default.** 65536 is a guess. Measure a real agent configuration before we
   fix it.
5. **Draft reads, later.** Section 10 accepts that a draft run reads the head. RFC Q3
   Option C (the runner answers from memory) stays parked. If users find the caveat
   confusing, that option comes back.
