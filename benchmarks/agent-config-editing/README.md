# Agent config editing: the one-shot benchmark (v2)

**The question this answers:** can a *small* model complete any configuration action a user asks
for **one-shot** — no errors, no retry, no error-then-fix — when the user types the way people
actually type? The goal is 95%.

The v1 spike (`docs/design/agent-config-editing/spikes/model-usability/`) measured **call shape**:
it handed a model the tool schema, took the JSON back, and applied it with the real engine offline.
That is why the selector key is `list` and why the tool description is 1.5 KB rather than 3.2 KB.
What it could not see is the product: the rendered instructions file, the platform guidance, the
approval gates, the sandbox, and the model's freedom to reach for a different tool entirely.

v2 is wire-level. Every trial drives `/services/agent/v0/invoke` — the endpoint the playground
drives — and every verdict is read back from the **stored revision row**. Never from the reply.

## Run it

```bash
export AGENTA_BASE=https://your-stack.example.com
export AGENTA_PROJECT_ID=...
export AGENTA_API_KEY=...

uv run run_benchmark.py --list                                  # cells and scenarios
uv run run_benchmark.py --cell claude-haiku-local --trials 3    # one cell
uv run run_benchmark.py --all-cells --trials 5                  # the matrix
uv run run_benchmark.py --dry-run --all-cells                   # plan only, spends nothing

uv run table.py results/<stamp>/results.json                    # re-render a summary
uv run table.py results/<new>/results.json --against results/<old>/results.json
```

Credentials come from the environment, or from `--env-file <path>` holding those three lines.
Nothing else about the target deployment is assumed, so the same benchmark runs against local
docker-compose, the preview stack, staging, or cloud.

**Exit code is 1** when the run misses `--threshold` (default 0.95), when a hard-fail instrument
fires, or when any trial was skipped. A benchmark that always exits 0 is invisible to CI.

## The two numbers, and why there are two

| | meaning |
|---|---|
| `one_shot` | every check passed **and** the trial stayed inside its budget (tool errors, commit calls) |
| `excl. harness` | `one_shot`, forgiving trials blocked only by a runtime failure with no error code |
| `eventual` | every check passed, whatever it cost along the way |

The **gap between them is the error-then-fix rate**. A product that errors on half its turns and
recovers reports itself as correct if you only publish `eventual`, and that is precisely the
outcome the 95% goal rejects. Both numbers appear in every table.

Each scenario states its own `budget`, because "one-shot" is not the same shape everywhere. A
conflict scenario allows one tool error and two commits: a 409 the model recovers from on the very
next call *is* the one-shot outcome there, since the platform was right to refuse.

**`excl. harness` is not a softer score, it is a different question.** An engine refusal carries a
`code` from the error envelope and is a model result. A harness error carries none — a malformed
tool-input serialization, an EISDIR — and is the runtime failing to carry a call the model made
correctly. Two same-text baseline runs of `claude-haiku-local` scored **37% and 24%** one-shot;
corrected, they are **45% and 42%**. Nearly all of that 13-point spread was one plumbing bug, and
a noise band that wide would swamp any wording change worth making. Report both: `one_shot` is
what a user experiences, `excl. harness` is what an instruction change can move, and the gap
between them is a bug with an owner.

## Failure shapes: why a score is not enough

Two cells can score the same on the same scenario and need **opposite** fixes. That is not
hypothetical — it is what the release gate's discovery cell measured on 6 August, driving the
verbatim `gstack-autoplan` prompt with a live key. Both harnesses landed on 2/3, for different
reasons:

| leg | shape | what happened |
|---|---|---|
| `pi_core` + `claude-haiku-4-5` (session 7b4a1f01) | `attempt_refused` | Copied the whole skill *directory* into `.agenta-imports/`, then referenced a path that did not match. The fail-closed deny correctly stopped it. It used the surface and got the details wrong. |
| `codex` + `gpt-5.6-luna` (session 4fa17164) | `described_no_action` | Correctly described the mechanism — "skills must be enabled through the agent configuration" — and then made **zero tool calls**. It knew the surface and never reached for it. |

A directive "always attempt the tool calls; do not only describe the mechanism" would plausibly
move the second and do nothing for the first. A path-handling correction would do the reverse. So
every trial carries an `outcome` label (`bench_lib.classify_outcome`), and the summary prints the
distribution per cell and the worst scenario/shape pairs:

| label | meaning | what it argues for |
|---|---|---|
| `one_shot` | passed, inside budget | — |
| `recovered` | passed, over budget | error-then-fix; look at the error code |
| `wrong_surface` | no config call, but the workspace **was written** — the job was done somewhere that is rebuilt next run, and reported as success | a location sentence |
| `described_no_action` | no config call, no write, and the reply explains the mechanism it declined to use | directive guidance |
| `no_action` | no config call and nothing to show for it | discoverability |
| `attempt_refused` | a config tool was called and refused | a mechanical correction; the error `code` names which |
| `committed_wrong` | a config tool succeeded and the stored row is still wrong | precision in the description |
| `unsettled` | never finished — wire error, or still gated at max rounds | not a model result |

Shell calls count toward `wrong_surface` only when the **command** is mutating (`cp`, `mv`, `>`,
`sed -i`, …). Classifying on the tool *name* would label a model that merely looked around before
explaining itself as `wrong_surface`, which is exactly the confusion the taxonomy exists to
prevent.

`fm-03-harness-skills-folder` carries a `baseline` block recording the two measurements above, so
a wording change has a before-number to beat on the two harnesses this benchmark could not measure
on its own.

**State the prediction before you measure.** A change proposed for one shape should say which
shape it is expected to move and which it is not; the outcome table then either confirms it or
shows the change moved something else, which is information either way.

## What a verdict is allowed to look at

**The stored revision row.** Not the reply. A denied tool call once produced a passing reply
because the model computed the answer it was meant to fetch (`qa_product.py`, the BASH_TOKEN
lesson). Prose is not evidence of a side effect.

The one exception is a read scenario, where the answer *is* the deliverable — and there the check
looks for a **per-trial random token** seeded into the configuration, which the model cannot
produce without having looked.

Checks address the stored row with **the same target grammar the model uses**:

```json
{ "check": "stored_contains",
  "path": [{"list": "skills", "key": "release-qa"},
           {"list": "files", "key": "checklist.md"}, "content"],
  "text": "smoke suite" }
```

### The check vocabulary

| check | asserts |
|---|---|
| `stored_equals` / `stored_contains` / `stored_not_contains` | an exact stored value or substring |
| `stored_matches` | a regex, where the *wording* is the model's to choose |
| `stored_count` | how many times a substring occurs — the disambiguation case |
| `stored_len` / `stored_present` / `stored_absent` | list length and entry membership |
| `stored_unchanged_except` | **collateral damage**: every branch outside `allowed` equals the baseline |
| `revision_created` / `no_revision_created` | a row was, or was not, written |
| `no_stored_marker` | no invented `@ag.*` marker survived into storage |
| `no_stored_gateway_without_connection` | no gateway tool committed without its connection |
| `turn_reply_contains` / `turn_reply_not_contains` | the reply, token-gated (read scenarios) |
| `turn_tool_called` | a call went out, optionally scoped to one scenario turn |

`stored_matches` exists to prevent **false failures**, which corrode a benchmark as fast as false
passes: a user asked for "the release-qa skill" and a model that writes "the release QA skill" has
done the job. Where the bytes matter — an anchor, a command, a token — `stored_contains` still
means exactly what it says.

## Scenarios

JSON under `scenarios/`, one file per action class, deliberately separate from the runner: adding a
task must never mean editing the driver, and a reviewer should be able to read the whole suite
without reading any Python. Each file's `about` block explains what the class measures.

| file | class | rows |
|---|---|---|
| `01-read.json` | read | read a value; read a list |
| `02-edit-instructions.json` | edit_text | replace a sentence; add a line |
| `03-skills.json` | skills | add, edit a body, remove, rename |
| `04-list-entries.json` | list_entries | remove, add, and the **nested** selector (a file inside a skill) |
| `05-import.json` | import | a skill from a file the user saved, through an approval gate |
| `06-conflict.json` | conflict | the head moved; did the other writer's change survive? |
| `07-multistep.json` | multistep | read-then-edit; two changes in one message |
| `08-failure-modes.json` | failure_mode | five failures seen in live QA, each a hard fail if reproduced |

Prompts are written the way a human types — no tool names, no field paths, no mechanism. One is
Mahmoud's verbatim message from session b59cb549.

### Anatomy of a scenario

```json
{
  "id": "conflict-01-stale-base",
  "seed":            { "instructions": { "agents_md": "..." } },
  "seed_workspace":  { "incident-review/SKILL.md": "...{{TOKEN}}..." },
  "tools":           [{ "type": "platform", "op": "list_connections" }],
  "requires":        ["gateway"],
  "turns": [
    { "prompt": "..." },
    { "before_turn": { "action": "commit_out_of_band", "patch": { } },
      "prompt": "..." }
  ],
  "budget": { "max_tool_errors": 0, "max_commit_calls": 1, "max_rounds": 8 },
  "checks": [ ]
}
```

`{{TOKEN}}` is replaced everywhere — seed, workspace files, prompts, checks — by one fresh random
token per trial, so no answer can come from priors, from the prompt, or from a previous trial.

`before_turn` moves the head **without the model**, which is the only honest way to produce a
conflict: a teammate editing the agent in the playground is what actually happens.

## The global instrument

`identical_call_resent_after_refusal` runs on **every** trial, not only where a scenario expects a
refusal — the behavior it catches can appear anywhere, and it is most surprising where nobody was
watching. It fires when a config tool call is re-sent byte-for-byte after a refusal the model
cannot fix by resending, which is the signature of reading `retryable` and ignoring `next_step`.

It excludes two things, both learned by watching it misfire: harness built-in tools (it first fired
on Claude's own `Edit` refusing "read the file first"), and refusals the envelope marked
`retryable: true`, where re-sending the identical call is exactly what the contract asks for.

## Cells

Eleven cells across three harnesses and two sandboxes. `--list` prints them. Subscription auth
where one exists, a vault key where subscription auth is refused — every Daytona cell is
managed-key, because Daytona rejects runtime-provided auth by design.

A cell missing its credential **SKIPs with the reason**, and a skipped trial fails the run. A skip
is an untested claim, never a pass.

## Version stamps, and why they are not optional

Every results file records, for each instruction surface the improvement loop is allowed to touch,
the **commit that last changed it** and a **sha256 of the bytes on disk at run time**:

| surface | file |
|---|---|
| tool descriptions | `sdks/python/agenta/sdk/agents/platform/op_catalog.py` |
| platform guidance | `services/runner/src/engines/sandbox_agent/platform-guidance.ts` |
| guidance composer | `services/runner/src/engines/sandbox_agent/system-prompt-appendix.ts` |
| mount guidance | `services/runner/src/engines/sandbox_agent/agent-mount-guidance.ts` |
| engine errors | `api/oss/src/core/workflows/change_set.py` |
| guidance skill | `.agents/skills/build-agent/SKILL.md` |

The digest is not redundant with the commit. An uncommitted edit is exactly what an improvement
loop produces, and a commit hash alone would attribute the new numbers to the old text. `table.py
--against` prints which surfaces changed between two runs before it prints the delta — a
per-scenario delta without that is a rumor.

## Results

`results/` is **append-only**. `MANIFEST.md` carries one line per run — when, what, the score, and
the stamps of the two surfaces most likely to have moved. A benchmark whose history can be edited
cannot show that a wording change helped, which is the whole point of the loop.

## The improvement loop

1. Run the matrix. Find the lowest cell x scenario rows.
2. Read the **failure shape**, not just the score. `described_no_action` and `attempt_refused` are
   different problems even at the same rate.
3. Name the **instruction surface** that failed the model: tool description wording, the platform
   guidance block, or the guidance skill. The shape, the `top failure` column, and the error `code`
   on each failing trial point at it.
4. Draft the minimal text change, and **write down which shape it should move and which it should
   not**. **Do not change tool structure** — schemas, operations, endpoints — except very
   minimally, with explicit justification.
5. Re-run the same cells and scenarios. `table.py --against` shows the delta with the stamps; the
   outcome table shows whether the shape you predicted is the one that moved.

A change that raises the score by moving a shape it was not aimed at has not been understood yet,
and the next change built on top of it will be guesswork.

Guidance text changes route through verify-runner's composer (it has a length tripwire, and the
budget being spent is the same small model's attention the author's own instructions draw on).
Tool description changes route through the SDK catalog.

## The UI tier

Designed, not built. It would drive the playground in a browser and answer what the wire cannot:
whether the approval **card** shows the human what they need to decide, and whether the config
drawer after a commit matches the row that was stored.

The seam is one function wide, in `bench_lib.TIERS` and `run_benchmark.run_turn`. A UI tier must
reuse the same scenarios and the same checks against the same stored row, or its numbers stop
being comparable to these — which would forfeit the only reason to build it.

## What the first three-harness run found

`results/20260806-200904/` — claude-haiku, pi-luna, codex-luna, local sandbox, 20 scenarios x 3
trials, 180 trials, $2.93.

| cell | one-shot | excl. harness |
|---|---|---|
| claude-haiku-local | 42% | 53% |
| pi-luna-local | 30% (35% excluding pi-unsupported rows) | 40% |
| codex-luna-local | 23% | 32% |

**`wrong_surface` was 64 of 117 failures**, on every harness: the model edits the rendered
instructions file and reports success. Nothing is stored.

**The suite contains its own natural experiment for that finding.** The skill-location sentence
already exists in the platform guidance; an instructions-location sentence does not. Splitting the
same run by what the scenario targets:

| cell | instruction-target | skill-target |
|---|---|---|
| claude-haiku-local | 0/18 one-shot, 15 `wrong_surface` | 12/21, **0** `wrong_surface` |
| pi-luna-local | 2/18, 12 `wrong_surface` | 9/21, **0** `wrong_surface` |
| codex-luna-local | 0/18, 16 `wrong_surface` | 6/21, 13 `wrong_surface` |

Where the guidance covers the action, the failure disappears. Where it does not, the failure is
near-total. That is the strongest evidence this benchmark can produce that the missing sentence is
the cause rather than a correlate — and it is worth re-running as a control whenever a guidance
sentence is added or removed.

**Codex is the exception, and not for a wording reason.** Its workspace ships bundled system
skills (`.codex/skills/.system/skill-creator`, `.../skill-installer`) documenting how to install a
skill into `.codex/skills` — exactly the folder the guidance says does not count. Codex's
`wrong_surface` skill trials carry 47 references to `.codex/skills`, 15 to skill-creator, and 7
`init_skill.py` invocations, with replies like *"I'm using the skill-installer workflow … to
install it into the configured skills location."* A sentence in an appendix does not beat a
documented procedure sitting in the model's own workspace. Fixing it is a packaging decision about
the codex home the runner assembles, not a text change.

## Notes for anyone extending this

- **MCP entries are nested** (`connection.url`, not a flat `url`), and the **hostname must
  resolve** — an outbound egress guard validates it before the run starts, so an invented
  `.example` host 500s the whole invoke before the model sees anything. Both cost a smoke run to
  learn.
- **A gated tool call appears in two wire turns** with the same `toolCallId`. Count distinct call
  ids (`bench_lib.distinct_calls`), or every approved commit counts twice and clean trials score
  as over budget.
- **Every harness names its tools differently, so never match a roster of identifiers.** Observed:
  claude `Edit`/`Write`/`Read File`/`Terminal`; pi `Edit`/`read`/`ls`/`find`/`grep`/`Bash`; codex
  `"Editing files"`, `"List files in 'x'"`, and **the shell command itself as the tool name**. The
  first classifier matched `("Edit", "Write", …)` exactly, so 31 codex trials that really did
  rewrite `AGENTS.md` were labelled `no_action` — and the taxonomy pointed at the wrong fix for an
  entire harness. Match on shape (`_EDIT_NAME_RE`, plus a mutating-command check against both the
  name and the input), and re-check any new harness against a real transcript.
- **The Pi harness rejects user MCP servers outright.** Scenarios that seed `mcps` carry
  `"unsupported_harness": ["pi_core"]` and skip there; without it the run fails before the model
  sees the task and 12 trials counted as config-editing failures that measured nothing.
- **Codex reports no usage on the wire**, so cost accounting is blind for codex cells and every
  total understates by whatever they spent.
- **`table.py` re-labels stored trials on read.** Outcome definitions will keep improving; an
  append-only history is only worth keeping if old runs can be re-read under the current one. The
  stored `results.json` is never modified.
- **`qa_matrix_lib` is imported, never copied.** It carries the `workflow_refs` parent-scoping fix,
  the assistant-message reconstruction that makes an approval reply valid, and the harness-kind
  enum gotchas. A copy drifts the day one of those is corrected.
