# Spike: can a small model author our config-editing operations?

Status: complete. Owner: model-usability-spike. Date: 5 August 2026.

The question: can a Haiku-level model correctly author the ordered operations of
`contracts/change-set.md`, given tool instructions of realistic size? And what instruction
wording maximizes its success?

The answer: **yes, but not with the contract as written.** A model-facing document
mechanically derived from the contract gets Haiku to 34% correct. The same model, same
schema, same tasks, with a tuned 3.2 KB document reaches 96%. Two small interface changes
take it to 100%. Almost all of the gap is one thing: the target grammar's selector
segment. Section 6 lists what must change.

| Arm | Haiku correct | DeepSeek correct |
|---|---|---|
| v0, contract-literal instructions | 19/55 (34%) | 42/55 (76%) |
| v1, first tuned draft | 48/55 (87%) | 49/55 (89%) |
| v2, tuned after reading v1 failures | 53/55 (96%) | 54/55 (98%) |
| v2 + two interface fixes | **55/55 (100%)** | 54/55 (98%) |

## 1. What was measured, and how

Every trial is one tool-calling conversation. The model gets a system prompt, one tool
whose `description` is the instruction document under test, the tool's JSON schema, and a
user message holding a `read_config` response plus a natural-language task. It calls the
tool. The harness plays the three layers below it:

- the **runner** resolves workspace content markers and refuses a path outside the import
  root;
- the **commit wrapper** checks `base_revision_id` against the head;
- the **engine** is the real prototype, `api/oss/src/core/workflows/change_set.py` from
  worktree `agent-a2a2adaa5d154d454`, imported unmodified.

On a rejection the model reads the error as a tool result and may retry. The cap is three
calls: the first plus two retries. On success a per-task checker inspects the config the
engine produced and asserts both the intended change and the absence of collateral damage
(a rewrite that truncates the rest of the document fails, even though the engine accepts
it).

Grading is fully automatic. Nothing is judged by reading model prose.

Models: `claude-haiku-4-5-20251001` through the Anthropic API, and
`deepseek/deepseek-v4-flash` through OpenRouter. Both keys were found in
`~/.agenta-qa-secrets.env`. Default temperature. 11 tasks x 5 trials x 8 arms = **440
trials**, about 1.9M input and 0.2M output tokens.

Before any model ran, a self-test proved every task solvable: a hand-written golden delta
for each of the 11 tasks passes the engine and its checker, and each of the three recovery
tasks provably fires its intended error. That file is `selftest.py`; it is the guard
against a task that no model could have passed.

### The task suite

The base config is one realistic agent template: an `agents_md` instruction document,
three skills (one with a bundled file), three tools, two MCP servers.

| Task | What it asks |
|---|---|
| a | Replace one sentence in the instructions, keep the rest |
| b | Change one line in one skill's body |
| c | Add one builtin tool by name |
| d | Remove one MCP server |
| e | Add a skill whose body and bundled file come from workspace paths |
| f | The head moved: get a 409, re-anchor on the new config, retry |
| g | The anchor appears twice: get `text_not_unique`, retry with more context |
| h | The given folder is outside `imports/`: get refused, find the right path |
| i | Rename a skill, keeping its content |
| j | Edit a line inside a skill's bundled file (two nested selectors) |
| k | Three unrelated changes in one commit |

### The four arms

The schema is identical in every arm, so the only variables are the document and, in the
last arm, the runner's leniency.

- **v0** is the contract summarized honestly and mechanically: the seven verbs in contract
  wording, the target grammar as prose, the `value_from` source, the full reason-code list.
  2.9 KB. This is the document you get if you write the tool description from
  `change-set.md` without watching a model use it.
- **v1** is a first tuned draft: the same content, plus a worked target example, "copy the
  anchor, do not retype it", a worked import example, and one line on what to do with a
  retryable error. 2.6 KB.
- **v2** is v1 rewritten after reading every v1 failure. 3.2 KB. Section 4 is its full text.
- **v2 + L** is v2 with two runner changes, described in section 5.

## 2. Results

### Correct final configuration, by task

| Task | Haiku v0 | Haiku v1 | Haiku v2 | Haiku v2+L | DS v0 | DS v1 | DS v2 | DS v2+L |
|---|---|---|---|---|---|---|---|---|
| a edit one instruction sentence | 5/5 | 5/5 | 5/5 | 5/5 | 4/5 | 3/5 | 5/5 | 5/5 |
| b change one line in a skill body | 1/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| c add one tool by name | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| d remove one MCP server | 0/5 | 5/5 | 5/5 | 5/5 | 2/5 | 5/5 | 5/5 | 5/5 |
| e add a skill from workspace files | 0/5 | 5/5 | 5/5 | 5/5 | 3/5 | 5/5 | 5/5 | 5/5 |
| f conflict, then retry on the new head | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 3/5 | 5/5 | 5/5 |
| g ambiguous anchor, then retry | 2/5 | 5/5 | 5/5 | 5/5 | 3/5 | 5/5 | 5/5 | 5/5 |
| h wrong folder, then correct the path | 0/5 | 5/5 | 3/5 | 5/5 | 3/5 | 5/5 | 4/5 | 4/5 |
| i rename a skill, keeping its content | 0/5 | 2/5 | 5/5 | 5/5 | 4/5 | 4/5 | 5/5 | 5/5 |
| j edit a line inside a bundled file | 0/5 | 1/5 | 5/5 | 5/5 | 4/5 | 5/5 | 5/5 | 5/5 |
| k three changes in one commit | 1/5 | 5/5 | 5/5 | 5/5 | 4/5 | 4/5 | 5/5 | 5/5 |
| **all** | **19/55** | **48/55** | **53/55** | **55/55** | **42/55** | **49/55** | **54/55** | **54/55** |

### The pipeline, stage by stage

| Arm | called the tool | valid JSON (first call) | engine accepted | correct |
|---|---|---|---|---|
| Haiku v0 | 100% | 100% | 52% | 34% |
| Haiku v1 | 100% | 100% | 87% | 87% |
| Haiku v2 | 100% | 100% | 96% | 96% |
| Haiku v2+L | 100% | 100% | 100% | 100% |
| DS v0 | 96% | 96% | 80% | 76% |
| DS v1 | 100% | 100% | 89% | 89% |
| DS v2 | 100% | 100% | 100% | 98% |
| DS v2+L | 100% | 100% | 98% | 98% |

Two things stand out. **Neither model struggles with JSON.** Haiku produced a well-formed
tool call on all 220 of its first calls; DeepSeek on 96% of its v0 calls and 100%
everywhere else. The losses are all semantic. And **the gap between
"engine accepted" and "correct" is almost zero except in v0**, where it is 18 points for
Haiku — meaning a bad document does not just cause rejections, it causes silently wrong
commits (section 3.2).

### Recovery within two retries

| Arm | f (409 conflict) | g (ambiguous anchor) | h (wrong folder) |
|---|---|---|---|
| Haiku v0 | 5 recovered, 0 never | 2 recovered, 3 never | 0 recovered, 5 never |
| Haiku v1 | 5 recovered, 0 never | 5 ok, 0 never | 5 recovered, 0 never |
| Haiku v2 | 5 recovered, 0 never | 5 right first time | 3 recovered, 2 never |
| Haiku v2+L | 5 recovered, 0 never | 5 right first time | 5 recovered, 0 never |
| DS v0 | 5 recovered, 0 never | 3 recovered, 2 never | 3 recovered, 2 never |
| DS v1 | 3 recovered, 2 never | 5 right first time | 5 recovered, 0 never |
| DS v2 | 5 recovered, 0 never | 5 ok, 0 never | 4 recovered, 1 never |
| DS v2+L | 5 recovered, 0 never | 5 right first time | 4 recovered, 1 never |

The 409 flow works. Both models, in every arm, re-anchored on the new head and resent with
the new `base_revision_id` — 38 of 40 times. This part of the design is not the problem.

The ambiguous-anchor flow works too, and it gets *better* than recovery: under v2 both
models pick a unique anchor on the first call, so `text_not_unique` never fires. One
sentence in the document ("if you get `text_not_unique`, add surrounding lines") converted
a retry loop into a first-call success.

Cost fell as accuracy rose: Haiku used 360K input tokens on v0 and 201K on v2+L, because
failures are retries and retries are tokens.

## 3. The failure modes

66 failures out of 440 trials, in six kinds.

### 3.1 The selector segment — 41 of 66 failures (62%)

This is the whole story. The target grammar says a selector `{"field": F, "key": K}` names
both the list and the entry, so the list name must not also appear as a string segment
before it. **No model guesses this.** Every model writes the list name and then a selector,
because that is what a path looks like everywhere else.

Verbatim, Haiku on v0, task d ("remove the linear MCP server"), all three attempts:

```json
{"operation":"remove_item","target":["parameters","agent","mcps",{"field":"mcps","key":"linear"}]}
  -> target_type_mismatch: "target segment 3: expected an object, found a list"
{"operation":"remove_item","target":["parameters","agent","mcps",{"field":"name","key":"linear"}]}
  -> target_type_mismatch: "target segment 3: expected an object, found a list"
{"operation":"remove_item","target":["parameters","agent","mcps",{"field":"mcps","key":"linear"}]}
  -> target_type_mismatch: "target segment 3: expected an object, found a list"
```

Three calls, one right idea, zero progress. The error names the failing segment and its
type, and it is useless: it never says "drop the repeated list name". Task d went 0/5.

The second attempt shows the sibling mistake: `{"field": "name", ...}`. The document says
"`skills` keyed by `name`", so the model reads `field` as the *key* field rather than the
*collection*. `field` is a bad name for "the collection this entry lives in".

The same confusion produced the deep-target failures. Haiku on v1, task j, editing a line
inside a skill's bundled file:

```json
"target":["parameters","agent","skills",{"field":"skills","key":"release-qa"},
          "files",{"field":"files","key":"checklist.md"},"content"]
  -> target_type_mismatch: "target segment 3: expected an object, found a list"
```

The intent is exactly right. The path is written the way a human would write it. It is
rejected on a technicality the error does not explain, and after two more guesses the trial
is lost. Task j was 1/5 on v1.

Adding three lines to the document fixed it completely — a WRONG/WRONG/RIGHT block, quoted
in section 4. Tasks d, i, and j went to 5/5 for both models.

### 3.2 The contract's `value_from` cannot say "this file into this field" — 11 failures

Task e needs a new skill whose `body` comes from `SKILL.md` and whose bundled file's
`content` comes from `reference.md`. The contract's `value_from` sits on the **operation**,
so it materializes the whole item from a folder. There is no legal way to say "this one
field's content comes from this one path".

Under v0, which documents `value_from` as the contract defines it, Haiku invented the
missing form in all five trials. What got committed:

```json
{
  "name": "pdf-tools",
  "description": "Make and merge PDF files.",
  "body_from": {"type": "workspace", "path": "imports/pdf-tools/SKILL.md"},
  "files": [{"path": "reference.md",
             "content_from": {"type": "workspace", "path": "imports/pdf-tools/reference.md"}}]
}
```

The skill has no `body` at all. It has a `body_from` key holding an unresolved source
object. **The engine accepted this and the commit succeeded.** `value` is untyped in the
schema, so `additionalProperties: false` never sees inside it, and the runner only strips
`value_from` at the operation level.

Across tasks e and h, all ten Haiku v0 trials committed a skill that would not load, in two
variants: five invented a `body_from` / `content_from` key and shipped no `body` at all,
and five put the `{"type": "workspace", "path": ...}` object directly into `body` as its
value. An eleventh trial, DeepSeek on v0, took the third bad option and hallucinated a body
from the file name.

This is the only failure mode in the spike that is silent. Everything else is a rejection
the model can see, and the model usually recovers from those.

The inline marker form does not have the problem. When the document teaches
`{"$content_from": "<path>"}` in place of any string, both models used it correctly and
tasks e and h went to 5/5. Given both surfaces in the same schema, models chose whichever
the *document* taught: 91 marker uses under v1/v2, 13 `value_from` uses under v0.

### 3.3 DeepSeek corrupts its own arguments, always in `message` — 7 failures

All seven of DeepSeek's malformed tool calls broke in the same field, and it writes
`message` last:

```
"message": "Replace 'Do not use emojis.' with 'Use plain language.' inojis.' with 'Use plain language.' in Tone section\"}}"}
```

The text degenerates into a repeated fragment and then trailing garbage. In **five of the
seven**, the `delta` that preceded it parses cleanly and, replayed through the engine,
produces the correct configuration. The model's change was right; a free-text commit
message destroyed it. Haiku never did this.

### 3.4 `source_not_found` is a dead end — 4 failures

Task h gives a path outside the import root. The intended flow is: refusal naming the
import root, model corrects the path. What actually happens is that the model reads "must
be under `imports/`" and *prefixes* it, producing `imports/scratch/pdf-tools/SKILL.md`.
That path does not exist, so it gets `source_not_found`, which says only that the file is
absent. Haiku on v1 then stopped:

> The file path needs to be relative to the repository root starting with `imports/`. Could
> you confirm the exact path to your pdf-tools folder? Is it `imports/scratch/pdf-tools/`
> or a different location?

That is a reasonable thing to say and a failed task. Adding the list of folders that do
exist under the import root to `source_not_found` took task h from 3/5 to 5/5 for Haiku.

### 3.5 A no-change commit is an escape hatch — 1 failure

DeepSeek on v2, task h, after the same `source_not_found` dead end, abandoned the task and
sent this instead:

```json
{"operations":[{"operation":"set","target":["parameters","agent","llm","max_tokens"],"value":8192}]}
```

`max_tokens` was already 8192. The engine accepted it, the commit succeeded, and the model
reported success to a user whose skill was never added. The prototype has no no-change
detection, so nothing caught it. Contract section 7's `changed` flag and the commit
wrapper's no-change answer are what stop this, and neither is implemented yet.

### 3.6 Exact matching versus soft-wrapped text — 1 failure

The stored instruction document wraps mid-sentence: `"...when the suite is\nunavailable."`.
DeepSeek on v1 sent `"...when the suite is unavailable."` — the newline normalized to a
space — and got `text_not_found` three times, guessing at whitespace each time. The error
says "the text must match exactly, with all whitespace and newlines" and never shows what
the text actually is. Returning the nearest lines of the target fixes it.

Worth recording: this was the *only* exact-match failure in 440 trials, and **both models
chose `edit_text` over a wholesale `set` on 100% of long-text edits in every arm, including
v0, which never warns against it.** Verb choice is not the hard part. Addressing is.

## 4. The instruction document

This is v2, the arm that reached 96% on Haiku and 98% on DeepSeek. It is 3.2 KB and it goes
in the tool's `description`. Source: `instructions/v2.md` in the spike directory.

```markdown
Commit a change to this agent's own configuration.

Send `workflow_revision` with `base_revision_id`, `message` (one short line), and
`delta`. `base_revision_id` is the `revision_id` of the configuration you read. `delta`
holds `operations`, which run in order. If one fails, nothing is committed.

TARGET. An array of segments read from the root of the configuration. A plain string
segment names an object field. An object segment `{"field": L, "key": K}` names one entry
in the list `L` — `field` is the LIST's name, `key` is the entry's name.

A selector REPLACES the list name. Never write the list name and then a selector.

    WRONG ["parameters","agent","skills",{"field":"skills","key":"triage"}]
    WRONG ["parameters","agent","skills",{"field":"name","key":"triage"}]
    RIGHT ["parameters","agent",{"field":"skills","key":"triage"}]

Four lists take a selector: `skills`, `mcps`, `tools` (all keyed by `name`) and `files`
(keyed by `path`). Selectors nest, and again the inner list name is not repeated:

    ["parameters","agent",{"field":"skills","key":"release-qa"},
     {"field":"files","key":"checklist.md"},"content"]

OPERATIONS. `set` replaces one field (needs `value`). `merge` deep-merges an object into
one field (needs `value`). `remove` deletes one field. `edit_text` replaces exact
substrings in one string field (needs `edits`). `add_item` appends to a list; its target
ENDS with the list name (needs `value`). `replace_item` replaces one entry and
`remove_item` deletes one entry; their targets END with a selector.

`replace_item` cannot rename: the new value must keep the same key. To rename an entry,
send `remove_item` and then `add_item` in the same delta.

EDIT_TEXT is how you change part of a long text. Do not `set` a whole document to change
one line. Each edit carries `old_text` and `new_text`. `old_text` must occur exactly once
and must match character for character. Copy it out of the configuration you read; never
retype it from memory. Watch the line breaks: a sentence in the stored text may wrap
across a `\n` where a paragraph would read as one line. If you get `text_not_found`, your
whitespace is wrong — copy a shorter fragment that you can see verbatim. If you get
`text_not_unique`, add surrounding lines until the anchor is unique.

WORKSPACE FILES. To use a file's content as a value, write `{"$content_from": "<path>"}`
where the string would go. Paths are relative to the repository root and must be under
`imports/`. Do not invent a path: use the one you were given, and if it is refused, use a
path the error offers.

    {"operation":"add_item","target":["parameters","agent","skills"],
     "value":{"name":"pdf-tools","description":"Make PDFs.",
              "body":{"$content_from":"imports/pdf-tools/SKILL.md"},
              "files":[{"path":"reference.md",
                        "content":{"$content_from":"imports/pdf-tools/reference.md"}}]}}

ERRORS carry a reason code and `retryable`. When it is retryable, fix the operation and
call again; do not ask the user. `stale_base_revision` means someone else committed: the
error carries the new head and its data, so re-anchor your edits against that data and
resend with the new `base_revision_id`.
```

### Which sentences earned their place

Measured by what the v0 to v2 diff bought:

| Element | Worth |
|---|---|
| The WRONG/WRONG/RIGHT selector block | +26 Haiku trials. The single highest-value item in the document. |
| The nested-selector example (`skills` then `files`) | Task j, 1/5 to 5/5. |
| `{"$content_from": ...}` taught instead of `value_from` | Tasks e and h, 0/5 to 5/5 on Haiku, and it ends the silent-corruption mode. |
| "`replace_item` cannot rename; use remove + add" | Task i, 2/5 to 5/5. |
| "add surrounding lines until the anchor is unique" | Turned task g from a retry loop into a first-call success. |
| "when it is retryable, fix it and call again; do not ask the user" | Removed two of four give-ups. |
| "Do not `set` a whole document to change one line" | **Nothing.** Both models always chose `edit_text` anyway, even on v0. |
| The full reason-code list (v0 had it, v2 does not) | **Nothing.** Models read the code they receive, not a catalog they were shown. |

Two lessons for whoever writes the real tool description. Show a wrong example next to the
right one — a positive example alone did not stop the selector mistake, because the model's
wrong form also looks like the positive example. And spend the space on the shapes the
model must produce, not on the vocabulary it will only ever consume.

## 5. The two interface fixes tested (arm "v2 + L")

Both live in the runner and the commit wrapper. Neither changes the contract's semantics.

1. **Forgive the two selector mistakes.** Before the engine runs, normalize each target:
   drop a string segment that repeats the list name of the selector right after it, and
   rewrite a selector whose `field` holds the collection's key field. So
   `["...","mcps",{"field":"mcps","key":"linear"}]` and
   `["...","mcps",{"field":"name","key":"linear"}]` both become
   `["...",{"field":"mcps","key":"linear"}]`. Unambiguous in both cases.
2. **Make the dead-end errors carry the missing fact.** `source_not_found` lists the
   folders that do exist under the import root. `text_not_found` returns the two or three
   lines of the target that most resemble the failed anchor, so the model can see the real
   line breaks instead of guessing.

Effect on Haiku: 53/55 to **55/55**, and task h from 3/5 to 5/5. Effect on DeepSeek: none —
v2's wording had already closed the same gaps for it, so leniency had nothing to repair.
That is the point. The fixes are insurance for the weaker model and cost the stronger one
nothing.

## 6. Verdict

A Haiku-level model can drive this interface. It needs three things.

**Must change in the interface.**

1. **`value_from` cannot express "one file into one field of a new item", and the gap is
   filled silently.** This caused the only invisible failure in the spike: a committed
   skill with `body_from` instead of `body`. Either add an inline per-field content marker
   (recommended — models reached for it 91 times across v1 and v2 and never
   once invented a variant of it, against 5 inventions in 5 v0 trials), or make the schema reject
   unknown `*_from` keys inside `value`, so the model is told rather than obeyed. Doing
   neither means a small model can commit a broken config and report success. This is the
   one finding I would treat as blocking.
2. **`source_not_found` and `text_not_found` are dead ends.** Both say what is wrong and
   nothing about what would be right. `source_not_found` should list what exists under the
   import root; `text_not_found` should return the nearest lines of the target. Together
   they were 5 of the 66 failures and 100% of the "stopped and asked the user" cases.
3. **Implement contract section 7's `changed` flag and the wrapper's no-change answer
   before this ships.** A model that cannot make progress will commit a no-op to produce a
   successful tool call. Observed once, and it reported success on a task it had abandoned.
4. **Consider making `message` optional.** It is where 7 of 7 DeepSeek JSON failures
   occurred, and in 5 of those the delta was already correct. A server-derived summary
   would have saved them. This matters only for the weaker model, but it is nearly free.

**Should change in the target grammar.** The selector is the interface's single hardest
element: 41 of 66 failures, and 26 of Haiku's 36 v0 failures. Wording fixes it, but wording
is a per-tool-description tax that every future caller must keep paying. Two cheaper
options, in order of preference:

- normalize the redundant list-name segment in the wrapper, as tested in section 5 — it
  removes the mistake without changing what a correct target looks like;
- rename `field` to `list` or `collection`. `field` is what made models put `name` there.

The contract itself does not need to change for either.

**Must change in the instructions.** Ship section 4's document, not a summary of the
contract. The gap between the two is 34% and 96% on the same model. The reason-code
catalog and the verb-choice advice can be dropped; the space belongs to the target grammar,
with a wrong example beside the right one.

## 7. Limits of this spike

- The schema was held constant across all arms so that the document was the only variable.
  A different operation-schema shape (the contract's seven-member `oneOf` versus the flat
  operation object used here) was not measured.
- The engine is the prototype, which still counts occurrences without overlap and does not
  create parents, compute `changed`, or emit warnings. Contract section 12 lists the gap.
  Nothing in these results depends on those items except finding 3 in section 6, which is
  about the missing `changed`.
- The workspace is simulated in memory. Real import policy (`on_unsupported`,
  `on_executable`, `persist_executable_capability`) was not exercised; no task needed it.
  Those three fields are model-visible per contract section 5.1.3 and are untested here.
- Five trials per cell. A 5/5 and a 4/5 are not meaningfully different; a 0/5 and a 5/5
  are. The claims above rest on the large gaps, not the small ones.
- One task, (h), has an artificial edge: the model must discover that `imports/pdf-tools/`
  exists. The refusal message names it, which is the behavior under test.

## 8. Reproducing

The harness and the instruction documents live beside this file, in
`spikes/model-usability/`. `results.tar.gz` in that directory holds 610 raw trials: the
original 440 (sections 2 to 4 above) plus 170 follow-up trials from the `v2L` leniency arm
and the new `v4a`/`v4b` surface arms. Each line of each JSONL file is one trial, with every
attempt the model made, what it sent, and what it got back.

```
selftest.py       proves all 11 tasks solvable and every negative case fires
tasks.py          base configs, prompts, checkers
harness.py        runner + commit wrapper + tool schema + the lenient arm
run.py            one arm: uv run run.py --model haiku --instructions v2 --n 5 --out ...
analyze.py        rates and failure modes
table.py          the markdown tables in section 2
instructions/     v0.md, v1.md, v2.md, v3.md, v4a.md, v4b.md
results.tar.gz    610 trials as JSONL, plus the generated tables
```

`run.py` needs `change_set.py` beside it: copy it from
`api/oss/src/core/workflows/change_set.py` in worktree `agent-a2a2adaa5d154d454`, or from
wherever the engine lands after slice 1. Add `--lenient` for the section 5 interface
arm, `--lenient --v3-surface` for the follow-up arm, and `--lenient --v4-surface`
for section G. Note the harness now carries the section G interface shape, so the v0-v2
arms cannot be replayed against it unchanged.

Keys are read from `~/.agenta-qa-secrets.env`. No key value is written to any output file.

---

# Follow-up: how small can the instructions get?

Added 5 August 2026, at the team lead's request. Mahmoud finds 3.2 KB heavy and asked for
the floor.

**Answer: 1,545 bytes / 392 tokens, at no measured loss.** v3 is 48% of v2's size and
scores the same: Haiku 55/55, DeepSeek 54/55. The saving is real but it is not free — it
is paid for by the interface, and section F.4 says exactly how much.

## F.1 What v3 assumes

The follow-up treats five interface behaviors as decided and simulates them in the
harness, the way section 5 simulated leniency:

1. the wrapper forgives both selector mistakes, so the WRONG/WRONG/RIGHT block is dropped;
2. the selector key is named `list`, not `field`;
3. every retryable error carries a `next_step` sentence, plus the enriched content from
   section 5 (folders that exist, nearest lines on `text_not_found`), so **all** recovery
   guidance is dropped from the document;
4. the content marker is named `@ag.file`;
5. `message` is optional.

One deviation, deliberate. Assumption 3 says "retryable errors", but the engine classes
`invalid_operation` as **non**-retryable, and `invalid_operation` is what a rename hits
("`replace_item` must keep the key"). An agent can absolutely fix that by sending
`remove_item` plus `add_item`, so the harness attaches the guidance regardless of the flag.
See finding F.5.3.

## F.2 The v3 document

1,545 bytes, 392 tokens (cl100k). Source: `model-usability/instructions/v3.md`.

```markdown
Commit a change to this agent's own configuration.

Send `workflow_revision` with `base_revision_id` (the `revision_id` you read) and
`delta`. `delta` holds `operations`; they run in order, and if one fails nothing is
committed.

TARGET: an array of segments from the configuration root. A string segment names an
object field. An object segment `{"list": L, "key": K}` names one entry of list L and
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

`edits` is a list of `{old_text, new_text}`. `old_text` must occur exactly once and match
character for character, line breaks included. Copy it from the configuration you read; never
retype it from memory.

For a workspace file's content, write `{"@ag.file": "<path>"}` where the string would go:

    {"operation":"add_item","target":["parameters","agent","skills"],
     "value":{"name":"pdf-tools","description":"Make PDFs.",
              "body":{"@ag.file":"imports/pdf-tools/SKILL.md"}}}
```

Sizes for comparison: v0 2,860 B / 709 tok, v1 2,593 B / 644 tok, v2 3,224 B / 798 tok,
**v3 1,545 B / 392 tok**.

## F.3 Results: v2+L versus v3+fixes

| Task | Haiku v2+L | Haiku v3+fixes | DS v2+L | DS v3+fixes |
|---|---|---|---|---|
| a edit one instruction sentence | 5/5 | 5/5 | 5/5 | 4/5 |
| b change one line in a skill body | 5/5 | 5/5 | 5/5 | 5/5 |
| c add one tool by name | 5/5 | 5/5 | 5/5 | 5/5 |
| d remove one MCP server | 5/5 | 5/5 | 5/5 | 5/5 |
| e add a skill from workspace files | 5/5 | 5/5 | 5/5 | 5/5 |
| f conflict, then retry on the new head | 5/5 | 5/5 | 5/5 | 5/5 |
| g ambiguous anchor, then retry | 5/5 | 5/5 | 5/5 | 5/5 |
| h wrong folder, then correct the path | 5/5 | 5/5 | 4/5 | 5/5 |
| i rename a skill, keeping its content | 5/5 | 5/5 | 5/5 | 5/5 |
| j edit a line inside a bundled file | 5/5 | 5/5 | 5/5 | 5/5 |
| k three changes in one commit | 5/5 | 5/5 | 5/5 | 5/5 |
| **all** | **55/55** | **55/55** | **54/55** | **54/55** |

Identical totals. DeepSeek traded one task for another (it lost an `a`, it gained an `h`),
which at five trials per cell is noise. Both v3 arms recovered on every f, g and h trial.

Input tokens fell with the document: Haiku 200,593 on v2+L to **179,952** on v3; DeepSeek
173,647 to **150,387**. Roughly 11% and 13% per task, which is the instruction saving
showing up once per turn.

**The two tasks the v2 document taught explicitly, and v3 does not, both stayed at 5/5.**
Task i (rename) relies entirely on the engine's `invalid_operation` message plus its
`next_step`; task j (nested selectors) relies on the one positive example. Neither needed
its own sentence.

## F.4 What the saving actually cost: the wrapper now does the teaching

This is the finding that matters. I replayed every target the models sent and counted how
many the wrapper had to repair.

| Arm | targets repaired | which mistake |
|---|---|---|
| Haiku v2+L | 0 / 80 | — |
| DeepSeek v2+L | 4 / 84 | 3 repeated list name, 1 named the key field |
| Haiku v3+fixes | **10 / 85** | 10 repeated list name, 0 named the key field |
| DeepSeek v3+fixes | **7 / 84** | 7 repeated list name, 0 named the key field |

Under v2, the WRONG/WRONG/RIGHT block meant Haiku never made the mistake — zero repairs.
Under v3 it makes it on 12% of targets, and the wrapper silently fixes them. The block and
the normalizer are **substitutes, not complements**: the work moved from the document to
the code. v3's 100% depends on assumption 1 being real. Ship v3's wording without the
wrapper fix and roughly one operation in eight breaks.

The rename did better than that. Both models used `{"list": ...}` on 100% of selectors —
40/40 for Haiku, 39/39 for DeepSeek, zero uses of `field` — and **the "named the key
field" mistake disappeared completely**. That mistake was `{"field": "name", ...}`, caused
by `field` reading as "which field identifies the entry". Calling it `list` removes the
ambiguity outright, with no wrapper support and no document sentence. It is the cheapest
fix in the whole spike.

So of the two selector mistakes: renaming to `list` kills one for free; the other needs
either three lines of document or the normalizer, and the normalizer is cheaper per caller.

## F.5 Three smaller results

### F.5.1 Optional `message` is not enough — it has to go

DeepSeek's single v3 failure is the same mode as before, on task a:

```
..."new_text": "Run the release-qa skill when the suite is\nunavailable."}]}]},
"message": "Replace manual fallback with release-qa skill manual fallback with
release-qa skill instruction\"}}"}
```

`message` was **optional** in this arm and the model volunteered one anyway, then
degenerated inside it and lost a delta that was otherwise complete. Assumption 5 as stated
does not fix the failure it was meant to fix. If we want it fixed, `message` has to leave
the model-facing schema entirely and be derived server-side from the operations.

### F.5.2 Errors teach as well as the document did, when they carry a next step

Every recovery task hit 5/5 for both models with zero recovery guidance in the document.
Task g reached 5/5 **first-call** — the model picks a unique anchor without ever being told
to, because the target example shows it what a real anchor looks like. Assumption 3 holds:
guidance belongs in the error, where it is read at the moment it applies, not in a document
read once per turn.

### F.5.3 `invalid_operation` is misclassified as non-retryable

Contract section 10 marks `invalid_operation` not retryable. But it is the code a rename
gets, and a rename is fixable — send `remove_item` then `add_item`. The harness had to
attach guidance in spite of the flag for task i to work. A real agent that honors
`retryable: false` and stops would fail every rename. **Recommendation: split the code, or
reclassify it retryable.** A shape error the agent can restructure is not the same as a
policy refusal it cannot.

## F.6 Verdict on minimum viable instruction size

**Ship v3: about 1.5 KB / 400 tokens is the floor, and it is a real floor, not a squeeze.**
Every remaining sentence earns its place — cutting further would mean cutting an operation
line or the exact-copy rule, both of which section 4's ablation showed are load-bearing.

Three conditions attach to that number, in order of how much they cost if skipped:

1. **The wrapper must normalize the repeated list name.** Not optional. It absorbs 12% of
   Haiku's targets under v3.
2. **Errors must carry a next-step sentence and the enriched content.** This is what buys
   the removal of all recovery guidance, roughly a third of v2's bytes.
3. **Rename the selector key to `list`.** Free, and it removes an entire failure mode.

What this does *not* say: it does not say instructions do not matter. The v0-to-v2 range in
section 2 is 34% to 96% on identical code. It says that once the interface stops surprising
the model — one unambiguous selector name, a wrapper that forgives the predictable slip,
and errors that say what to do next — the document has much less left to explain. The
budget moved; it did not vanish. Spend it on the target grammar and the exact-copy rule,
and let the errors do the rest.

Method note: v3 was run in one arm, with all five assumptions on together. The per-assumption
attribution in F.4 and F.5 comes from replaying the trials, not from separate arms, so the
individual contributions of assumptions 2, 3 and 4 are inferred rather than isolated.
Assumption 1 is the exception: v2+L versus v3+fixes isolates it directly, because the
document is the only other thing that changed.

---

# G. Executable files, and the renamed import root

Added 5 August 2026, at the team lead's request. The interface moved again after the
follow-up: the folder source and its three policy fields are gone, every file reference is
the inline `{"@ag.file": "<path>"}` marker in a string position, the import root is
`.agenta-imports/`, and whether a file is executable is now an ordinary agent-authored
field — `files[].executable` plus the skill-level `allow_executable_files`, both defaulting
to false, nothing derived from mode bits.

**Verdict: the schema suffices. The doc line is not needed.** Both models set both flags on
the first attempt with no mention of them in the instructions, 9 times out of 10, and the
tenth was unreadable rather than wrong. Adding the line changed nothing measurable. The
rename cost nothing.

## G.1 The arm

The harness was updated to that shape: `value_from` removed from the schema entirely (a
model that still sends one is refused and pointed at `@ag.file`), the import root renamed,
and the base configuration now carries `allow_executable_files: false` on every skill and
`executable: false` on every file — so the fields are visible in what the model reads.
The schema's `value` description documents the item shape, including both flags and their
defaults.

That is the whole of what l1 gives the model: the field names appear in the schema
description and in the configuration it just read. Nothing in the instruction document
mentions them.

New task **l**: *"Add the deploy-helper skill from `.agenta-imports/deploy-helper/`. It has
SKILL.md and scripts/run.sh. Its scripts/run.sh must be runnable as a program."* It passes
only when the committed skill carries the file with `executable: true` **and**
`allow_executable_files: true`, with both file contents pulled through `@ag.file`. The
self-test confirms the checker rejects each partial answer: neither flag, file flag only,
and skill flag only all fail; only both pass.

Two documents, identical except for one line:

- **v4a** (1,553 B): v3 with the renamed root in its example. Zero mention of executables.
- **v4b** (1,671 B): v4a plus `For a program file, set "executable": true on the file and
  "allow_executable_files": true on the skill.`

Tasks e and h were re-run in both arms to check the rename.

## G.2 Results

5 trials per cell, 60 trials total.

| Task | Haiku v4a | Haiku v4b | DS v4a | DS v4b |
|---|---|---|---|---|
| e add a skill from workspace files | 5/5 | 5/5 | 4/5 | 3/5 |
| h wrong folder, then correct the path | 5/5 | 5/5 | 3/5 | 2/5 |
| l add a skill with an executable script | 5/5 | 5/5 | 3/5 | 3/5 |
| **all** | **15/15** | **15/15** | **10/15** | **8/15** |

The DeepSeek column looks alarming and is not about this feature at all. **All 12 DeepSeek
failures across both arms are the `message` corruption of F.5.1** — 11 of them literally,
and the twelfth a malformed envelope. Not one is about the executable flags, the marker, or
the renamed root. Recovering the delta out of the corrupted payloads shows 3 of 5 v4a
failures and 5 of 7 v4b failures carried a delta that was already correct.

## G.3 Did models find the flags without being told?

This is the question the arm exists to answer. For every task-l trial I read the first
attempt's value, recovering it from the corrupted JSON where necessary:

| Arm | both flags set | one only | neither | unreadable |
|---|---|---|---|---|
| Haiku v4a — **no doc line** | **5/5** | 0 | 0 | 0 |
| DeepSeek v4a — **no doc line** | **4/5** | 0 | 0 | 1 |
| Haiku v4b — one doc line | 5/5 | 0 | 0 | 0 |
| DeepSeek v4b — one doc line | 5/5 | 0 | 0 | 0 |

Nine of ten first attempts with no doc line set both flags correctly. **Not one trial in
any arm set one flag without the other** — the failure mode the two-field design invites,
where the file is marked executable but the skill still forbids it, never occurred. The
tenth case is DeepSeek's corrupted payload, where the delta could not be parsed; its visible
tail contains `"executable": true`, so it is probably a tenth success, but I did not count
it as one.

The one added line moved DeepSeek from 4/5 to 5/5 readable-and-correct, which at five trials
is one sample, and moved Haiku not at all. There is no effect here to measure.

Why it works without the doc: `executable` and `allow_executable_files` are *ordinary,
well-named boolean fields on the object being authored*. The model reads a config where
every skill already shows both at `false`, gets a task that says "must be runnable as a
program", and flips them. This is the opposite of the selector problem in section 3.1, where
the model knew exactly what it wanted and could not express it. Here the shape is obvious
and the naming does the work.

## G.4 The rename cost nothing

Tasks e and h scored 5/5 for Haiku in both arms, unchanged from v3's `imports/`. Models
copied `.agenta-imports/` verbatim from the prompt; the leading dot and the hyphen caused no
trouble. Task h still recovers: the model is given a `scratch/` path, gets
`source_outside_import_root` with the list of real folders — now two of them, so it must
pick — and picks `pdf-tools` correctly.

Removing `value_from` also cost nothing. No model in any v4 trial tried to use it, and no
model asked for a folder-level import. With the marker taught and the folder source absent
from the schema, the inline form is simply the only thing there — which is the outcome
section 3.2 argued for.

## G.5 Verdict

**Do not add the line.** The executable flags need no instruction support:

1. Nine of ten first attempts set both flags correctly with zero documentation, and the
   tenth was unreadable, not wrong.
2. The dangerous partial state — file marked executable, skill still forbidding it — did
   not occur once in 20 trials.
3. The line costs 118 bytes, about 8% of a 1.5 KB budget that section F.6 argued is already
   at its floor. Spending 8% for no measured gain is the wrong trade.

What made this easy is worth copying deliberately, because it is the design lesson of the
whole spike: **name a field for what it is, put it in the data the model reads, and give it
a safe default.** The model then finds it. Instructions are needed where the interface is
surprising — the selector that stands in place of a list name, the marker that has no
analogue elsewhere — not where it is ordinary.

Two caveats. Five trials per cell means a 5/5 and a 4/5 are not distinguishable; the claim
rests on 19 of 20 trials agreeing, not on any single cell. And task l asks for the
executable file explicitly ("must be runnable as a program"). It does not test the harder
case where a user says only "add this skill" and the folder happens to contain a script —
there, the right behavior is probably to leave both flags false and say so, and nothing here
measures whether models do that.

**One item does need fixing, and it is not new.** DeepSeek lost 12 of 12 failures to the
free-text `message` field, in an arm where `message` was already optional. F.5.1 recommended
removing it from the model-facing schema and deriving it server-side. Three arms have now
reproduced the same failure. It is the largest remaining source of lost commits for the
weaker model, and it has nothing to do with any feature we have been testing.
