# Contract: the change set

Status: proposed. It answers must-fix item 1 of the design gate review.
Owner: engine-spike. Date: 4 August 2026.

This document is the one authoritative change-set contract. Where it disagrees with
`research/change-set-interface-codex.md`, `spikes/engine-spike.md`, or `decisions.md`,
this document wins. Section 12 lists the changes the prototype needs.

## 1. Scope

The change set describes a change to one workflow revision's data tree. It is data only.
It does not say where the base comes from. It does not say what happens after the change.

Three layers use it:

| Layer | Owns |
|---|---|
| The engine (`apply_change_set`) | Applies the change set to a base tree. Pure. No I/O. |
| The commit wrapper | The base check, the transaction, the response. See `commit-transaction.md`. |
| The runner | Turns `value_from` into an inline `value` before the API sees the call. |

The engine never reads a path, never reads a database, and never writes one.

## 2. The commit envelope

The model sends this shape. The catalog binds `workflow_variant_id` from run context and
hides it from the model.

```json
{
  "workflow_revision": {
    "workflow_variant_id": "019c...",
    "base_revision_id": "019c...",
    "message": "Update the release QA instructions.",
    "delta": { }
  }
}
```

- `base_revision_id` is a precondition on the commit. It is not part of the delta.
  It is required when `delta` uses the ordered form. `commit-transaction.md` section 8
  defines how a legacy call gets a default.
- `message` is the persisted commit message.
- The ephemeral per-call `description` is NOT in this envelope. See `read-config.md`
  section 12.

### 2.1 What the catalog advertises

The model-visible schema is `_COMMIT_REVISION_INPUT_SCHEMA` in
`sdks/python/agenta/sdk/agents/platform/op_catalog.py`. It is closed
(`additionalProperties: false`) at every level. It must advertise exactly this set:

| Field | Model-visible | Note |
|---|---|---|
| `workflow_revision.workflow_variant_id` | no | Bound from `$ctx.workflow.variant.id` and stripped. |
| `workflow_revision.base_revision_id` | yes | An ordered delta needs it. The model copies it from the `read_config` response. `read-config.md` section 10.1. |
| `workflow_revision.message` | yes | |
| `workflow_revision.delta` | yes | The `oneOf` of section 3. |
| `value_from.type` | yes | `"workspace"`. On `set`, `add_item`, and `replace_item`. |
| `value_from.path` | yes | Relative to the import root. A folder for the item verbs, one file for `set`. |
| `value_from.on_unsupported` | yes | `"reject"` (default) or `"omit"`. Folder source only. Section 5.1.3. |
| `value_from.on_executable` | yes | `"reject"` (default) or `"import"`. Folder source only. Section 5.1.3. |
| `value_from.persist_executable_capability` | yes | Boolean, default `false`. Folder source only. It needs `on_executable: "import"`. Section 5.1.3. |

The union carries two source schemas, one per shape:

| Operation member | `value_from` | Fields |
|---|---|---|
| `add_item`, `replace_item` | the folder source | `type`, `path`, and the three policy fields |
| `set` | the file source | `type` and `path` only |
| `merge`, `remove`, `edit_text`, `remove_item` | none | the member must not offer the field |

Section 5.1 gives the reason for each row. Section 5.1.1 lists the three conditions a
`set` source must meet, and section 5.1.3 explains why the file source carries no policy
fields.

The three policy fields must appear here, or the model cannot set them and the defaults
become the only reachable behavior. The runner strips the whole `value_from` object during
resolution, so no `value_from` field ever reaches the API.

`allow_executable_files` is no longer a `value_from` field. It is now only the persisted
`SkillTemplate.allow_executable_files`, and an import sets it only through
`persist_executable_capability`. `workspace-import.md` section 5.2 owns the four-layer
split that this follows.

Nothing else is model-visible. `data`, `flags`, `name`, `description`, `tags`, and `meta`
stay off the model surface. `read-config.md` section 11 defines the second gate, the scope
policy, which closes the fields a `delta` could otherwise still reach.

## 3. The delta: two forms, never mixed

```json
{
  "oneOf": [
    { "$ref": "#/$defs/LegacyDelta" },
    { "$ref": "#/$defs/OrderedDelta" }
  ]
}
```

### 3.1 LegacyDelta

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "set":    { "type": "object" },
    "remove": { "type": "array", "items": { "type": "string", "minLength": 1 } }
  },
  "anyOf": [ { "required": ["set"] }, { "required": ["remove"] } ]
}
```

Behavior does not change. `set` deep-merges with the dict-only recursion. Scalars and
lists replace. `remove` deletes dotted paths. A missing remove path stays a silent no-op.
The order is `set`, then `remove`.

### 3.2 OrderedDelta

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["operations"],
  "properties": {
    "operations": {
      "type": "array",
      "minItems": 1,
      "maxItems": 64,
      "items": { "$ref": "#/$defs/Operation" }
    }
  }
}
```

`Operation` is a discriminated union on `operation`. Every member sets
`additionalProperties: false`.

### 3.3 How the engine tells the forms apart

A field counts as present only when its value is not null. A pydantic dump carries
`{"set": null, "remove": null, "operations": null}`, so a key test would classify every
ordered delta as legacy.

- Both forms present: `invalid_delta`.
- No form present: `invalid_delta`.
- An unknown delta field: `invalid_delta`.

## 4. The target grammar

A target is a non-empty array of segments.

```json
{
  "type": "array",
  "minItems": 1,
  "maxItems": 12,
  "items": {
    "oneOf": [
      { "type": "string", "minLength": 1 },
      {
        "type": "object",
        "additionalProperties": false,
        "required": ["field", "key"],
        "properties": {
          "field": { "type": "string", "minLength": 1 },
          "key":   { "type": "string", "minLength": 1 }
        }
      }
    ]
  }
}
```

A string segment addresses an object field. An object segment addresses one named entry
in the list at `field`. Example:

```json
["parameters", "agent", {"field": "skills", "key": "release-qa"}, "body"]
```

### 4.1 Key fields per collection

Only these four collections take a selector segment and item operations.

| Collection | Key |
|---|---|
| `skills` | `name` |
| `mcps` | `name` |
| `files` | `path` |
| `tools` | the canonical tool name, section 4.2 |

Any other list has no key. A selector on it gives `unkeyed_collection`.

### 4.2 The canonical tool name

One function, `item_key("tools", entry, allow_legacy_fallback)`. The SDK and the server
must share one implementation and one golden fixture set.

| Tool `type` | Key |
|---|---|
| `gateway` | `name`. When `name` is absent and `allow_legacy_fallback` is true: `{integration}__{action}`. |
| `reference` | `name`, else `slug`. |
| `platform` | `op`. |
| `code`, `client`, `builtin` | `name`. |
| an `@ag.embed` object | none. The entry is not addressable. |

`allow_legacy_fallback` is true when the engine READS the tree to find an entry. It is
false when the engine DERIVES the key of a value the caller supplies. So an old unnamed
gateway entry stays addressable, and a new one must carry an explicit `name`.

An entry with no derivable key is skipped during a search. It never matches, and it never
collides.

## 5. The seven operations

### 5.1 Value sources

| Operation | `value` | `value_from` | Source shape |
|---|---|---|---|
| `set` | yes | yes, restricted | exactly one file. Section 5.1.1. |
| `merge` | yes | **no** | — |
| `remove` | no | no | — |
| `edit_text` | no | no | — |
| `add_item` | yes | yes | one folder, converted to an item. |
| `replace_item` | yes | yes | one folder, converted to an item. |
| `remove_item` | no | no | — |

The rule follows the approval screen, not the engine. A human approves an import before the
runner reads the bytes. The human must therefore see a readable change, never a byte count
and a path.

`merge` does not take `value_from` at all. A source materializes a whole object. A deep
merge of a whole materialized object into an existing object hides which fields survived.
The result depends on the folder content, and the human who approves the call cannot see
it.

#### 5.1.1 `set` with `value_from`: three conditions, all required

The team lead decided this on 4 August, in answer to gate 2, new problem 9. The oversized
instruction file is the founding use case of this project (#5554), so `set` must have a
path for it.

`set` accepts `value_from` only when all three conditions hold. The runner refuses the
call before it reads any content if any one of them fails.

**Condition 1: the source resolves to exactly one file.** Never a folder. A folder has no
single text to show, and the file-manifest presentation belongs to the item verbs. A source
path that names a directory is `source_invalid`. A source path that matches more than one
file is `source_invalid`.

**Condition 2: the target's last segment is a string-typed field.** The value replaces one
long-text field, not a structure. Four target shapes are allowed:

| Field | Target |
|---|---|
| the instructions | `["parameters","agent","instructions","agents_md"]` |
| a skill body | `[...,{"field":"skills","key":K},"body"]` |
| a skill file's content | `[...,{"field":"skills","key":K},{"field":"files","key":P},"content"]` |
| a code tool's script | `[...,{"field":"tools","key":N},"script"]` |

The field must already exist and must already hold a string. Parent creation
(section 5.3) does not apply to a `set` that carries `value_from`: a missing field is
`target_not_found`, and a non-string field is `target_type_mismatch`. A field that does not
exist yet has no old text, so it has no honest diff. Use `add_item` for a new skill file.

**Condition 3: the approval shows a unified diff of the old text against the new text.**
The card presents a readable change: the target field, the diff, the line counts, and the
digest of the exact bytes that will be committed. It must not present a byte count alone.
`workspace-import.md` section 8 owns the presentation; runner-spike adds the single-text-file
mode there.

Two notes on the diff, for the runner to settle:

- The old side comes from the configuration the runner holds for the current run. That
  configuration can be behind the head. The base check catches the drift and answers 409
  (`commit-transaction.md` section 6), so the human never approves a diff that then commits
  silently against a different base.
- If the runner cannot obtain the old text, it must show the complete new text and say that
  no old text was available. It must never fall back to a byte count.

#### 5.1.2 Folder into `set` stays disallowed

A folder source into a `set` target is refused, and it stays refused. There is no honest
presentation for it. A folder carries many files, and a `set` target is one field. The card
would have to either flatten the folder into one value, which the human cannot review, or
list the files without showing what each one becomes, which is the byte-count-and-path
approval that condition 3 exists to prevent. The item verbs already carry folders, and they
carry them with an item identity the card can name.

A value-bearing operation carries exactly one of `value` and `value_from`. Both is
`invalid_operation`. Neither is `invalid_operation`. A `value_from` on `merge`, `remove`,
`edit_text`, or `remove_item` is `invalid_operation`, and the schema refuses it first.

The engine refuses `value_from` with `source_invalid`. The runner must resolve it first.

#### 5.1.3 Two source schemas, one per source shape

The folder source, on `add_item` and `replace_item`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["type", "path"],
  "properties": {
    "type": { "const": "workspace" },
    "path": { "type": "string", "minLength": 1 },
    "on_unsupported": { "enum": ["reject", "omit"], "default": "reject" },
    "on_executable": { "enum": ["reject", "import"], "default": "reject" },
    "persist_executable_capability": { "type": "boolean", "default": false }
  }
}
```

The file source, on `set`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["type", "path"],
  "properties": {
    "type": { "const": "workspace" },
    "path": { "type": "string", "minLength": 1 }
  }
}
```

The three folder-source policy fields, in one line each:

| Field | Meaning |
|---|---|
| `on_unsupported` | `"reject"` (default) refuses a folder that holds an unsupported file. `"omit"` imports the rest and lists every omission. |
| `on_executable` | `"reject"` (default) refuses a folder that holds an executable file. `"import"` imports the folder and records the observed bits. |
| `persist_executable_capability` | `false` (default) commits `SkillTemplate.allow_executable_files` as false. `true` commits it as true. |

**One constraint binds the last two: `persist_executable_capability: true` needs
`on_executable: "import"`.** The reverse is allowed. A caller may import the bits without
granting the runtime capability, which gives a faithful copy of the folder that still
cannot execute anything. A caller may not grant the runtime capability for bits it never
permitted itself to read. A violation is `invalid_operation`, and the runner refuses it
before any workspace read.

The two fields are separate because they are two grants with two owners and two lifetimes.
`on_executable` is an import grant: the caller and the human approver own it, and it dies
with the operation. `persist_executable_capability` writes a stored capability that lives
for the life of the revision. `workspace-import.md` section 5.2 defines the four-layer
split this follows, and it shows the two as separate lines on the approval card.

The file source carries no policy fields, because none of the three has a meaning for it:

- `on_unsupported` chooses between refusing a folder and omitting some of its files. A
  single-file source has nothing to omit. An unsupported single file always rejects, with
  `source_unsupported_content`.
- `on_executable` grants an import the right to carry executable bits. A `set` writes text
  into an existing string field. It creates no file entry, so it carries no bit.
- `persist_executable_capability` writes `SkillTemplate.allow_executable_files`. A `set`
  never writes a skill template. It writes one long-text field inside an existing one.

The three are import-policy declarations on the folder source. The runner's import
resolver consumes them. `workspace-import.md` section 4.2 defines `on_unsupported` and its
default, section 4.3 defines the `omit` opt-in, and section 5.2 defines `on_executable`,
`persist_executable_capability`, and the constraint between them.

Three points fix their place:

1. **They sit on the source, not on the operation.** One commit can import two folders and
   give each one a different answer. A field on the operation could not do that. With
   `value_from` the runner generates the whole value, so the caller has no `value` object
   to write `persist_executable_capability` into either.
2. **The engine never sees them.** The runner resolves `value_from` and then strips the
   whole `value_from` object. It puts a plain inline `value` in place of it. So these
   fields never reach the API, and the engine surface does not grow. The engine still
   refuses any `value_from` that survives, with `source_invalid`.
3. **The model must be able to write them.** This schema is model-facing. With
   `additionalProperties: false` and no such fields, the defaults would be the only
   reachable behavior. A skill folder with one binary asset, or with one script, would
   then be permanently uncommittable.

This resolves the conflict `workspace-import.md` section 11 raises against this section.

### 5.2 The last target segment

| Operation | Last segment | Addresses |
|---|---|---|
| `set`, `merge`, `remove`, `edit_text` | a string | an object field |
| `add_item` | a string | the list to append to |
| `replace_item`, `remove_item` | a selector | one named entry |

A wrong tail is `invalid_operation`. This keeps one intent per verb. Without it, `set` on
a selector would do the work of `replace_item`.

A selector may appear at any earlier position, for every operation.

### 5.3 `set`

```json
{
  "operation": "set",
  "target": ["parameters", "agent", "llm", "model"],
  "value": "anthropic/claude-opus-4"
}
```

Replaces the target value exactly. `value: null` writes null; it does not remove.

**Parent creation.** `set` creates missing parents, under strict rules:

1. It creates only plain-string segments, and only as `{}`.
2. It never creates through a selector. If any segment on the path is a selector, every
   segment up to and including that selector must already resolve. A missing selector is
   always `item_not_found` or `target_not_found`.
3. It never creates a list, and never creates a list entry.
4. An existing parent that is a scalar, a list, or null is `target_type_mismatch`. The
   engine does not overwrite it with `{}`.
5. Final validation stays mandatory. Parent creation is a convenience, not a licence to
   invent fields. The closed agent template rejects an invented path at validation.
6. Parent creation does not apply when the operation carries `value_from`. That form needs
   an existing string target, so it has an old text to diff. Section 5.1.1.

Example. With `harness: {"kind": "pi_agenta"}` in the base:

- `set ["parameters","agent","harness","extras","system"] = "..."` creates `extras` as
  `{}`, then writes `system`. It succeeds.
- `set ["parameters","agent","nope","x"] = 1` creates `nope` as `{}`, writes `x`, and
  then fails final validation with `final_validation_failed`.
- `set ["uri","deeper"] = 1` fails with `target_type_mismatch`, because `uri` is a string.

### 5.4 `merge`

```json
{
  "operation": "merge",
  "target": ["parameters", "agent", "llm"],
  "value": {"extras": {"verbosity": "low"}}
}
```

Deep-merges an object with today's dict-only recursion. Nested dicts merge. Scalars and
lists replace. The target must exist and must be an object. `merge` never creates
parents. A missing target is `target_not_found`. A non-object target is
`target_type_mismatch`. A non-object `value` is `invalid_operation`.

### 5.5 `remove`

```json
{ "operation": "remove", "target": ["parameters", "agent", "llm", "extras"] }
```

Removes one object field. A missing field is `target_not_found`. This differs from the
legacy `remove`, which stays a silent no-op.

### 5.6 `edit_text`

```json
{
  "operation": "edit_text",
  "target": ["parameters", "agent", "instructions", "agents_md"],
  "match_mode": "exact",
  "edits": [
    {"old_text": "Run the checks manually.", "new_text": "Run the release-qa skill."}
  ]
}
```

```json
{
  "match_mode": { "type": "string", "enum": ["exact"], "default": "exact" },
  "edits": {
    "type": "array", "minItems": 1, "maxItems": 32,
    "items": {
      "type": "object", "additionalProperties": false,
      "required": ["old_text", "new_text"],
      "properties": {
        "old_text": { "type": "string", "minLength": 1, "maxLength": 20000 },
        "new_text": { "type": "string", "maxLength": 50000 }
      }
    }
  }
}
```

`match_mode` is optional. The default is `exact`. Only `exact` is valid today. The engine
dispatches on the value through a table; it must not ignore the field. An unknown mode is
`invalid_operation`, even if the schema also rejects it. A later mode is then additive.

The target must be a string. Anything else is `target_type_mismatch`.

Rules, in order:

1. `old_text` must not be empty. Empty gives `empty_old_text`.
2. Matching is exact on the code points. Nothing is normalized. The engine does not apply
   NFKC or NFC. It does not fold smart quotes, dashes, or special spaces. It does not trim
   trailing whitespace. It does not fold CRLF to LF. It does not strip a BOM.
3. `old_text` must occur exactly one time, counted with overlap. See section 5.6.1.
4. Every anchor matches the string as it was before this operation started.
5. Matches must not overlap. Adjacent matches are legal.
6. The engine applies the matches from the highest index to the lowest.
7. The batch must change the string. No change gives `no_change`. One edit that changes
   nothing is fine, if another edit in the same batch changes something.
8. The batch is atomic. One bad edit leaves the string untouched.

#### 5.6.1 Overlap-aware occurrence counting

`str.count` counts without overlap. It reports one occurrence of `"aa"` in `"aaa"`. Two
start positions exist, so the anchor is ambiguous. The engine must count every start
position:

```text
count = 0
i = 0
while True:
    i = text.find(old_text, i)
    if i < 0: break
    count += 1
    i += 1        # advance by one, not by len(old_text)
```

Two or more positions give `text_not_unique` with `match_count`. Zero gives
`text_not_found`.

#### 5.6.2 Work limits

The scan costs O(n·m). The engine enforces limits before it scans:

| Limit | Value | Error |
|---|---|---|
| target string length | 200 000 code points | `text_too_large` |
| `old_text` length | 20 000 code points | schema, then `invalid_operation` |
| edits per operation | 32 | schema, then `invalid_operation` |
| operations per delta | 64 | schema, then `invalid_delta` |

The string limit matches `SkillFile.content` (`max_length=200_000`).

### 5.7 `add_item`

```json
{
  "operation": "add_item",
  "target": ["parameters", "agent", "skills"],
  "value": {"name": "pdf-tools", "description": "Make PDFs.", "body": "..."}
}
```

Appends one entry. The target must resolve to a list. The field name must be a keyed
collection, or the result is `unkeyed_collection`. The engine derives the key from the
value with `allow_legacy_fallback=false`. No key gives `item_key_undefined`. An existing
entry with that key gives `item_already_exists`.

There is no position field. The new entry goes to the end.

### 5.8 `replace_item`

```json
{
  "operation": "replace_item",
  "target": ["parameters", "agent", {"field": "skills", "key": "release-qa"}],
  "value": {"name": "release-qa", "description": "...", "body": "..."}
}
```

Replaces one existing entry. A missing entry gives `item_not_found`. The key derived from
the value must equal the key in the target. A difference gives `invalid_operation`. A
rename is `remove_item` plus `add_item`.

### 5.9 `remove_item`

```json
{
  "operation": "remove_item",
  "target": ["parameters", "agent", {"field": "tools", "key": "send-slack-message"}]
}
```

Removes one existing entry. A missing entry gives `item_not_found`.

## 6. Application

Operations run in array order. Each operation sees the result of the operations before
it. The first failing operation aborts the whole change set. The engine returns nothing
partial. The caller's base tree never changes: the engine deep-copies it first, and
deep-copies every value it writes.

## 7. What the engine returns

This replaces D33 in `spikes/engine-spike.md` and settles the contradiction the review
found. The engine has a warning channel. The engine does not own the response.

```python
@dataclass(frozen=True)
class ChangeSetResult:
    data: dict            # the new tree
    changed: bool         # False when data equals the base, field for field
    warnings: list[Warning]
```

```python
apply_change_set(base, delta, scope_policy=None, *, validate=None) -> ChangeSetResult
```

`changed` is the engine's own comparison of its input base against its output. It is NOT
the commit's no-change answer. The commit wrapper compares the canonical persisted form,
which is a different and larger comparison. See `commit-transaction.md` section 5.

A `Warning` is structured, never a sentence alone:

```json
{
  "code": "wholesale_list_replace",
  "message": "The delta replaced the whole 'tools' list. Use add_item / remove_item.",
  "target": ["parameters", "agent", "tools"],
  "operation_index": 0
}
```

### 7.1 Warning codes

| Code | When |
|---|---|
| `wholesale_list_replace` | A `set` or a legacy `set` replaced a whole `tools`, `skills`, or `mcps` list. |
| `legacy_duplicate_key` | A collection the change set did not touch holds a duplicate key. |
| `legacy_delta_form` | The delta used the legacy form. |
| `unaddressable_embed` | A touched collection holds an `@ag.embed` entry that no operation can name. |

## 8. Unique names

This answers the review's "existing duplicate names" call. The rule protects new
configurations without making old ones uncommittable.

Definitions:

- A collection is **item-touched** when an `add_item`, `replace_item`, or `remove_item`
  operation names it.
- A collection is **branch-touched** when a `set`, `merge`, `remove`, or a legacy `set`
  writes it or any of its ancestors. A full-data commit branch-touches every collection.

Rules, checked after every operation, in final validation:

1. An item-touched collection must hold no duplicate key. A duplicate is
   `duplicate_item_key`. The agent must repair what it edits.
2. A branch-touched collection must not gain a duplicate. The engine compares the base
   and the result. A key whose duplicate count rises is `duplicate_item_key`. A duplicate
   that already existed and did not grow gives the `legacy_duplicate_key` warning.
3. An untouched collection gives the `legacy_duplicate_key` warning and nothing more.

The engine already refuses to act when it addresses a duplicated key inside an operation.
That check stays. It gives `duplicate_item_key` with `match_count`.

Rule 2 keeps every existing configuration committable. A separate cleanup migration can
repair old duplicates later.

## 9. The scope policy

```python
ScopePolicy = Callable[[Target], Optional[str]]   # a refusal message, or None
```

The engine checks every operation's target before it applies any operation. A refusal is
a policy answer. It must not depend on how far the change set got. The error names the
operation index, and the tree stays untouched.

For the legacy form, the engine builds targets: it walks the `set` tree down to the
policy's prefix depth, and it splits each `remove` path on the dot.

Two policies exist. `read-config.md` section 11 defines both.

- `PARAMETERS_ONLY` for a run override: the target must sit under `parameters`.
- `AGENT_COMMIT_SCOPE` for a platform-tool commit: it also refuses server-owned fields.

A refusal is `out_of_scope`, HTTP 422, not retryable.

## 10. The error model

One failure aborts everything. HTTP 422 for a bad change set. HTTP 409 for a stale base;
see `commit-transaction.md`.

```json
{
  "detail": {
    "code": "change_set_rejected",
    "message": "No revision was committed.",
    "operation_index": 1,
    "operation": "edit_text",
    "target": ["parameters", "agent", {"field": "skills", "key": "release-qa"}, "body"],
    "reason": {
      "code": "text_not_unique",
      "message": "old_text matched 3 times. Include more surrounding text.",
      "match_count": 3
    },
    "retryable": true
  }
}
```

| Reason code | Meaning | Retryable |
|---|---|---|
| `target_not_found` | A segment does not exist. | yes |
| `target_type_mismatch` | A node has the wrong type for the verb. | yes |
| `item_already_exists` | `add_item` found the key. | yes |
| `item_not_found` | `replace_item` / `remove_item` did not find the key. | yes |
| `duplicate_item_key` | Two entries share one key. | yes |
| `text_not_found` | The anchor does not occur. | yes |
| `text_not_unique` | The anchor occurs more than one time. | yes |
| `text_edits_overlap` | Two matches share a character. | yes |
| `text_too_large` | The target string is above the work limit. | no |
| `no_change` | The edits produce identical content. | yes |
| `empty_old_text` | The anchor is empty. | yes |
| `unkeyed_collection` | The list has no key field. | yes |
| `item_key_undefined` | The value has no derivable key. | yes |
| `source_not_found` | The runner could not read the workspace path. | yes |
| `source_invalid` | The source is unusable, or `value_from` reached the engine. | no |
| `source_too_large` | The source is above the byte limit. | no |
| `out_of_scope` | The scope policy refuses the target. | no |
| `invalid_delta` | Both forms, no form, or an unknown delta field. | no |
| `invalid_operation` | A shape error. | no |
| `final_validation_failed` | The finished tree is not a valid configuration. | yes |
| `non_embeddable_reference` | The result embeds a static workflow that may not be embedded. | yes |

`final_validation_failed` carries an `issues` array, so the agent gets every schema
problem at once.

`non_embeddable_reference` is wrapper-owned, not engine-owned. The commit wrapper raises
it from the existing `_reject_non_embeddable_workflow_embeds` check. It shares this
envelope so the agent learns one error vocabulary. `commit-transaction.md` section 4.1
defines when it runs.

## 11. Final validation

The engine takes a `validate` callable. The callable receives the finished tree. It
returns a list of issues, or it raises. Either way the engine raises one error with
`final_validation_failed`.

The commit wrapper supplies the validator. It validates the complete revision data
against the workflow schema, and the agent template against `AgentTemplateSchema`. It also
runs the unique-name rules of section 8.

## 12. Changes the prototype needs

The prototype is `api/oss/src/core/workflows/change_set.py` in worktree
`agent-a2a2adaa5d154d454`. It implements this contract except for the following points.

| # | Change | Where |
|---|---|---|
| 1 | Return `ChangeSetResult`, not a bare dict. Compute `changed`. Collect warnings. | `apply_change_set`, `_finish` |
| 2 | Split `VALUE_BEARING`. `set`, `add_item`, and `replace_item` accept `value_from`; `merge` accepts `value` only. The schema must offer the folder source on the item verbs, the file source on `set`, and nothing on `merge`. | `VALUE_BEARING`, `_operation_value` |
| 2b | `set` must not create parents when it carries `value_from`, and its target must already hold a string. Sections 5.1.1 and 5.3. | `_apply_operation` |
| 2c | The folder source carries three policy fields: `on_unsupported`, `on_executable`, and `persist_executable_capability`. `allow_executable_files` is not one of them. Add the constraint check, `persist_executable_capability: true` needs `on_executable: "import"`, as `invalid_operation`. The runner enforces it before any read; the schema states it. Section 5.1.3. | new pydantic source models |
| 3 | Accept and dispatch `match_mode`. Add a matcher table with one entry, `exact`. | `_apply_operation`, `apply_text_edits` |
| 4 | Count occurrences with overlap. Replace `str.count` and `str.index`. | `apply_text_edits` |
| 5 | Create missing plain-string object parents in `set`, under the five rules of 5.3. | `_apply_operation` |
| 6 | Add the work limits of 5.6.2 and the `text_too_large` code. | `apply_text_edits` |
| 7 | Add the unique-name rules of section 8 and the warning codes of 7.1. | new module functions |
| 8 | Add `AGENT_COMMIT_SCOPE`. | scope policies |
| 9 | Add the `maxItems` limits to the schema, and the pydantic operation models with `extra="forbid"`. | new module |

Everything else in the prototype matches this contract. Its 120 tests stay valid, except
the two that pin non-overlapping counting and the absence of parent creation.

## 13. Open items

1. **`match_mode` on the wire today.** The catalog schema will advertise a one-value enum.
   A model may read that as noise. We accept the cost, because adding a second mode later
   is then not a breaking change.
2. **Rule 1 of section 8.** It asks an agent to repair a duplicate it did not create,
   before it can edit that collection. This is a product call. `decisions.md` open call 2
   covers it.
3. **Full-data commits.** They branch-touch everything, so rule 2 applies to them. The
   playground saves this way. We must measure how many existing configurations would gain
   a warning before we make rule 2 stricter.
4. **The four allowed `set` targets** (section 5.1.1) are the long-text fields we know
   today. A later schema can add another one. The list must live in one place, beside the
   `item_key` table, so the SDK and the server never disagree about it.
5. **Product call 1, storage normalization.** Gate 2 marks it as blocking engine and
   transaction work. It changes exact matching, the stored bytes, and canonical equality.
   Answer it before the engine slice starts.
6. **Product call 2, unique-name enforcement.** Gate 2 marks it as blocking engine
   validation. It decides which legacy configurations stay committable. Section 8 holds
   the recommended rule.

## 14. Gate 2 resolution

Gate 2 marked item 1 RESOLVED. Two later points still touch this file.

| Gate point | Answered in |
|---|---|
| New problem 9. The approval manifest cannot describe `set` plus `value_from` | Section 5.1.1 defines the constrained form the team lead arbitrated on 4 August: `set` takes `value_from` when the source is one file, the target is one of four known long-text fields, and the approval shows a unified diff. Section 5.1.2 records that a folder into `set` stays disallowed, because it has no honest presentation. `workspace-import.md` section 8 gains the single-text-file mode; runner-spike owns that edit. |
| New problem 6. The embed check must survive the transaction | Section 10 adds the `non_embeddable_reference` reason code and marks it wrapper-owned. `commit-transaction.md` section 4.1 owns the behavior. |
| New problem 10. `value_from` conflates import policy with a stored capability | Section 5.1.3 carries the four-layer split the team lead accepted on 4 August. The folder source now holds `on_unsupported`, `on_executable`, and `persist_executable_capability`. The old `allow_executable_files` field is gone from `value_from`; the persisted `SkillTemplate.allow_executable_files` is written only through `persist_executable_capability`. `workspace-import.md` section 5.2 owns the split. |
| Item 1, product calls 1 and 2 can still change the contract | Section 13 items 5 and 6 record both as blocking, with the section each one would change. |

Supporting changes: section 2.1 tables and note, section 5.1 table, sections 5.1.1 to
5.1.3, section 10 reason table, section 12 rows 2, 2b, and 2c, and section 13 item 4.

The founding use case is covered again. US-1 and #5554 are the oversized instruction file.
Section 5.1.1 gives it a path: one workspace file into
`["parameters","agent","instructions","agents_md"]`, approved as a unified diff.
