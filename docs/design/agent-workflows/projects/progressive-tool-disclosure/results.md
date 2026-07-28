# Results — measured 2026-07-28

**Phases 1–2 shipped. Phase 3 (lazy schema) is built, measured, and stashed** — see
[Phase 3 stashed](#phase-3-stashed). Everything under "Headline" is what is in the tree today.
Reproduce it with [`measure.py --all`](measure.py) (tiktoken `o200k_base`, the same encoder and the
same `{name, description, inputSchema}` projection as [baseline.md](baseline.md)).

## Headline

**18,353 → 5,357 advertised tokens per turn: a 70.8% cut.** That is what a run pays before the
model does anything.

| Lever | Advertised | Cut from baseline |
| --- | ---: | ---: |
| baseline (2026-07-26) | 18,353 | — |
| Phase 1 — agent-template diet | 6,353 | 65.4% |
| Phase 2 — `query_spans` DSL trim | **5,357** | **70.8%** |
| *Phase 3 — lazy schema (stashed)* | *3,290* | *82.1%* |

Per op, shipped vs baseline:

| op | before | after | cut |
| --- | ---: | ---: | ---: |
| `test_run` | 7,777 | 1,777 | 77% |
| `commit_revision` | 6,878 | 878 | 87% |
| `query_spans` | 1,578 | 582 | 63% |
| `create_schedule` | 425 | 425 | — |
| `create_subscription` | 393 | 393 | — |
| `discover_triggers` | 356 | 356 | — |
| `annotate_trace` | 333 | 333 | — |
| `discover_tools` | 204 | 204 | — |
| `test_subscription` | 188 | 188 | — |
| `remove_schedule` | 69 | 69 | — |
| `remove_subscription` | 69 | 69 | — |
| `list_deliveries` | 46 | 46 | — |
| `list_schedules` | 37 | 37 | — |

The diet also cut the private specs riding the `/run` wire from **16,187 to 4,187 (74%)** — paid
once per run rather than per turn, but real.

## Phase 3 stashed

Lazy schema is not in the tree. It was built, it measured 82.1%, its first lab trace failed, and
the four fixes that followed are unit-proven but not lab-proven. The open question is behavioral —
**does a live model call `load_op` instead of guessing?** — and no run has answered it. Phases 1–2
deliver 70.8% with no round trip, no new tool, and no new concept, so they ship alone.

**What was removed:** `services/runner/src/tools/lazy-schema.ts` and its two test files; the
`advertisedInputSchema` wiring in `public-spec.ts`, `tool-mcp-http.ts`, `run-plan.ts`; the `load_op`
interception and hinting in `relay.ts`, `spec-schema.ts`, `extensions/agenta.ts`; the Phase 3 tests
inside `extension-tools.test.ts` and `tool-bridge.test.ts`; and the `load_op` paragraph from the
`build-an-agent` skill body. The Phase 1 tests in those two runner test files stayed.

**To restore:** apply `phase3-lazy-schema.patch` (see the project scratch directory recorded when
it was stashed), or `git stash pop` the entry labelled `phase3-lazy-schema`. Everything below this
section documents that stashed work and the trace that shaped it — it is a record, not a
description of the current tree.

---

## What the lab trace changed


The first live run of the shipped code failed, and it failed at the cheapest thing being deferred.
Four things were wrong; all four are fixed.

**1. The threshold was a token budget, not a turn budget.** At 400 characters, 9 of 13 ops
deferred — five of them with schemas worth under 210 tokens. `discover_tools` (455 chars, 124
tokens) traded a whole model turn for ~90 tokens, which is a bad deal at any cache-hit rate. The
threshold is now **2,000 characters**, which defers only the two ops whose schemas actually
dominate:

| threshold | advertised | deferred | cut |
| ---: | ---: | ---: | ---: |
| 400 (first ship) | 1,691 | 9/13 | 90.8% |
| 800 | 2,013 | 6/13 | 89.0% |
| **2,000 (now)** | **3,290** | **2/13** | **82.1%** |

Giving back 1,599 tokens to remove seven tools' worth of round-trip risk is the trade this project
should have made from the start: the remaining 8.7 percentage points were the *cheapest* schemas,
so they cost the most turns per token saved.

**2. The stub invited the guess it was supposed to prevent.** It was `{type, description}` — no
`properties`, no `required` — on the reasoning that a permissive advertisement can never reject a
call the private spec would accept. True, and beside the point: a model reads "no required fields"
as "any object is valid". The stub now carries the real schema's **top-level `required` names and
their types** — a handful of tokens, since the deferred bulk is the tree underneath — so the
advertisement itself rejects a guess and names the field. It is still a strict subset of the
private spec's constraints, so the original safety property holds.

**3. Prose in the arguments slot was read as schema.** The description said *"call `load_op` for
this tool's schema"*, and the model sent `{"load_op": "discover_tools", ...}` — the instruction as
a field name. It now spells out a literal call that cannot be misread as a key, with the tool's own
name in it: ``Call load_op({"op": "commit_revision"}) …``.

**4. The error offered no way back to the schema.** `missing required argument(s): use_cases.
Retry with those fields populated` invites a second guess from a model that has never seen the
schema. For a deferred tool the error now names the load that fixes it, on **both** enforcement
paths — the relay (`relay.ts`) and the Pi extension's pre-gate check (`extensions/agenta.ts`,
which holds only the public spec and detects deferral from the stub).

**Also fixed, found while auditing rather than in the trace:** `load_op` is intercepted by the
relay unconditionally, but `withLoadOpTool` used to return the spec list *untouched* when a run
already had a tool of that name — so a run's own `load_op` would be silently swallowed, returning
a schema instead of executing, with no error anywhere. The name is now genuinely reserved: a
collision throws at plan time, with or without the kill switch.

## The levers are complementary, but not in the way the plan assumed

The plan sequenced the diet first and lazy schema second, each with its own token target. Measured
across all four flag combinations, they do not compose the way that framing suggests:

| diet | lazy | advertised |
| --- | --- | ---: |
| off | off | 17,357\* |
| off | **on** | **3,290** |
| **on** | off | 5,357 |
| **on** | **on** | **3,290** |

\* `--no-diet` reconstructs Phase 1 only — Phase 2 deleted the `query_spans` `$defs` from the
source, so there is nothing left to put back. The true baseline is the measured 18,353.

**With lazy schemas on, the diet contributes nothing to the per-turn number** — the stub replaces
the schema either way. If the per-turn advertisement were the only cost, Phases 1–2 would be
redundant.

It is not the only cost. The diet pays on two other axes:

| | pre-diet | shipped | cut |
| --- | ---: | ---: | ---: |
| `load_op("commit_revision")` response | 6,875 | 875 | 87% |
| `load_op("test_run")` response | 7,774 | 1,774 | 77% |
| private specs on the `/run` wire | 16,187 | 4,187 | 74% |

So the diet is what makes laziness *affordable*. Without it, the first `load_op("commit_revision")`
would cost 6,875 tokens — more than a third of the entire original per-turn bill, paid on demand
instead of eagerly, which is a worse trade than it sounds for an agent that commits more than once.
With it, a load costs 875.

**Both levers were on when this was measured.** Phase 3 has since been stashed; the diet
remains, and it is what would make laziness affordable whenever Phase 3 returns.

## Against the plan's estimates

| Phase | Estimated | Delivered | Why the gap |
| --- | ---: | ---: | --- |
| 1 | ~5,500 | 6,353 | The estimate assumed the collapsed schema cost nothing. It costs 441, embedded twice. |
| 2 | ~3,000 | 5,357 | Unreachable by this lever: `query_spans`' whole schema was 1,463, so even deleting it entirely lands near 4,900. |
| 3 | ~500 | 3,290 | Two compounding reasons. With schemas gone the remainder is the *descriptions* (917 tokens), which this plan deliberately keeps eager. And the threshold was then raised so that only genuinely fat schemas defer — deliberately giving back 1,599 tokens. |

The estimates were optimistic, not wrong in direction: every one of them assumed the residue after
a lever was ~0. The shape of the win held — concentration was real, and one projection site did
cover every harness.

**The Phase 3 estimate was also asking the wrong question.** It priced the advertisement and
nothing else. A deferral that saves 90 tokens and costs a model turn is a loss no token table can
show, which is why the first ship measured well and then failed live.

## What the work cost

| | files | tests |
| --- | --- | ---: |
| SDK (Python) | `op_catalog.py`, `agenta_builtins.py` | 1,845 |
| API (Python) | contract test rewritten | 1,373 |
| Runner (TypeScript) | Phase 1 advertisement tests only, after the Phase 3 removal | 1,205 |

All green; `tsc --noEmit` clean. Every phase's guard was mutation-checked — reverting the change
fails the tests that claim to protect it (9 for the handler flag, 7 for the diet, 1 for the DSL
vocabulary, 11 for lazy schemas). The post-trace fixes were mutation-checked the same way:
restoring the 400-char threshold fails 1, restoring the constraint-free stub fails 5, restoring the
silent name collision fails 1, and dropping the `load_op` hint from the error fails 2.

## Behavior changes, stated plainly

1. **The diet loses no required-argument enforcement.** The plan expected to lose nested `required`
   inside the collapsed subtree. It does not: `_deep_partial_schema` had already stripped every
   `required` from the agent-template delta, and the projection touches nothing else. Pinned by
   `test_the_diet_drops_no_required_argument_check`.
2. **Unmodelled nested config keys are no longer rejected in the harness.** The full schema closed
   every nested object, so a config using a field the catalog type had not modelled failed before
   the server saw it — even though the commit endpoint never validated that shape. Those payloads
   now reach the server, which is the actual authority.
3. **A malformed call to a deferred tool is caught in the harness, on the same turn.** The stub
   carries the private spec's top-level `required`, so a guessed payload is rejected before the
   permission gate — no human is asked to approve a call that cannot execute, and no relay round
   trip is spent. A payload that gets past the stub is checked again at the relay against the full
   private spec, exactly as before. Both errors name the `load_op` call that produces the schema.
4. **Permissions are untouched.** Tool names are unchanged, so `readOnlyHint`, spec permission,
   name-matched rules, and the `allow_reads` default all see what they saw before — asserted
   against the real `decide` gate across all four policy defaults. `load_op` is `readOnly`, so it
   never prompts under `allow_reads`.
5. **`load_op` is a reserved tool name.** A run whose own tools claim it fails at plan time rather
   than having that tool silently swallowed by the relay's interceptor.

## Flags

The diet has no switch — it is the catalog's shape now, and it is the only lever in the tree.
`AGENTA_AGENT_LAZY_TOOL_SCHEMAS` went with the stashed Phase 3 and does not exist today.

## Not done

**The second lab run — now the gate on unstashing Phase 3.** The first one found the failure the
fixes address; nothing has re-driven a live model since, which is exactly why Phase 3 is stashed
rather than shipped. Everything asserted above is static or
unit-level — including, unavoidably, the claim that the model will now call `load_op`. Unit tests
can prove the advertisement rejects a guess and that the error names the way out; only a live run
shows whether the model takes it.

What to run, once a stack is up: the `agent-release-gate` skill, which drives the same product
endpoint the playground drives and asserts on the SSE frame stream and real side effects. Watch
for:

- whether `load_op` is called before `test_run` / `commit_revision`, and how often a guess still
  precedes it;
- whether a guess now recovers in one retry (the error names the load) instead of looping;
- whether the shorter one-line descriptions still steer it to the right config fields.

**Also unmeasured: prompt caching.** Tool definitions sit in the cacheable prompt prefix, and the
runner records `cacheRead` / `cacheWrite` (`tracing/otel.ts:586`), so on turn 2+ of a session these
tokens are served at a fraction of list price while the `load_op` round trip is paid fresh. The
per-turn figures above are gross, not net. They are still the right target for the short sessions
this project started from — a "hi" that costs 15K — where caching helps least.

**Unrelated failure seen in the same trace:** a `read` of
`references/trigger-inputs.md` returned ENOENT inside the sandbox, although the file is registered
on `BUILD_AN_AGENT_SKILL` (`agenta_builtins.py:818`) and has its own test asserting its content.
Skill reference files are not reaching the sandbox. Predates this project; tracked separately.

**Wander.** [alternatives.md](alternatives.md) closes lazy *activation* on the grounds that its
case rests on tool count, which is asserted rather than measured. Nothing here changes that: tool
count is unchanged (+1, for `load_op`). Still open, still not blocking.
