## Verdict

Reject the proposed shape.

Keep `delta` for compatibility, but make the new form an ordered `operations` list. Do not ship independent `edit`, `items`, and `from_files` arrays. They create implicit ordering, mix different semantic roles, and force special nested patch formats.

Also reject:

- `upsert`: it conceals whether the model intended creation or replacement.
- `patch`: it is too vague once patches can include merges, text edits, and nested item changes.
- Selector syntax such as `skills[name=release-qa]`: it creates a new escaping grammar that JSON Schema cannot meaningfully validate.

The current implementation applies `set` and then `remove` against the latest fetched revision [service.py](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:1984), with lists replacing wholesale in `_deep_merge` [service.py](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:2409). The model documentation confirms how dangerous that is [agenta_builtins.py](/home/mahmoud/code/agenta-2/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:249).

## Field placement by semantic role

| Field | Role | Owner | Placement |
|---|---|---|---|
| `workflow_variant_id` | Routing | Runner/platform | Revision envelope, hidden from model |
| `base_revision_id` | Protocol precondition | Caller building the change; runner may default legacy calls | Revision envelope beside `delta` |
| `message` | Commit metadata | Model/caller | Revision envelope |
| `delta` | Change data | Model/caller | Revision envelope |
| `value_from` | Content-source declaration | Model | Inside the operation whose value it supplies |
| Materialized source content | Input data | Runner | Internal resolved operation, never model-authored |

`base_revision_id` and workspace source resolution do not belong inside the delta merely because they support a commit.

## Concrete counter-proposal

Model-visible payload:

```json
{
  "workflow_revision": {
    "base_revision_id": "019c...",
    "message": "Update release QA instructions and add the PDF skill.",
    "delta": {
      "operations": [
        {
          "operation": "edit_text",
          "target": [
            "parameters",
            "agent",
            "instructions",
            "agents_md"
          ],
          "edits": [
            {
              "old_text": "Run the release checks manually.",
              "new_text": "Run the release checks with the release-qa skill."
            }
          ]
        },
        {
          "operation": "edit_text",
          "target": [
            "parameters",
            "agent",
            {
              "field": "skills",
              "key": "release-qa"
            },
            "body"
          ],
          "edits": [
            {
              "old_text": "Check the API.",
              "new_text": "Check the API and the runner."
            }
          ]
        },
        {
          "operation": "remove_item",
          "target": [
            "parameters",
            "agent",
            {
              "field": "tools",
              "key": "send-slack-message"
            }
          ]
        },
        {
          "operation": "add_item",
          "target": [
            "parameters",
            "agent",
            "skills"
          ],
          "value_from": {
            "type": "workspace",
            "path": "downloaded-skills/pdf-tools"
          }
        }
      ]
    }
  }
}
```

A nested skill file is addressed without inventing a string grammar:

```json
{
  "operation": "edit_text",
  "target": [
    "parameters",
    "agent",
    {
      "field": "skills",
      "key": "release-qa"
    },
    {
      "field": "files",
      "key": "scripts/check.py"
    },
    "content"
  ],
  "edits": [
    {
      "old_text": "timeout = 30",
      "new_text": "timeout = 60"
    }
  ]
}
```

The strict schema should be conceptually:

```text
Delta = LegacyDelta | OrderedDelta

LegacyDelta = {
  set?: object,
  remove?: string[]
}
At least one field required.

OrderedDelta = {
  operations: Operation[1..]
}

Operation =
  SetOperation
  | MergeOperation
  | RemoveOperation
  | EditTextOperation
  | AddItemOperation
  | ReplaceItemOperation
  | RemoveItemOperation
```

Every object gets `additionalProperties: false`. The two delta forms are mutually exclusive.

Operation meanings:

| Operation | Meaning |
|---|---|
| `set` | Replace the target value exactly |
| `merge` | Deep-merge an object using today’s dict-only recursion |
| `remove` | Remove an object field; missing target is an error |
| `edit_text` | Apply anchored edits to one string |
| `add_item` | Add a new named item; collision is an error |
| `replace_item` | Replace an existing named item; absence is an error |
| `remove_item` | Remove an existing named item; absence is an error |

`set`, `add_item`, and `replace_item` accept exactly one of `value` or `value_from`.

Operations run sequentially. A target is evaluated against the result of previous operations. Within one `edit_text`, every anchor is matched against that operation’s starting string.

## Direct answers

### 1. Overall shape

Use an ordered operation list, but do not copy JSON Patch literally.

JSON Patch’s numeric array indices are inappropriate for named configuration objects, and JSON Pointer does not solve stable list identity. A discriminated operation union gives the model clearer verbs and gives the server an exact failing operation index.

Keep it inside `delta.operations` because `delta` is already the public concept. Do not introduce `change_set` and `delta` concurrently.

Do not permit this:

```json
{
  "set": {},
  "remove": [],
  "operations": []
}
```

Legacy and ordered forms should be a schema `oneOf`. This eliminates cross-form ordering questions. New operations execute in array order, then the server validates the complete result and commits once.

The current catalog already manually defines a closed schema and strips bound fields [op_catalog.py](/home/mahmoud/code/agenta-2/sdks/python/agenta/sdk/agents/platform/op_catalog.py:703). A strict discriminated union fits that mechanism.

### 2. Addressing

Do not extend dotted paths with bracket selectors.

`skills[name=release-qa]` looks simple until names contain quoting characters, file paths contain brackets, or selectors need escaping. JSON Schema would only see an opaque string.

Use structured target segments:

```json
[
  "parameters",
  "agent",
  {
    "field": "skills",
    "key": "release-qa"
  },
  "body"
]
```

A selector segment has exactly:

```json
{
  "field": "skills",
  "key": "release-qa"
}
```

The resolver knows the key field by collection:

- `skills`: `name`
- `mcps`: `name`
- `files`: `path`
- `tools`: canonical effective tool name

The tool identity problem is not limited to gateway tools:

- Gateway `name` is optional [models.py](/home/mahmoud/code/agenta-2/sdks/python/agenta/sdk/agents/tools/models.py:89).
- Reference tools use `name or slug` [models.py](/home/mahmoud/code/agenta-2/sdks/python/agenta/sdk/agents/tools/models.py:190).
- Platform tools use `op` [models.py](/home/mahmoud/code/agenta-2/sdks/python/agenta/sdk/agents/tools/models.py:212).
- The current gateway fallback is adapter-derived `integration__action` [resolver.py](/home/mahmoud/code/agenta-2/sdks/python/agenta/sdk/agents/tools/resolver.py:100).

Define one canonical `item_key` function in the SDK and server. For new or replacement gateway entries, I would require an explicit `name`. Continue reading legacy unnamed gateways through the fallback, but do not base the new mutation contract on an adapter-dependent derived name.

Opaque `@ag.embed` entries are another unresolved identity case. Either exclude them from name-addressed operations or define a stable raw reference key. Resolving their current name is not stable if the referenced object later changes.

### 3. Anchored edits

Keep the intended Pi contract, not the implementation wholesale:

- Exact substring matching.
- `old_text` must be non-empty.
- Exactly one occurrence.
- No regex.
- All entries matched against the same pre-operation string.
- Overlapping matches rejected.
- No-change replacements rejected.
- Atomic batch.

Use `old_text` and `new_text`. The API, SDK schema, and persisted configuration use snake case. Pi’s camelCase is a TypeScript-local convention, while `old_string` is no clearer than `old_text`.

One important correction: the local Pi implementation is not actually exact. Its schema advertises exact replacement [edit.js](/home/mahmoud/code/agenta/services/runner/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js:11), but it falls back to NFKC, whitespace, quote, dash, and space normalization [edit-diff.js](/home/mahmoud/code/agenta/services/runner/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit-diff.js:134). It also normalizes line endings and strips BOMs before matching [edit.js](/home/mahmoud/code/agenta/services/runner/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js:201).

Do not do that for JSON strings. It can modify bytes outside the intended replacement and make an anchor succeed against content the caller did not actually specify. If normalized matching is ever wanted, expose it later as an explicit `match_mode`, with `exact` as the default.

### 4. Path references

Make a workspace reference a value source inside a value-bearing operation:

```json
{
  "operation": "add_item",
  "target": ["parameters", "agent", "skills"],
  "value_from": {
    "type": "workspace",
    "path": "downloaded-skills/pdf-tools"
  }
}
```

Do not make it a top-level delta kind or a separate tool. Both alternatives disconnect the source from the intended mutation and make atomic add-or-replace behavior harder.

Use explicit intent:

- `add_item`: fail if the derived skill name exists.
- `replace_item`: fail if it does not exist.
- Never `upsert`.
- For replacement, require the parsed source name to equal the selected key. Renaming is an explicit remove plus add.

Responsibility split:

1. The runner confines the path to the workspace, rejects traversal and symlink escapes, reads each byte once, and converts the directory to a structured skill.
2. The canonical skill validator validates the result again server-side. `SkillTemplate` already defines name, body, file limits, and safe paths [models.py](/home/mahmoud/code/agenta-2/sdks/python/agenta/sdk/agents/skills/models.py:49).
3. The commit service checks collisions and validates the final complete agent config.

Approval needs new runner behavior. Today context-bound values are filled at execution after model arguments [direct.ts](/home/mahmoud/code/agenta-2/services/runner/src/tools/direct.ts:220), while the approval card deliberately sees redacted model arguments [acp-interactions.ts](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/acp-interactions.ts:579). That mechanism is insufficient.

The runner must materialize and freeze workspace content before approval. The approval UI should show:

- Add versus replace intent.
- Resolved item name.
- Body or script diff.
- File manifest, sizes, and digests.
- Total byte count.
- Any executable-file flags.

Execution must use the frozen bytes approved by the human, not reread the directory afterward.

`value_from` should be a runner-authoring extension. The runner replaces it with canonical inline `value` before calling the API. The normal invoke API should not pretend it can resolve paths inside an unrelated runner workspace.

### 5. Base check

Use `workflow_revision.base_revision_id`, beside `message` and `delta`.

Do not place it inside `delta`: it is a precondition on the commit, not a mutation.

Do not unconditionally hide it behind the existing context binding. The current binding mechanism overwrites model values. After a conflict, the agent would remain bound to its stale run revision and could never retry successfully in the same run. Keep it model-visible so the agent can reread and rebase.

For old calls that omit it, the runner may default it from `$ctx.workflow.revision.id` only when absent. That is defaulting, not ownership binding, and should be implemented separately from `context_bindings`.

Return HTTP 409 with both IDs:

```json
{
  "detail": {
    "code": "revision_conflict",
    "message": "The workflow head changed. No revision was committed.",
    "base_revision_id": "019c-old",
    "current_revision_id": "019c-new",
    "current_revision_version": "17",
    "retryable": true
  }
}
```

Yes, return the current head. It lets the agent retrieve the exact revision directly. Do not return the full configuration in the conflict response because that recreates the payload-size problem.

The comparison must be atomic with insertion. Today `_resolve_revision_delta` fetches the head before the DAO starts its commit transaction [service.py](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:2000), while the DAO opens a separate transaction later [dao.py](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1606). A comparison added only to `_resolve_revision_delta` still races. Compare the current head and insert the new revision in one database transaction.

### 6. Error model

One failed operation must fail the whole commit.

A revision is one coherent configuration, operations can depend on earlier operations, and a partial commit would make retries much harder. If preview or per-operation diagnostics are needed, add a non-persisting validation endpoint. Do not return partial mutation success from the commit endpoint.

Use HTTP 422 for semantically invalid change sets and HTTP 409 for stale bases. Return a stable machine code, operation index, target, and corrective context:

```json
{
  "detail": {
    "code": "change_set_rejected",
    "message": "No revision was committed.",
    "operation_index": 1,
    "operation": "edit_text",
    "target": [
      "parameters",
      "agent",
      {
        "field": "skills",
        "key": "release-qa"
      },
      "body"
    ],
    "reason": {
      "code": "text_not_unique",
      "message": "old_text matched 3 times. Include more surrounding text.",
      "match_count": 3
    },
    "retryable": true
  }
}
```

Useful reason codes include:

- `target_not_found`
- `target_type_mismatch`
- `item_already_exists`
- `item_not_found`
- `duplicate_item_key`
- `text_not_found`
- `text_not_unique`
- `text_edits_overlap`
- `no_change`
- `source_not_found`
- `source_invalid`
- `source_too_large`
- `final_validation_failed`

Return all final-schema issues when validation naturally produces several. During sequential application, stop at the first failing operation.

### 7. Compatibility

Keep `delta.set` and `delta.remove` exactly as they behave today:

- `set` remains a recursive dictionary merge.
- Scalars and lists still replace.
- `remove` remains a dotted-path list.
- Legacy application order remains `set`, then `remove`.
- Do not reinterpret old payloads.

But:

- Do not allow legacy fields and `operations` in the same delta.
- Mark whole-list `set` on `tools`, `skills`, and `mcps` as legacy in model guidance.
- Return a warning when an old call replaces one of those lists wholesale.
- Preserve legacy missing-remove no-op behavior, but make new `remove` and `remove_item` strict.
- Keep the name `delta`. Renaming it now gains nothing.

There is an unavoidable compatibility issue with a mandatory base. Existing playbooks omit it. To preserve them, require `base_revision_id` for ordered operations and let the runner default it for legacy tool calls when the run context has a committed revision. Warn on unguarded direct legacy API calls and sunset them separately.

Also make the API Pydantic operation models `extra="forbid"`. The model-facing catalog is closed today [op_catalog.py](/home/mahmoud/code/agenta-2/sdks/python/agenta/sdk/agents/platform/op_catalog.py:721), but the current `WorkflowRevisionDelta` DTO itself does not forbid unknown keys [dtos.py](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/dtos.py:301).

### 8. Reuse on invoke

Use the same canonical change-set type and application engine, with different wrappers and policies.

Commit wrapper:

- Variant routing.
- `base_revision_id` must equal head.
- Persists one revision.
- Carries commit message.
- Full atomic transaction.

Invoke override wrapper:

- Existing revision reference selects revision X.
- No head comparison is needed because revisions are immutable.
- Scope policy permits only `parameters`.
- Never persists.
- No commit message.
- Returns the resolved revision ID used for the run.

The workspace `value_from` form is not part of the canonical shared type. It is a runner-side authoring extension that becomes an inline `value` before either commit or invoke processing.

Build a pure function shaped roughly like:

```text
apply_change_set(base_data, delta, scope_policy) -> resolved_data
```

Both commit and run override should call it. Do not reuse `_resolve_revision_delta` as-is because it fetches the latest revision itself. `handle_test_run` currently resolves a request revision and then calls that method, causing the base to be fetched again [platform_handlers.py](/home/mahmoud/code/agenta-2/api/oss/src/core/tools/platform_handlers.py:207). The caller should resolve the base exactly once and pass its data to the shared application engine.

The invoke scope guard must inspect every structured target, including nested selectors. The current guard only examines top-level `set` keys and dotted `remove` strings [platform_handlers.py](/home/mahmoud/code/agenta-2/api/oss/src/core/tools/platform_handlers.py:177), so it must be rewritten before ordered operations can safely reach invoke.

In short: one canonical atomic operation engine, two wrappers, two policy profiles, and one runner-only source-materialization layer.


