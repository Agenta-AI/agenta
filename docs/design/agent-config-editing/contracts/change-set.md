# Contract: the change set

Status: **consolidated to the decided state, 5 August 2026.** It supersedes every earlier
version of this file, `research/change-set-interface-codex.md`, and the matching parts of
`spikes/engine-spike.md`. Section 19 records what changed and why.
Owner: engine-spike.

Where this document disagrees with any other document, this one wins.

## 1. Scope and layers

The change set describes a change to one workflow revision's data tree. It is data only.
It does not say where the base comes from, and it does not say what happens after.

| Layer | Owns | Refuses |
|---|---|---|
| The runner | Resolves every `@ag.file` marker into an inline string before the API sees the call. | A path outside the workspace; a missing or unreadable file. |
| The wrapper | The base check, the scope policy, the derived message, the transaction, the response. | Out-of-scope targets; platform-kind tool entries; a stale base. |
| The engine (`apply_change_set`) | Applies the change set to a base tree. Pure. No I/O. | Everything in section 12 that is not wrapper-owned; any surviving `@ag.file`. |

The engine never reads a path, never reads a database, and never writes one.

## 2. The commit envelope

The model sends this shape. The catalog binds `workflow_variant_id` from run context and
hides it from the model.

```json
{
  "workflow_revision": {
    "workflow_variant_id": "019c...",
    "base_revision_id": "019c...",
    "delta": { }
  },
  "description": "Adding the pdf-tools skill you asked for."
}
```

- `base_revision_id` is a precondition on the commit, not a mutation. An ordered delta
  requires it. The model copies it from the `read_config` response
  (`read-config.md` section 10.1).
- **There is no `message` field.** The server derives the commit message from the
  operations. Section 14.
- `description` is the ephemeral per-call note (R12). It rides the tool-call envelope, not
  the revision, and the runner strips it before it builds the request
  (`read-config.md` section 12).

### 2.1 What the catalog advertises

`_COMMIT_REVISION_INPUT_SCHEMA` in
`sdks/python/agenta/sdk/agents/platform/op_catalog.py` is closed
(`additionalProperties: false`) at every level. It advertises exactly this:

| Field | Model-visible | Note |
|---|---|---|
| `workflow_revision.workflow_variant_id` | no | Bound from `$ctx.workflow.variant.id` and stripped. |
| `workflow_revision.base_revision_id` | yes | Copied from the read. |
| `workflow_revision.delta` | yes | The `oneOf` of section 3. |
| `description` | yes | Ephemeral, stripped by the runner before dispatch. |

Nothing else is model-visible. `message`, `data`, `flags`, `name`, `tags`, and `meta` are
all off the model surface.

**Why `message` left.** It was optional, and the model volunteered one anyway and still
corrupted it. Free text was the site of every argument-corruption failure the usability
spike measured. A derived message is also more accurate than a written one, which serves
issues #5187 and #5200 better than the model's own words.

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
lists replace. `remove` deletes dotted paths, and a missing path stays a silent no-op. The
order is `set`, then `remove`.

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
        "required": ["list", "key"],
        "properties": {
          "list": { "type": "string", "minLength": 1 },
          "key":  { "type": "string", "minLength": 1 }
        }
      }
    ]
  }
}
```

A string segment names an object field. An object segment names one entry of a list, and
**it stands in place of that list's name**:

```json
["parameters", "agent", {"list": "skills", "key": "release-qa"}, "body"]
```

**The selector key is `list`, not `field`.** The usability spike measured the selector as
the cause of 62 percent of all failures, and every one of those was about which list the
segment replaces. `list` says it. No model in the measurement ever misused `list`, and the
key-field mistake disappeared.

### 4.1 Keyed lists

Only these four lists take a selector and item operations.

| List | Key |
|---|---|
| `skills` | `name` |
| `mcps` | `name` |
| `files` | `path` |
| `tools` | the canonical tool name, section 4.2 |

Any other list has no key. A selector on it gives `unkeyed_collection`.

### 4.2 The canonical tool name

One function, `item_key("tools", entry, allow_legacy_fallback)`, shared by the SDK and the
server with one golden fixture set.

| Tool `type` | Key |
|---|---|
| `gateway` | `name`. Absent and reading: the legacy `{integration}__{action}`. |
| `reference` | `name`, else `slug`. |
| `platform` | `op`. |
| `code`, `client`, `builtin` | `name`. |
| an `@ag.embed` object | none. Not addressable. |

`allow_legacy_fallback` is true when the engine READS the tree to find an entry, and false
when it DERIVES the key of a value the caller supplies. So an old unnamed gateway entry
stays addressable, and a new one must carry an explicit `name`.

An entry with no derivable key never matches and never collides.

### 4.3 The wrapper forgives two selector mistakes

Both are unambiguous, so a refusal would teach nothing. The wrapper normalizes the target
before the engine sees it, and it adds a warning so the correction is visible.

| Mistake | Example | Normalized to |
|---|---|---|
| The list name repeated before the selector | `["...","skills",{"list":"skills","key":"x"}]` | `["...",{"list":"skills","key":"x"}]` |
| The key field in the `list` slot | `["...",{"list":"name","key":"x"}]` inside a known list position | the enclosing list's name |

The first absorbed 12 percent of one model's targets once the teaching left the tool
description. The second vanished when `field` became `list`, and the normalization stays as
a belt.

Normalization is the wrapper's job, not the engine's. The engine takes a clean target, so
its behavior stays exactly describable. Warning code: `target_normalized`.

## 5. The seven operations

### 5.1 Values

| Operation | Needs | May contain `@ag.file` |
|---|---|---|
| `set` | `value` | yes, anywhere a string may go |
| `merge` | `value` (an object) | yes |
| `remove` | — | — |
| `edit_text` | `edits` | no. Section 6.4 |
| `add_item` | `value` | yes |
| `replace_item` | `value` | yes |
| `remove_item` | — | — |

There is no `value_from`, and there is no source object on the operation. Section 6
explains the marker that replaced it and why.

A value-bearing operation must carry `value`. A missing value is `missing_operation_value`.

### 5.2 The last target segment

| Operation | Last segment | Addresses |
|---|---|---|
| `set`, `merge`, `remove`, `edit_text` | a string | an object field |
| `add_item` | a string | the list to append to |
| `replace_item`, `remove_item` | a selector | one named entry |

A wrong tail is `invalid_target_shape`, which is retryable and carries the correct shape in
its next step. A selector may appear at any earlier position, for every operation.

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
2. It never creates through a selector. Every selector on the path must already resolve.
3. It never creates a list, and never creates a list entry.
4. An existing parent that is a scalar, a list, or null is `target_type_mismatch`.
5. Final validation stays mandatory. The closed agent template rejects an invented path.

### 5.4 `merge`

```json
{
  "operation": "merge",
  "target": ["parameters", "agent", "llm"],
  "value": {"extras": {"verbosity": "low"}}
}
```

Deep-merges an object with the dict-only recursion. Nested dicts merge; scalars and lists
replace. The target must exist and must be an object. `merge` never creates parents.

### 5.5 `remove`

```json
{ "operation": "remove", "target": ["parameters", "agent", "llm", "extras"] }
```

Removes one object field. A missing field is `target_not_found`. The legacy `remove` stays
a silent no-op; this one does not.

### 5.6 `edit_text`

```json
{
  "operation": "edit_text",
  "target": ["parameters", "agent", "instructions", "agents_md"],
  "match_mode": "auto",
  "edits": [
    {"old_text": "Run the checks manually.", "new_text": "Run the release-qa skill."}
  ]
}
```

```json
{
  "match_mode": { "type": "string", "enum": ["auto", "exact"], "default": "auto" },
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

The target must be a string. Anything else is `target_type_mismatch`.

Rules, in order:

1. `old_text` must not be empty. Empty is `empty_old_text`.
2. Each anchor is matched by the tolerance its target's content class allows. Section 5.6.1.
3. Each anchor must occur exactly once, counted **with overlap**. Section 5.6.2.
4. Every anchor matches the string as it was before this operation started.
5. Matches must not overlap. Adjacent matches are legal.
6. The engine applies matches from the highest index to the lowest.
7. The batch must change the string. No change is `no_change`. One edit that changes
   nothing is fine if another edit in the same batch changes something.
8. The batch is atomic. One bad edit leaves the string untouched.

#### 5.6.1 Match tolerance by content class

Stored bytes are never normalized (decision 1, option A). The tolerance lives in matching
only, and it depends on what the text is.

| Content class | Fields | Tolerance |
|---|---|---|
| **Prose** | `instructions.agents_md`, a skill `body`, any `description` | exact first; on no exact match, one normalized retry |
| **Code and data** | a skill file's `content`, a code tool's `script` | exact only |

Prose is written by humans and by models, and a smart quote that arrived through a
different editor should not block an edit. A script's bytes are its meaning: a normalized
match there could rewrite a string literal or a shell quote into something that no longer
runs.

The normalized retry:

- It folds smart quotes to ASCII quotes, Unicode dashes to the ASCII hyphen, and Unicode
  spaces to the ASCII space.
- The normalized match must still be **unique**, counted with overlap. Two normalized
  matches are `text_not_unique`, exactly as two exact matches would be.
- The write is still byte-exact. The engine replaces the matched span of the ORIGINAL
  string. It never writes normalized bytes back, and it never touches a byte outside the
  span.
- The response reports it: warning code `text_matched_normalized`, naming the operation
  index and the edit index. The human and the agent both learn that the anchor was not
  literal.

**Every normalization is one code point to one code point.** This is a deliberate
constraint, and it is what makes "byte-exact write" true. A length-changing normalization
(trailing-whitespace trim, run collapsing, CRLF folding) would put the match at an offset
that does not exist in the original string, and recovering the original offsets needs the
line-overlay machinery whose corruption risk is the reason this design rejected Pi's
approach. So:

- Not folded: trailing whitespace, repeated spaces, CRLF against LF, Unicode NFC against
  NFD. Section 18 records the two of these that may deserve a later answer.

`match_mode` selects the policy: `auto` (the default) applies the table above; `exact`
forces exact matching on every class. The engine dispatches on the value through a table
and never ignores the field. An unknown mode is `unknown_operation`.

#### 5.6.2 Overlap-aware occurrence counting

`str.count` counts without overlap and reports one occurrence of `"aa"` in `"aaa"`. Two
start positions exist, so the anchor is ambiguous. The engine counts every start position:

```text
count = 0; i = 0
while (i = text.find(old_text, i)) >= 0:
    count += 1
    i += 1        # advance by one, not by len(old_text)
```

Two or more is `text_not_unique` with `match_count`. Zero is `text_not_found`.

#### 5.6.3 Work limits

| Limit | Value | Error |
|---|---|---|
| target string length | 200 000 code points | `text_too_large` |
| `old_text` length | 20 000 code points | schema, then `invalid_operation_shape` |
| edits per operation | 32 | schema |
| operations per delta | 64 | schema |

The string limit matches `SkillFile.content` (`max_length=200_000`).

### 5.7 `add_item`

```json
{
  "operation": "add_item",
  "target": ["parameters", "agent", "skills"],
  "value": {
    "name": "pdf-tools",
    "description": "Make PDFs.",
    "body": {"@ag.file": ".agenta-imports/pdf-tools/SKILL.md"}
  }
}
```

Appends one entry. The target must resolve to a list, and the list must be keyed
(section 4.1) or the result is `unkeyed_collection`. The engine derives the key from the
value with `allow_legacy_fallback=false`; no key is `item_key_undefined`. An existing entry
with that key is `item_already_exists`.

There is no position field. The new entry goes to the end.

### 5.8 `replace_item`

```json
{
  "operation": "replace_item",
  "target": ["parameters", "agent", {"list": "skills", "key": "release-qa"}],
  "value": {"name": "release-qa", "description": "...", "body": "..."}
}
```

Replaces one existing entry. A missing entry is `item_not_found`. The key derived from the
value must equal the key in the target; a difference is `item_rename_not_allowed`, which is
retryable and whose next step is "send `remove_item` then `add_item`".

### 5.9 `remove_item`

```json
{
  "operation": "remove_item",
  "target": ["parameters", "agent", {"list": "tools", "key": "send-slack-message"}]
}
```

Removes one existing entry. A missing entry is `item_not_found`.

## 6. The `@ag.file` marker

### 6.1 The shape

```json
{"@ag.file": "<path>"}
```

It replaces **any string** inside an operation's `value`. The runner reads the file and
puts its text there, before the API sees the call.

```json
{
  "operation": "add_item",
  "target": ["parameters", "agent", "skills"],
  "value": {
    "name": "pdf-tools",
    "description": "Make PDFs.",
    "body": {"@ag.file": ".agenta-imports/pdf-tools/SKILL.md"},
    "files": [
      {
        "path": "scripts/extract.py",
        "content": {"@ag.file": ".agenta-imports/pdf-tools/scripts/extract.py"},
        "executable": true
      }
    ]
  }
}
```

`@ag.file` joins `@ag.embed` as one marker family: same shape, different lifetime. An embed
persists in the configuration and re-resolves on every read. A file marker is consumed at
commit and never persists — the committed revision holds the text.

### 6.2 What it replaced, and why

The earlier design put a `value_from` source object on the operation, which resolved a
whole FOLDER through a codec into a skill, and carried import-policy fields.

The usability spike measured both. The operation-level source produced the only
silent-corruption failure mode in the whole study. The marker went 91 for 91 across both
models. So:

- **There is no folder source and no folder-to-skill codec in v1.** The agent authors the
  skill structure itself and references each file's content per field. It already knows the
  structure; it does not need a codec to infer it.
- **There are no policy fields.** `on_unsupported`, `on_executable`, and
  `persist_executable_capability` are all gone. Each marker is one file. An unsupported file
  fails its own marker with a clear reason, and the all-or-nothing commit guarantees that
  nothing partial ever lands, so there is nothing for an "omit" mode to buy.
- **`executable` is an ordinary agent-authored field**, on the skill file entry, exactly
  like `path` and `content`. So is the skill's `allow_executable_files`. The approval card
  must display both. They are configuration the human reads, not a policy grammar the model
  must learn.

### 6.3 Paths

The import root is **`.agenta-imports/`** under the run's working directory. A dot-folder
stays out of shell listings by default, and the Files drawer already hides the `.agenta-*`
prefix, so a non-technical user never sees a confusing system folder.

A path may be written two ways, and the runner normalizes both:

| Form | Example |
|---|---|
| relative to the workspace root | `.agenta-imports/pdf-tools/SKILL.md` |
| absolute inside the workspace | `/workspace/.agenta-imports/pdf-tools/SKILL.md` |

Only a path that resolves outside the workspace is refused. Agents write absolute paths
naturally; refusing them fights the model for nothing, and the runner knows its own root on
each platform.

The runner still confines every resolved path, refuses symbolic links, and reads each file
once. `workspace-import.md` owns the confinement mechanics.

### 6.4 Where the marker may not appear

- **Not in `edit_text`.** An anchor must be text the model read and copied. A file marker
  there would anchor against content the model never saw.
- **Not in a target.** A target is addressing, not content.
- **Not in a legacy `set` tree.** The legacy form is frozen.

### 6.5 The engine refuses every surviving marker

The engine is pure and never reads a path. If a marker reaches it, the runner did not
resolve it, and the safe answer is to refuse the whole commit:
`unresolved_file_marker`, not retryable. Silently storing `{"@ag.file": "..."}` as a
configuration value would ship a broken agent.

The engine scans the whole value of every operation, at every depth, including inside
lists.

### 6.6 One commit, many markers

A commit may carry several markers. They are resolved as one set:
the runner checks the permission verdict, then resolves every marker, then substitutes
every value, then dispatches. A failure on any one marker fails the whole call before
anything is sent. `execution-authorization.md` section 3.4 owns the atomic
verify-and-consume rules, which now cover the SET of markers in one commit rather than a
set of operation-level sources.

## 7. Application and atomicity

Operations run in array order. Each sees the result of the ones before it. The first
failing operation aborts everything, and no partial result escapes. The caller's base tree
never changes: the engine deep-copies it, and deep-copies every value it writes.

## 8. What the engine returns

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

`changed` is mandatory before ship, not a convenience. A cornered model commits a no-op to
manufacture success; the usability spike observed it once. `changed=False` lets the wrapper
answer `no_change` and create no revision. The wrapper's own comparison is larger — it
covers the canonical persisted record — and `commit-transaction.md` section 5 owns it.

A warning is structured:

```json
{
  "code": "text_matched_normalized",
  "message": "edits[0].old_text matched after normalizing quotes and dashes.",
  "target": ["parameters", "agent", "instructions", "agents_md"],
  "operation_index": 1
}
```

| Warning code | When |
|---|---|
| `text_matched_normalized` | A prose anchor matched only after the normalized retry. Section 5.6.1. |
| `target_normalized` | The wrapper corrected a selector mistake. Section 4.3. |
| `wholesale_list_replace` | A `set` replaced a whole `tools`, `skills`, or `mcps` list. |
| `legacy_duplicate_key` | An untouched collection holds a duplicate key. Section 9. |
| `legacy_delta_form` | The delta used the legacy form. |
| `unaddressable_embed` | A touched collection holds an `@ag.embed` entry no operation can name. |

## 9. Unique names

- A collection is **item-touched** when an item operation names it.
- A collection is **branch-touched** when a `set`, `merge`, `remove`, or a legacy `set`
  writes it or an ancestor. A full-data commit branch-touches everything. A write INSIDE a
  selected entry also branch-touches the list that entry belongs to, because it can change
  the entry's own key and collide with a sibling.
- A collection nested in a keyed list is identified by its parent's key as well as its own
  name: `skills[alpha].files` and `skills[beta].files` are two collections, and neither
  answers for the other. Without the parent key they collapse into one and the last entry
  in the list decides the outcome for every entry.

1. An item-touched collection must end with no duplicate key: `duplicate_item_key`.
2. A branch-touched collection must not GAIN a duplicate. A key whose duplicate count rises
   is `duplicate_item_key`. A pre-existing duplicate that did not grow only warns.
3. An untouched collection only warns.

Rule 2 keeps every existing configuration committable. Open product call 2 may still change
rule 1.

## 10. The scope policy

```python
ScopePolicy = Callable[[Target], Optional[str]]   # a refusal message, or None
```

The engine checks every operation's target before it applies any operation. A refusal is a
policy answer and must not depend on how far the change set got. The error names the
operation index, and the tree stays untouched.

For the legacy form the engine builds targets: it walks the `set` tree to the policy's
prefix depth and splits each `remove` path on the dot.

`read-config.md` section 11 defines the two policies: `PARAMETERS_ONLY` for a run override,
and `AGENT_COMMIT_SCOPE` for a platform-tool commit. A refusal is `out_of_scope`, 422, not
retryable.

## 11. Platform-kind tool entries are rejected

An agent's configuration must never contain the playground's injected build kit. Agents
commit those tools by accident today.

**The wrapper rejects any `tools` entry with `"type": "platform"`**, with a retryable error
that names the offending entries:

```json
{
  "code": "platform_tool_not_committable",
  "message": "These are playground tools, not part of your configuration: commit_revision, test_run.",
  "next_step": "Remove those entries from `tools` and send the commit again.",
  "entries": ["commit_revision", "test_run"]
}
```

Rejection beats silent stripping. The usability spike showed that errors teach and silent
corrections do not. Two other guards stand with it: `read_config` reads the STORED
revision, which never contains the injected kit, so reads are clean by construction; and one
line of the tool description says so up front (section 15).

## 12. The error model

One failure aborts everything. HTTP 422 for a bad change set, 409 for a stale base
(`commit-transaction.md`).

```json
{
  "detail": {
    "code": "change_set_rejected",
    "message": "No revision was committed.",
    "operation_index": 1,
    "operation": "edit_text",
    "target": ["parameters", "agent", {"list": "skills", "key": "release-qa"}, "body"],
    "reason": {
      "code": "text_not_unique",
      "message": "old_text matched 3 times.",
      "next_step": "Add more surrounding lines to old_text until it appears once, then send the commit again.",
      "match_count": 3
    },
    "retryable": true
  }
}
```

### 12.1 Retryable errors

The agent can fix these and send again. Each one carries `next_step`.

| Code | Meaning |
|---|---|
| `target_not_found` | A segment does not exist. |
| `target_type_mismatch` | A node has the wrong type for the verb. |
| `invalid_target_shape` | The last segment is the wrong kind for the verb. Section 5.2. |
| `item_already_exists` | `add_item` found the key. |
| `item_not_found` | `replace_item` / `remove_item` did not find the key. |
| `item_rename_not_allowed` | `replace_item`'s value carries a different key. |
| `duplicate_item_key` | Two entries share one key. |
| `item_key_undefined` | The value has no derivable key. |
| `unkeyed_collection` | The list has no key field. |
| `missing_operation_value` | A value-bearing operation carried no `value`. |
| `invalid_operation_shape` | Any other malformed operation the schema also rejects. |
| `text_not_found` | The anchor does not occur. |
| `text_not_unique` | The anchor occurs more than once. |
| `text_edits_overlap` | Two matches share a character. |
| `empty_old_text` | The anchor is empty. |
| `no_change` | The edits produce identical content. |
| `source_not_found` | The runner could not find the file a marker names. |
| `source_unsupported` | The file is not readable as text. |
| `platform_tool_not_committable` | The `tools` list holds a platform-kind entry. Section 11. |
| `non_embeddable_reference` | The result embeds a static workflow that may not be embedded. Wrapper-owned; `commit-transaction.md` section 4.1. |
| `final_validation_failed` | The finished tree is not a valid configuration. Carries `issues`. |

### 12.2 Non-retryable refusals

Sending the same payload again never helps.

| Code | Meaning |
|---|---|
| `out_of_scope` | The scope policy refuses the target. |
| `invalid_delta` | Both forms, no form, or an unknown delta field. |
| `unknown_operation` | An unknown verb or an unknown `match_mode`. |
| `unresolved_file_marker` | An `@ag.file` reached the engine. Section 6.5. |
| `text_too_large` | The target string is above the work limit. |
| `source_too_large` | The file a marker names is above the byte limit. |

**Why the split matters.** The old model had one `invalid_operation` code marked
non-retryable. An agent honoring `retryable: false` would dead-end on every rename, because
a rename arrived as a shape error. Shape errors an agent can correct are now retryable and
carry the correction; only true refusals are terminal.

### 12.3 Every retryable error names the next action

`next_step` is one sentence in the imperative. It is not optional, and it is not a
restatement of the message.

| Code | `next_step` |
|---|---|
| `revision_conflict` (409) | "Call read_config for the new revision, re-anchor your edits to it, and send the commit again with the new base_revision_id." |
| `item_rename_not_allowed` | "Send remove_item for the old key, then add_item with the new value." |
| `text_not_found` | "Copy old_text from the configuration you read, character for character." |
| `text_not_unique` | "Add more surrounding lines to old_text until it appears once, then send the commit again." |
| `source_not_found` | "Write the file under .agenta-imports/ first, then send the commit again." |
| `platform_tool_not_committable` | "Remove those entries from `tools` and send the commit again." |
| `target_not_found` | "Call read_config for that part of the configuration and correct the target." |

### 12.4 Enriched content

Two errors carry the content the agent needs to recover in one turn, instead of forcing an
extra read:

- **`source_not_found`** lists the folders that DO exist under `.agenta-imports/`, and the
  files in the folder the path named if that folder exists. A wrong path is nearly always a
  near miss.
- **`text_not_found`** returns the nearest lines of the target string: the three lines with
  the highest similarity to `old_text`, each with its line number. The agent then sees
  whether its anchor was stale, reformatted, or simply mistyped.

## 13. Final validation

The engine takes a `validate` callable. It receives the finished tree and returns a list of
issues, or raises. Either way the engine raises one `final_validation_failed` carrying an
`issues` array, so the agent gets every problem at once.

The wrapper supplies the validator. It validates the revision data against the workflow
schema and the agent template against `AgentTemplateSchema`, and it runs section 9 and
section 11.

## 14. The derived commit message

The server writes the commit message from the operations. The model never sends one.

The rule: one clause per operation group, joined with "; ", in operation order.

| Operations | Clause |
|---|---|
| n `edit_text` on one field | `edited <field> (n edits)` |
| `set` on a field | `set <field>` |
| `merge` on a field | `updated <field>` |
| `remove` on a field | `removed <field>` |
| `add_item` on a list | `added <list-singular> <key>` |
| `replace_item` | `replaced <list-singular> <key>` |
| `remove_item` | `removed <list-singular> <key>` |

Example: `edited instructions (2 edits); added skill pdf-tools`.

The legacy form keeps a generic message: `updated configuration`.

**The ephemeral `description`, when the model sent one, is appended in parentheses**, so the
agent's own words survive without being the source of truth:

```text
edited instructions (2 edits); added skill pdf-tools (Adding the pdf-tools skill you asked for.)
```

`commit-transaction.md` section 5.2 keeps `message` out of the no-change comparison, so a
derived message never causes a revision on its own.

## 15. The tool description (normative)

This is the model-facing description of `commit_revision`. It ships as written. It measures
about 1.5 KB and 400 tokens; the 3.2 KB version scored the same (Haiku 55/55, DeepSeek
54/55) and cost 11 to 13 percent more per task.

Three conditions in section 4.3, section 12.3, and section 12.4 are part of this decision,
not separate: the short document works BECAUSE the wrapper normalizes the repeated-list
mistake, every error names a next step, and the selector key is `list`.

```text
Commit a change to this agent's own configuration.

Send `workflow_revision` with `base_revision_id` (the `revision_id` you read) and
`delta`. `delta` holds `operations`; they run in order, and if one fails nothing is
committed.

TARGET: an array of segments from the configuration root. A string segment names an
object field. An object segment {"list": L, "key": K} names one entry of list L and
stands in place of L's name. Keyed lists: skills, mcps, tools (by name), files (by path).

    ["parameters","agent",{"list":"skills","key":"release-qa"},
     {"list":"files","key":"checklist.md"},"content"]

OPERATIONS:
- `set` replace one field (needs `value`)
- `merge` deep-merge an object into one field (needs `value`)
- `remove` delete one field
- `edit_text` replace exact substrings in one string field (needs `edits`)
- `add_item` append to a list; target ends with the list name (needs `value`)
- `replace_item` replace one entry; target ends with a selector (needs `value`)
- `remove_item` delete one entry; target ends with a selector

`edits` is a list of {old_text, new_text}. `old_text` must occur exactly once and match
character for character, line breaks included. Copy it from the configuration you read;
never retype it from memory.

For a workspace file's content, write {"@ag.file": "<path>"} where the string would go.
Put the file under `.agenta-imports/` first.

    {"operation":"add_item","target":["parameters","agent","skills"],
     "value":{"name":"pdf-tools","description":"Make PDFs.",
              "body":{"@ag.file":".agenta-imports/pdf-tools/SKILL.md"}}}

Your `tools` list must not contain the playground's own tools (commit_revision,
test_run, read_config). They are not part of your configuration.
```

Two changes from the measured v3: the import root is named `.agenta-imports/`, and the last
paragraph is the build-kit line from section 11. Both are additive and neither changes the
grammar the measurement exercised.

## 16. Notes for adjacent slices

**Tool-list changes reopen the session on every harness in v1.** A commit that changes
`tools` does not route to a live catalog update, on any harness. The adapter capability
matrix stays in `adapter-matrix.md` so that flipping one harness to live later is a
one-line capability change, but v1 is uniform: reopen. Nothing in this contract depends on
which route runs; it is recorded here because a reader of the commit path will ask.

## 17. Changes the prototype needs

The prototype is `api/oss/src/core/workflows/change_set.py`.

| # | Change |
|---|---|
| 1 | Return `ChangeSetResult`; compute `changed`; collect warnings. |
| 2 | Rename the selector key `field` to `list`. |
| 3 | Remove all `value_from` handling. Add the `@ag.file` deep scan and `unresolved_file_marker`. |
| 4 | Count occurrences with overlap. |
| 5 | Add `match_mode` with a dispatch table, and the per-class tolerance of 5.6.1. |
| 6 | Create missing plain-string object parents in `set`. |
| 7 | Split the error codes per section 12; add `next_step` to every retryable one. |
| 8 | Add the work limits and `text_too_large`. |
| 9 | Add the unique-name rules and the warning codes. |
| 10 | Add `AGENT_COMMIT_SCOPE`. |

Wrapper-owned and therefore NOT in the engine slice: the selector normalization (4.3), the
platform-tool rejection (11), the derived message (14), and the enriched error content
(12.4), which needs the workspace and the base revision.

## 18. Open items

1. **Whitespace normalization is deliberately narrow** (5.6.1). Only Unicode space
   characters fold to ASCII space. Trailing-whitespace trimming and CRLF folding are
   excluded because they change length, and a length-changing normalization breaks the
   byte-exact write. If prose edits fail often on trailing whitespace, the answer is a
   length-preserving pre-check that reports the difference, not a folding match.
2. **A bare LF does NOT fold to a space, and the reason is not length.** A single LF to a
   single space is one code point to one code point, so it passes the length-preserving
   test that excludes CRLF. It is excluded for a different and stronger reason.

   Every other fold is a glyph variant: a smart quote and an ASCII quote are two spellings
   of the same character, so the anchor and the stored span hold the same characters and
   the model authored the whole span. An LF against a space is a **structural** difference.
   The model believes the span is one line, and it writes `new_text` for that belief. The
   write then replaces the matched span, so it deletes a line break the model never saw.

   In the prose class that is not hypothetical. `agents_md` and skill bodies are Markdown,
   and they routinely hold lists, headings, and fenced code, where a line break is meaning.
   Two measured examples, from a model that only wanted to change one token:

   ```text
   "Steps:\n- item one\n- item two\n"   ->   "Steps:\n- item 1 - item two\n"
   "```python\nx = 1\ny = 2\n```"        ->   "```python\nx = 3 y = 2\n```"
   ```

   The first silently merges a two-item list into one. The second silently turns valid
   Python into a syntax error. Both are inside a prose-class field, and neither is
   reported, because from the matcher's view the anchor matched once.

   So the prose/code split does not contain this risk: prose documents EMBED code and
   structure. **The observed failure (spike F.3.6, a stored soft-wrap newline against a
   sent space) is handled by the enriched `text_not_found` instead** (12.4): it returns the
   nearest lines, the model sees the real break, and it re-anchors. That costs one turn and
   risks nothing.

   A narrower rule could keep the win: fold an LF only when it is a soft wrap — not part of
   a blank line, not before a Markdown block marker, and not inside a fence. It excludes
   the list and heading cases, but not the fenced-code case without fence tracking, and it
   puts state into the matcher, which is what this design has kept out. Revisit only if the
   enriched error proves insufficient in measurement, and measure the corruption rate, not
   only the success rate.
3. **Unicode NFC against NFD** is likewise excluded. It is length-changing in the general
   case. Decision 1 chose exact storage, so a mixed-form field can only be repaired by
   rewriting it whole.
4. **Product call 2, unique-name enforcement**, may still change section 9 rule 1.
5. **Product call 6, storing the authored operations for audit**, would add a field to the
   commit record and interacts with section 14.
6. **The four content classes in 5.6.1 are the fields we know today.** A later schema field
   needs a class. The classification must live in one place, beside the `item_key` table.

## 19. Decision history

What this consolidation changed, and the decision behind each change.

| Change | Decision |
|---|---|
| `value_from` replaced by the inline `@ag.file` marker, allowed in any string position | Model-usability spike arbitration, 5 Aug. The operation-level source produced the only silent-corruption failure mode; the marker went 91/91. |
| The folder source and the folder-to-skill codec are dropped from v1 | Same. The agent authors skill structure itself. |
| `on_unsupported`, `on_executable`, `persist_executable_capability` all removed; `executable` and `allow_executable_files` are ordinary agent-authored fields the approval card shows | Settled-by-contracts, 5 Aug. One marker is one file, and the all-or-nothing commit makes partial imports impossible. This retires the four-layer split. |
| Import root is `.agenta-imports/`, not `imports/` | Mahmoud, 5 Aug. Dot-folder hidden by shells; the Files drawer already filters the `.agenta-*` prefix. |
| Paths may be relative or absolute inside the workspace | Model-usability arbitration, 5 Aug. Agents write absolute paths naturally. |
| Selector key `field` renamed to `list`; the wrapper normalizes two selector mistakes | Same. The selector caused 62 percent of spike failures. |
| Match tolerance by content class; storage stays exact bytes | Mahmoud's PR review, 5 Aug, plus decision 1 (option A, 5 Aug). |
| `message` leaves the model-facing schema; the server derives it; `description` is appended | Superseded the "optional free text" rule after the v3 measurement, 5 Aug. |
| `invalid_operation` split into retryable shape errors and non-retryable refusals; rename gets its own code | Model-usability arbitration, 5 Aug. An agent honoring `retryable:false` would dead-end on every rename. |
| Every retryable error carries a next step; `source_not_found` and `text_not_found` carry content | Same. |
| Platform-kind tool entries rejected on commit | Mahmoud's PR review, 5 Aug. Rejection over silent stripping, because errors teach. |
| `changed` is mandatory before ship | Same arbitration. A cornered model commits a no-op to manufacture success. |
| The v3 instruction document is folded in as the normative tool description | Same, with the two named edits. |
| Tools-route note: v1 reopens sessions uniformly | Mahmoud's PR review, 5 Aug. |

Superseded and no longer authoritative: this file's gate-2 and gate-3 resolution sections,
the `value_from` arbitration in `decisions.md` under "Contract phase", and
`workspace-import.md`'s folder-codec and policy-field sections.
