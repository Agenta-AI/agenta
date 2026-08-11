# Benchmark: can a small model address the commit ENVELOPE?

Status: complete. Owner: verify-api. Date: 6 August 2026.

The first spike asked whether a small model can author the ordered OPERATIONS. This one
asks whether it can address the envelope around them, and it answers one specific question
Mahmoud raised: does the placement sentence added to the `description` field actually buy
first-attempt success, or was that a claim?

**The answer: it buys nothing measurable, because on every model reachable from this box
the mistake is either absent or unmoved by the sentence.** The live stumble does not
reproduce here at anything like the rate live QA saw it. Section 4 says what that means.

## 1. What changed in the harness, and why the old numbers were not reusable

The spike harness could not run at all. It imports its engine as `change_set`, and that
module lived in a worktree that has since been deleted. Any claim of the form "the harness
says X" was stale on its face.

It also hand-wrote the tool schema. That copy has drifted from the shipped one in three
ways, measured rather than eyeballed (`real_surface.describe_divergence`):

| Difference | Shipped | Spike's copy |
|---|---|---|
| top-level `description` | present, beside `workflow_revision` | **absent entirely** |
| `workflow_revision.message` | gone (the server derives it) | still advertised |
| `workflow_revision.required` | `["delta"]` | `["base_revision_id", "delta"]` (+`message` early) |

The first line is the important one: **the field whose placement live QA saw a model get
wrong did not exist in the benchmark's schema.** The old harness could not have measured
this failure under any wording.

The engine differs too. The shipped `apply_change_set` returns a result object carrying
`data`, `changed`, and `warnings`; the prototype returned a bare tree. A no-change commit
was therefore invisible to the first spike.

Both surfaces are now imported, not copied: `real_surface.py` loads the engine from
`api/oss/src/core/workflows/change_set.py` by path and the schema from `op_catalog.py` with
ordered operations on. A hand-copy answers a question about the copy.

The harness now also validates each tool call against that schema before it runs, which is
what a coding harness does and where the live round trip was actually lost.

## 2. The tasks

Two envelope tasks, `e1` and `e2`. Each asks for a change the models already prove they can
make (one scalar field) plus a note for the user, so a failure is an envelope failure and
not an operation failure. The operation checker still runs, which keeps the two apart.

Before any model ran, a golden payload proved both tasks solvable, and the deliberately
wrong payload proved the harness catches the exact failure being measured:

```
golden:            schema valid, engine accepted, checker PASS
description nested: "Additional properties are not allowed ('description' was unexpected)"
```

## 3. Results

371 trials. 817k input and 71k output tokens, under two dollars across four models.

### First-attempt envelope facts, both arms

`shipped` carries the placement sentence. `shipped-control` is the identical schema with
that one sentence removed, and nothing else.

| Model | Arm | valid 1st call | description at top level | nested (the stumble) | operation correct |
|---|---|---|---|---|---|
| haiku | shipped | 21/21 | 21/21 | 0 | 21/21 |
| haiku | control | 20/20 | 20/20 | 0 | 20/20 |
| gpt-5.3-codex | shipped | 20/20 | 20/20 | 0 | 20/20 |
| gpt-5.3-codex | control | 20/20 | 20/20 | 0 | 20/20 |
| deepseek | shipped | 20/20 | 20/20 | 0 | 20/20 |
| deepseek | control | 19/20 | 18/20 | 0 | 19/20 |
| gpt-4o-mini | shipped | 64/70 | 37/70 | 6/70 | 70/70 |
| gpt-4o-mini | control | 67/70 | 40/70 | 3/70 | 70/70 |

### Operation regression, shipped surface

| Model | Correct | First call valid | base id sent |
|---|---|---|---|
| gpt-5.3-codex | 55/55 (100%) | 55/55 | 55/55 |
| haiku | 52/55 (94%) | 55/55 | 55/55 |

Haiku's three failures are one give-up after three attempts on the MCP removal and two
turns with no tool call at all on the import-root recovery task. That matches the first
spike's v3 arm (96%) and is not a regression from the shipped surface.

## 4. What this means

**Three of the four models never misplace the field**, with or without the sentence. That
includes `gpt-5.3-codex`, the nearest reachable relative of `gpt-5.3-codex-spark`, which is
the model the UI QA agent was actually running when it stumbled (read from the QA
campaign's own stored configs). OpenRouter does not serve the `spark` variant.

**The one model that does misplace it is not helped by the sentence.** gpt-4o-mini nests
the field 6 times in 70 with the sentence and 3 times in 70 without it. The difference
points the wrong way and is not significant (Fisher exact, p = 0.49). Top-level placement
is 52% against 57% (p = 0.73).

**gpt-4o-mini's dominant behavior is omission, not misplacement.** It sends no description
at all in roughly half of its trials, in both arms. That is allowed: the field is optional
by design, and an agent that says nothing is quieter, not broken. A placement sentence
cannot fix an omission, and it should not try to.

**The base-id worry did not materialize.** Every model sent `base_revision_id` in every
trial, in every arm, so the gap between the schema (which does not require it) and the
service (which does, for an ordered delta) costs nothing in practice. It is still a real
mismatch and worth closing on the schema side one day.

### The honest verdict on the fix

The sentence is not harmful and it costs about 20 tokens. It also has no measured effect.
Shipping it on the strength of "it should help" was reasonable; keeping it on that basis
now is not, because the measurement exists.

What the benchmark cannot explain is why live QA saw the stumble twice in two sessions when
the closest reachable model does it zero times in 40. The difference is not the wording,
so it is something the benchmark does not reproduce:

- the live agent runs inside the `pi_core` and `codex` harnesses, which present tools
  through their own plumbing rather than as a raw API tool call;
- the live context is far larger, carrying skills, playbooks, other tools, and history,
  and schema adherence is known to degrade with context;
- `gpt-5.3-codex-spark` may simply behave differently from `gpt-5.3-codex`.

### Recommendation

Do not iterate the wording. Detecting a real change in a 4-to-8 percent effect needs
several hundred trials per arm, and there is no evidence a different sentence moves it.

Two options actually address it:

1. **Tolerate both positions.** The runner lifts a `description` found inside the payload
   object up to the top level before it validates. That fixes every model, in every
   context, whatever the wording, and it costs one small change at the strip step. It
   trades a little strictness for the round trip.
2. **Reproduce it first.** Run the same two tasks through the real harness, with a real
   agent context, on `gpt-5.3-codex-spark`. If it reproduces there, the cause is context or
   harness plumbing, and wording was never going to fix it.

Option 1 is cheap and closes the class. Option 2 tells us whether anything needs closing.
They are not exclusive.

## 5. Reproducing

```
cd docs/design/agent-config-editing/spikes/model-usability
uv run --no-project --with anthropic --with httpx --with jsonschema \
  --with-editable ../../../../../sdks/python \
  python run.py --model gpt-4o-mini --surface shipped --instructions v3 \
  --tasks e1,e2 --n 25 --out results/gpt-4o-mini-envelope-shipped.jsonl
```

`--surface shipped-control` is the other arm. `--surface spike` restores the original
hand-written schema for comparison against the first spike's arms.

Raw results are under `model-usability/results-envelope/`.
