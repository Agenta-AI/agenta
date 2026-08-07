# Spike: the change-set engine

Task #2 of the agent-config-editing project. Owner: engine-spike. Date: 4 August 2026.

## 1. What this spike proves

The ordered-operations delta works as a pure function. One function applies a change set to
a base data tree. It has no database, no HTTP, and no pydantic models. The commit wrapper
and the invoke wrapper can both call it.

The prototype implements the full interface spec at
`docs/design/agent-config-editing/research/change-set-interface-codex.md`: the two delta
forms, the seven operations, the structured targets, the anchored text edits, the error
model, and the scope policy.

## 2. What I built and where

Both files sit in the worktree `agent-a2a2adaa5d154d454`. They are not committed.

| File | Size | Content |
|---|---|---|
| `api/oss/src/core/workflows/change_set.py` | ~700 lines | The engine. |
| `api/oss/tests/pytest/unit/workflows/test_change_set.py` | ~1200 lines | 120 tests. |

Run the tests with `cd api && uv run pytest oss/tests/pytest/unit/workflows/test_change_set.py`.
All 120 tests pass. `ruff format` and `ruff check` are clean.

### The public surface

```python
apply_change_set(base, delta, scope_policy=None, *, validate=None) -> dict
```

- `base` is the resolved base revision data. The engine never changes it.
- `delta` is a legacy delta or an ordered delta.
- `scope_policy` gets each target. It returns a refusal message, or `None` to allow.
  `PARAMETERS_ONLY` is the invoke wrapper's policy. `subtree_scope([...])` makes others.
- `validate` is the final-validation hook. It gets the finished tree.
- The function raises `ChangeSetError` on any failure. `ChangeSetError.to_detail()` gives
  the HTTP 422 body the spec prescribes.

Four more parts are public, because the SDK, the runner, and the server all need them:

- `apply_text_edits(text, edits)` — the anchored-edit engine alone.
- `item_key(collection, entry)` — the one canonical key function the spec asks for.
- `deep_merge(base, patch)` — today's merge, moved to one home.
- `Reason` — the reason-code vocabulary.

### What the engine does not do

The engine does not fetch the head revision. It does not compare `base_revision_id`. It
does not resolve `value_from`. It does not persist. Those belong to the wrappers.

## 3. Implicit decisions

The spec does not settle these points. I made a decision for each one, and I recorded it
here. Please accept, change, or reject each one. This section is the real output of the
spike.

### 3.1 Delta form

**D1. "Present" means "not null", not "key exists".** A pydantic dump carries
`{"set": null, "remove": null, "operations": null}`. If the engine looked only for the key,
every ordered delta would also look legacy. The engine looks at the value.

**D2. An empty delta is an error.** The spec says "at least one field required" for the
legacy form, but says nothing about a delta with no field at all. The engine refuses it
with `invalid_delta`.

**D3. Unknown delta fields are an error.** This matches the `additionalProperties: false`
rule in the spec.

### 3.2 Auto-creation

**D4. Ordered operations do not create missing parents.** `set` on
`["parameters", "agent", "nope", "deeper"]` fails with `target_not_found`. Only the last
segment of a `set` may be new.

Reason: the agent template is a closed schema (`extra="forbid"`). An auto-created path
always fails final validation. A precise error at the operation is better than a vague
schema error at the end. This is also a real difference from the legacy `set`, which
creates every level. The two forms now disagree on purpose.

**D5. `merge` needs an existing object target.** A missing target gives
`target_not_found`. A non-object target gives `target_type_mismatch`. The legacy `set`
would have created the object. `merge` does not.

### 3.3 Verbs and target tails

**D6. Each verb accepts only one kind of last target segment.**

| Verb | Last segment | Why |
|---|---|---|
| `set`, `merge`, `remove`, `edit_text` | a plain string | It addresses an object field. |
| `add_item` | a plain string (the list's field name) | It appends to a list. |
| `replace_item`, `remove_item` | a `{field, key}` selector | It addresses one named entry. |

Reason: without this rule, `set` on a selector does the work of `replace_item`, and
`remove` on a selector does the work of `remove_item`. The spec says the model must state
its intent. Two ways to say one thing defeats that.

A selector in the middle of a target stays legal for every verb. A skill body, a skill
file, and a tool field are all reachable.

### 3.4 Item identity

**D7. An `@ag.embed` entry has no key.** It is not addressable by name. `item_key` returns
`None` for it. An operation that names a key skips it. This follows the spec's advice to
exclude opaque embeds until a stable raw reference key exists.

**D8. A gateway tool is readable by its legacy name, but not writable without one.** The
engine reads an unnamed gateway entry as `{integration}__{action}`, so old configurations
stay addressable. `add_item` and `replace_item` refuse a gateway value with no `name`. The
reason code is `item_key_undefined`. This is the spec's split, made concrete.

**D9. A duplicate key is found only in the collection an operation touches.** The engine
does not scan the whole tree. A duplicate gives `duplicate_item_key` with a `match_count`.
R3 in the RFC wants unique names everywhere. That belongs to the final validator, not to
this engine.

**D10. `remove_item` refuses to act on a duplicate key.** It does not remove both entries,
and it does not remove the first one. The caller must fix the configuration first.

**D11. `replace_item` must keep the key.** The engine compares the key in the target with
the key it derives from the new value. A difference gives `invalid_operation`. The spec
asks for this. A rename is `remove_item` plus `add_item`.

**D12. `add_item` appends to the end.** The operation has no position field. Order in
`skills`, `tools`, and `mcps` has no meaning today.

**D13. Only four collections take item operations.** They are `skills`, `mcps`, `files`,
and `tools`. `add_item` on any other list gives `unkeyed_collection`. A permission list
such as `harness.permissions.allow` holds plain strings, so it has no key field.

### 3.5 Anchored text edits

**D14. Matching is exact on the bytes. Nothing is normalized.** The engine does not apply
NFKC. It does not fold smart quotes, dashes, or special spaces. It does not trim trailing
whitespace. It does not fold CRLF to LF. It does not strip a BOM. This follows the spec,
and it is the main deliberate difference from Pi.

The cost is real, and the design review should see it. A model that writes `"a - b"`
against a stored `"a — b"` gets `text_not_found`. A model that writes `\n` against a
stored `\r\n` gets `text_not_found`. The error is loud and correct, but the agent must
retry with the true bytes. The `read_config` tool (Q3) must therefore return the exact
stored string, with no cleanup on the way out.

**D15. Occurrences are counted without overlap.** The engine uses `str.count`. Pi uses a
split, which behaves the same way. So `"aa"` in `"aaa"` counts as one occurrence, and the
engine replaces at index 0. Two overlapping positions exist, so the anchor is not truly
unique. See open question O1.

**D16. Adjacent edits are legal; overlapping edits are not.** Two edits that touch but do
not share a character both apply. The rule is `previous_end > current_start`. Pi uses the
same rule.

**D17. Two edits with the same anchor give `text_edits_overlap`, not a duplicate error.**
Both match at the same index, so they overlap.

**D18. `no_change` applies to the whole batch.** One edit that changes nothing does not
fail the batch, if another edit in the same batch changes something. Pi does the same.

**D19. An empty `old_text` gets its own reason code, `empty_old_text`.** The spec's list
has no code for it. `text_not_found` would mislead the model.

### 3.6 Purity and copying

**D20. The engine deep-copies the base before it starts.** The caller's base always
survives, even on success.

This fixes a real aliasing defect in today's code. `service._deep_merge` copies each level
shallow. So a branch the patch does not touch stays shared with the base. Then
`service._remove_path` deletes through that shared branch, and the base changes too. Today
the base comes from a fresh `model_dump`, so nothing breaks. A shared engine cannot rely on
that. A test pins the old behavior, so we notice if `service.py` changes.

**D21. The engine deep-copies every value it writes.** The result never aliases the request
payload. Two operations that write the same value object stay independent.

**D22. `set` with `value: null` writes null.** It does not remove the field. `remove` is
the verb that removes.

### 3.7 Scope policy

**D23. The scope check runs before any operation applies.** A refusal is a policy answer.
It must not depend on how far the change set already got. The error still names the
operation index, so the model knows which operation was refused.

**D24. The policy signature is `target -> refusal message or None`.** A message, not a
boolean, so the refusal can say what is wrong. The reason code is `out_of_scope`.

**D25. The policy also guards the legacy form.** The engine turns a legacy delta into
targets. It walks the `set` tree down to the policy's prefix depth. It splits each `remove`
path on the dot. With the one-level prefix `["parameters"]`, this gives exactly today's
behavior in `_validate_delta_scope`, including the case where `remove: ["parameters"]`
deletes the whole allowed subtree. Today's guard allows that, so the engine allows it too.

**D26. A target shorter than the scope prefix is refused.** With the prefix
`["parameters", "agent"]`, a target of `["parameters"]` is out of scope, because writing it
would rewrite the subtree's parent.

**D27. The engine reads the whole target, including nested selectors.** Today's invoke
guard reads only top-level `set` keys and dotted `remove` strings. A structured target
would go straight past it. A test pins the new behavior.

### 3.8 Errors

**D28. Six reason codes were added.** The spec's list is marked "useful reason codes
include", so I treated it as open. The new codes are:

| Code | When |
|---|---|
| `invalid_delta` | Both forms, neither form, or an unknown delta field. |
| `invalid_operation` | A shape error the schema should also catch. |
| `empty_old_text` | An `edit_text` anchor is empty. |
| `unkeyed_collection` | The list has no key field. |
| `item_key_undefined` | The new entry has no derivable key. |
| `out_of_scope` | The scope policy refuses the target. |

**D29. `retryable` comes from a table, not from a guess.** `out_of_scope`,
`invalid_delta`, `invalid_operation`, and `source_too_large` are not retryable. Everything
else is. A retry with the same payload never helps for the first four.

**D30. `value_from` inside the engine is an error.** The reason code is `source_invalid`.
The runner must turn a workspace source into an inline value first. The engine never reads
a path. This makes the spec's rule enforceable, not only documented.

**D31. Exactly one of `value` and `value_from` must be present.** Both give
`invalid_operation`. Neither gives `invalid_operation`.

**D32. Final validation is a hook, not built in.** The caller passes a function. The
function returns a list of issues, or raises. Either way the engine raises one
`ChangeSetError` with `final_validation_failed` and an `issues` list. The spec asks for all
schema issues at once, so the list is a list.

### 3.9 Warnings

**D33. The engine has no warning channel.** The spec asks for a warning when a legacy call
replaces `tools`, `skills`, or `mcps` wholesale. A warning is a response-shaping concern.
It belongs to the commit wrapper, which owns the response. See open question O8.

## 4. Edge cases tested

The suite has 120 tests. These are the ones that carry information.

**Legacy parity.** Eleven legacy deltas run through both the engine and the real
`service._deep_merge` / `service._remove_path`, and the results must match. The cases
include a whole-list replacement, a scalar that replaces a dict, a null value, a missing
remove path, a scalar in the middle of a remove path, and a `set` followed by a `remove` of
the same key. A separate test pins `deep_merge` against `service._deep_merge` on six
shapes.

**The aliasing defect.** One test proves the engine leaves the base alone. One test proves
`service.py` does not.

**Ordering.** An `add_item` followed by an `edit_text` on the new item works. A
`remove_item` followed by an `add_item` performs a rename. A `merge` sees an earlier `set`.

**Atomicity.** A three-operation change set that fails at index 1 leaves the base
untouched, and the error names index 1.

**Text matching.** Six tests prove that no normalization happens: smart quotes, an em dash,
a non-breaking space, trailing whitespace, CRLF, and decomposed Unicode all fail to match
their plain form. One test proves a BOM stays part of the string.

**Text batches.** Disjoint edits apply together. Out-of-order edits apply correctly.
Adjacent edits apply. Overlapping edits fail. Two identical anchors fail. An edit that
names text an earlier edit wrote fails, because all anchors match the pre-operation string.
An all-no-change batch fails. A mixed batch with one real change succeeds. An edit with an
empty `new_text` deletes text.

**Nesting.** A skill file two selectors deep is readable, settable, and editable:
`["parameters", "agent", {skills: release-qa}, {files: scripts/check.py}, "content"]`.

**Tool identity.** A platform tool answers to its `op`. A reference tool answers to its
`slug` when it has no `name`. An unnamed gateway answers to `notion__create_page`. A
gateway value with no name cannot be added.

**Shape errors.** An empty target, a selector with only `field`, a selector with an extra
`index` key, an unknown verb, and a value on `remove` all fail with `invalid_operation`.

**Type errors.** `edit_text` on an object, `merge` on a list, `add_item` on a dict, and a
target that walks into a scalar all fail with `target_type_mismatch`.

**Scope.** A `parameters` target passes. A `uri` target fails. A nested selector under a
forbidden root fails. Both legacy fields are guarded. A two-level prefix walks the legacy
`set` tree.

## 5. Open questions for the design review

**O1. Overlapping occurrences.** `"aa"` occurs at two positions in `"aaa"`, but the count
says one, so the engine accepts the anchor and replaces the first position. Pi has the same
behavior. Should the engine count overlapping positions instead, and answer
`text_not_unique`? This case is rare in prose. It is not rare in code and in indented
Markdown.

**O2. Unicode form at the storage boundary.** Two clients can send the same text in two
Unicode forms. The playground textarea, the SDK, and the agent do not agree by
construction. With exact matching, a stored NFD string breaks every NFC anchor forever. Do
we normalize once, when a configuration string is stored, and keep matching exact? That is
a different decision from Pi's match-time normalization, and it is safer.

**O3. Line endings.** The same question, for CRLF. A configuration string that holds
`\r\n` is very hard for an agent to edit. Do we normalize line endings on write?

**O4. A later `match_mode`.** The spec proposes `match_mode` with `exact` as the default.
Should the operation carry the field from day one, with only `exact` allowed, so adding a
mode later is not a breaking change?

**O5. Auto-creation for `set`.** D4 refuses missing parents. Is that too strict for the
`extras` bags, where a whole object may legitimately not exist yet? The alternative is
"create objects on the way to the last segment, but never create a list entry".

**O6. Embed identity.** D7 makes `@ag.embed` entries invisible to named operations. An
agent that has one embedded skill cannot remove it with `remove_item`. It must fall back to
a legacy whole-list `set`, which is exactly what we are trying to stop. Do we need a raw
reference key for embeds, or a positional escape hatch?

**O7. Where does R3 live?** The RFC wants unique names for skills, tools, and MCP servers
at save time. The engine finds a duplicate only in the collection it touches. Does the final
validator own the global check? If yes, every existing configuration with a duplicate name
becomes uncommittable. That needs a migration answer.

**O8. The warning channel.** Spec section 7 asks for a warning when a legacy call replaces
a keyed list wholesale. Where do warnings live in the response, and does the invoke wrapper
carry them too?

**O9. A no-change change set.** The engine refuses a no-change `edit_text`. It does not
refuse a change set whose total effect is zero. Q5 wants a content checksum, so that a
commit which changes nothing keeps the warm session. Should the engine report "nothing
changed" so the commit wrapper can skip the revision?

**O10. Legacy `remove` is a silent no-op; ordered `remove` is strict.** The spec asks for
exactly this. It means the same agent gets two different answers for the same mistake,
depending on the delta form. Is that acceptable for the transition period?

**O11. HTTP status for a scope refusal.** `out_of_scope` is a policy refusal, not a
semantic error. 422 groups it with the data errors. Should the invoke wrapper answer 403
instead?

**O12. Where does `deep_merge` live?** The engine holds a copy. `service.py` still holds
the original. They must never drift. The engine's copy should become the only one, and
`service.py` should import it. That is a one-line change, and this spike did not make it.

## 6. Follow-up work this spike did not do

1. The pydantic operation models, with `extra="forbid"` and the discriminated union. The
   engine validates shape itself today, so the schema and the engine will overlap.
2. The commit wrapper: the `base_revision_id` check, in the same transaction as the insert.
3. The invoke wrapper: replace `_validate_delta_scope` with `PARAMETERS_ONLY`.
4. The final validator: `AgentTemplateSchema` validation that returns all issues.
5. `service.py` should import `deep_merge` from the engine (O12).
