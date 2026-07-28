# Plan

**Strategy: diet, then lazy schema.** Phases 1–2 shipped; **Phase 3 is built and stashed**,
waiting on the lab run that would justify its round trip.

| Phase | Lever | From → to | Cut | Status |
| --- | --- | ---: | ---: | --- |
| 0 | baseline | — | — | ✅ |
| 1 | diet the two fat ops | 18,353 → 6,353 | 65.4% | ✅ shipped |
| 2 | diet `query_spans` | → **5,357** | **70.8%** | ✅ shipped |
| 3 | lazy schema | → 3,290 measured | 82.1% | ⏸ **stashed** |
| 4 | measure | — | — | ✅ |

**Lazy activation is out of scope.** Not a later phase — it is not in this plan at all until
explicitly asked for. Record: [alternatives.md](alternatives.md#3--lazy-activation-out-of-scope).

---

## Phase 0 — Baseline ✅

1. ~~Measure per-op cost.~~ [baseline.md](baseline.md): 18,353 total, top 3 ops = 88%, one
   duplicated schema object = 70%.
2. ~~Confirm the live set.~~ All 13 ops advertise; `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` defaults
   **on** (`platform_tools.py:41`).
3. ~~Add a **resolution-path** test.~~ `advertisedToolSpecs` is a pure `specs.map(...)`, so asserting
   every input appears in its output is a tautology. Instead exercises platform resolution with the
   handler flag explicitly on and off, asserting the live advertised set (13 ops / 12 ops):
   `api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py` — three tests pinning the
   handler-mode op set, 13 ops resolved across `unset`/empty/on values, and 12 across every
   disable value. Mutation-checked: forcing handlers always-on fails all 9 disable cases; making
   the flag default-off fails the `unset` case (the correction [baseline.md](baseline.md) records).

**Exit:** ✅ items 1–2 recorded; resolution-path test green (`24 passed`).

## Phase 1 — Diet the duplicated schema ✅

**Delivered: 18,353 → 6,353 (65.4%).** `commit_revision` 6,878 → 878 (−87%), `test_run`
7,777 → 1,777 (−77%).

1. ~~Stop expanding `_build_agent_template_delta_schema()` inline.~~ `_shallow_schema(node,
   max_depth)` in `op_catalog.py` projects the agent-template delta to its top-level keys plus
   one-line summaries and a pointer to `references/config-schema.md`. Written as a generic depth
   limit, so Phase 3 reuses it. The full schema is retained as
   `_AGENT_TEMPLATE_DELTA_SCHEMA_FULL` — it is what a lazy `load_op` hands back.
2. ~~Update the contract tests and goldens.~~ `test_op_catalog.py` (52 tests). New cross-language
   golden `golden/advertised_op_schemas.json`, asserted by Python and read by the runner tests —
   the same anchor pattern as the `/run` wire contract.
3. ~~Re-measure.~~ Drop of 12,000, not the predicted ~12,900: the projection is not free, it costs
   441 tokens and is still embedded twice (882). The ~5,500 estimate assumed the schema collapsed
   to nothing.
4. Lab check — deferred to Phase 4 (needs a live stack).
5. ~~Assert the depth limit only removes constraints.~~ Statically (collapsed nodes carry only
   `type` + `description`), behaviorally (a deep config validates under **both** the shallow and
   the full schema), and on both harness paths: Pi (`extension-tools.test.ts` — a deep config
   passes validation and reaches the gate) and MCP (`tool-bridge.test.ts` — `tools/list` advertises
   no constraint that could reject it).

**The "known cost" was wrong — there is none.** Nested `required` was expected to stop being
checked. It cannot: `_deep_partial_schema` already strips *every* `required` from the
agent-template delta (a delta is a deep partial), and the projection touches nothing outside that
subtree. Pinned by `test_the_diet_drops_no_required_argument_check` — the advertised schema's
`required` paths are identical to the pre-diet schema's, for both ops.

**One behavior change, in the safe direction.** The full schema closed every nested object
(`additionalProperties: false`), so a config using an unmodelled field was rejected *in the
harness* — though the commit endpoint does not validate the shape at all. Those payloads now reach
the server, the actual authority. Pinned by
`test_the_advertised_schema_no_longer_rejects_unmodelled_nested_keys`.

**Exit:** ✅ 6,353; SDK 1,840 + API 1,370 + runner 1,205 tests green.

## Phase 2 — Trim `query_spans` ✅

**Delivered: 6,353 → 5,357 (70.8% cumulative).** `query_spans` 1,578 → 582 (−63%); its schema
alone 1,463 → 486.

The `$defs` block is gone. The DSL moved to `references/span-queries.md`, a new `SkillFile` on
`BUILD_AN_AGENT_SKILL` (on-demand, so it costs nothing per turn), and the five arguments are
advertised as open objects. `filtering` and `windowing` keep the *vocabulary* in prose — every
operator name and the condition shape — so the common verification query still needs no file read.

**The numeric target was optimistic; the lever was not.** ~3,000 was never reachable by dieting
`query_spans`: its whole schema was 1,463, so even collapsing it to zero from Phase 1's 6,353 lands
at ~4,900. What remains is spread across ops the diet does not touch — chiefly `test_run`'s
`inputs.messages` type-ref expansion (922 tokens, the largest single item left) and the shallow
agent schema still embedded twice (882). Phase 3 stubs all of it.

**The trim made a contract test stronger.** `test_query_spans_op_contract.py` compared the op's
`$defs` to the endpoint model's. Prose cannot be type-checked, so it now asserts the *vocabulary*:
every operator and field `SpansQueryRequest` accepts must appear in the advertised description or
the reference. Mutation-checked — dropping `in`/`not_in` from the description fails it.

**Exit:** ✅ 5,357 (target ~3,000 not met — see above); SDK 1,845 + API 1,373 + runner 1,205 green.

## Phase 3 — Lazy schema ⏸ STASHED

**Built and measured at 5,357 → 3,290 (82.1% cumulative), then removed from the tree.** The code is
recoverable in full ([results.md](results.md#phase-3-stashed)); nothing below is in the working
tree today.

**Why it is held back.** It shipped once, failed its first lab trace, and was fixed — but the fix
is only unit-proven. The remaining question is behavioral (does a live model call `load_op` rather
than guess?), and no run has answered it. Phases 1–2 carry 70.8% with no round trip and no new
concept, so they ship alone while Phase 3 waits for evidence.

**The trace that stopped it: it first shipped at 1,691 / 90.8% and failed live.** The threshold was 400 characters, which
deferred 9 of 13 ops including several worth ~100 tokens; the model called `discover_tools` with
invented arguments and with the stub's instruction text as a field name. Four fixes — a 2,000-char
threshold, a stub that carries top-level `required`, a literal `load_op({"op": "…"})` call form,
and errors that name that call — traded 1,599 tokens for seven fewer tools that can be guessed at.
Full account: [results.md](results.md#what-the-lab-trace-changed).

New module `services/runner/src/tools/lazy-schema.ts`.

1. ~~Stub the advertised schema.~~ `advertisedInputSchema(spec)` returns a stub for a deferred
   spec — the top-level `required` names and their types, and nothing below. Wired at all **three** advertisement sites — `advertisedToolSpec`
   (`public-spec.ts`, which feeds Pi and the Daytona stdio shim) and `tool-mcp-http.ts`'s
   `tools/list`, which reads the spec directly and would otherwise have kept advertising in full.
   The research doc listed two sites; there are three.
2. ~~Add `load_op(op)`.~~ Synthesized in `buildRunPlan`, so the advertisement, the MCP index, the
   Pi registration, the permission gate, and the relay's name index all see one tool set. Answered
   **in the relay** (`relay.ts`), the only place holding every private spec — so one implementation
   serves Pi, local MCP, and the stdio shim, and no deferred schema is ever shipped into the
   sandbox. Its description carries the index of what can be loaded.
3. ~~Stub shape, client tools exempt.~~ A strict subset of the private spec's constraints, so it
   can never reject a call the relay would run — but not empty, which the first version was and
   which invited the guess the lab trace produced. Client tools are exempt by `kind`, not size.
4. ~~Skill line.~~ In `_BUILD_AN_AGENT_BODY`, next to the other reference pointers.
5. ~~Tests.~~ 33 (`lazy-schema.test.ts`, `lazy-schema-relay.test.ts`, plus the Pi and MCP path
   tests): same approval verdict at the real `decide` gate across all four policy defaults, `$ctx`
   still bound on the executed spec, a deep payload accepted on both paths, missing-required
   errors from the relay naming the field, unknown/missing `op` erroring cleanly, and the kill
   switch restoring full advertisement. Mutation-checked: disabling deferral fails 11 of them.

**Deferral is decided by SIZE, not an op allowlist** (>2,000 chars of schema) — so a new fat op
becomes lazy with no list to maintain. The threshold is a **turn** budget, not a token budget: a
schema worth ~100 tokens is not worth a model turn at any cache-hit rate, which is what the first
400-char version got wrong.

**Why 3,290 and not ~500.** Two things. What survives the stubbing is almost entirely the
*descriptions*, which this plan deliberately keeps eager so tool choice never needs a round trip
(917 tokens). And the threshold now leaves eleven schemas inline on purpose. ~500 was only
reachable by deferring descriptions too — a different, worse trade.

**No regression:** tool names are unchanged, so every permission gate is untouched. The private
spec is untouched, so the relay still enforces required arguments and binds `$ctx`. The stub
constrains a strict subset of the private spec, so it can never reject what the relay would run.

**Cost:** one extra round trip per distinct deferred tool used — now at most two per run.

**Exit:** ✅ 3,290 tokens; runner 1,237 tests green, `tsc --noEmit` clean; kill switch
`AGENTA_AGENT_LAZY_TOOL_SCHEMAS` (defaults on).

## Phase 4 — Measure ✅

1. ~~Tokens, flag on vs off.~~ All four lever combinations, reproducible with
   [`measure.py --all`](measure.py). **18,353 → 3,290 (82.1%).** The finding that matters: with
   lazy schemas on, the diet contributes **nothing** to the per-turn advertisement — but it is what
   makes a `load_op` response cost 875 tokens instead of 6,875, and it cuts the private specs on
   the `/run` wire by 74%. Both levers stay on.
2. Lab / release-gate pass rate — **one trace run; it failed and drove the Phase 3 revision above.**
   A confirming run is still outstanding. What to run and what to watch for:
   [results.md](results.md#not-done).
3. ~~`results.md`; decide default-on.~~ Both default on;
   `AGENTA_AGENT_LAZY_TOOL_SCHEMAS` is the kill switch.

**Exit:** ✅ measured and recorded in [results.md](results.md), minus the live run.

## Not in this plan

Lazy activation, card/menu invoker, op-set curation, turn-boundary activation, SSE + session ids,
mode-gating — all weighed and closed. Reasons and win comparison:
[alternatives.md](alternatives.md).
