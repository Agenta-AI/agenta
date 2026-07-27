# Plan

**Strategy: diet, then lazy schema.** That is the whole plan — 97% of the token bill, no permission
change, no transport work, all three harnesses.

| Phase | Lever | From → to | Cut | Effort |
| --- | --- | ---: | ---: | --- |
| 0 | baseline | — | — | done |
| 1 | diet the two fat ops | 18,353 → ~5,500 | 70% | 1 Python file |
| 2 | diet `query_spans` | ~5,500 → ~3,000 | 84% | same file |
| 3 | lazy schema | ~3,000 → ~500 | 97% | 1 runner function |
| 4 | measure | — | — | — |

**Lazy activation is out of scope.** Not a later phase — it is not in this plan at all until
explicitly asked for. Record: [alternatives.md](alternatives.md#3--lazy-activation-out-of-scope).

---

## Phase 0 — Baseline ✅

1. ~~Measure per-op cost.~~ [baseline.md](baseline.md): 18,353 total, top 3 ops = 88%, one
   duplicated schema object = 70%.
2. ~~Confirm the live set.~~ All 13 ops advertise; `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` defaults
   **on** (`platform_tools.py:41`).
3. Add a **resolution-path** test. `advertisedToolSpecs` is a pure `specs.map(...)`, so asserting
   every input appears in its output is a tautology. Instead exercise platform resolution with the
   handler flag explicitly on and off, and assert the live advertised set (13 ops / 12 ops).

**Exit:** items 1–2 recorded; resolution-path test green on `main`.

## Phase 1 — Diet the duplicated schema

**Win: 18,353 → ~5,500 (70%).** The single biggest step, and the cheapest.

1. In `op_catalog.py`, stop expanding `_build_agent_template_delta_schema()` inline into
   `commit_revision` and `test_run`. Emit a shallow schema (top-level keys + one-liners, no nested
   `$defs`) plus a pointer to `references/config-schema.md`. Implement as a depth limit so Phase 3
   reuses it.
2. Update the contract tests and goldens pinning those schemas.
3. Re-measure (expect ~12,900 drop).
4. Lab check: an agent still commits a valid config and `test_run` verifies it.
5. Assert the depth limit only *removes* constraints: no `additionalProperties: false` and no new
   `required` on a collapsed node. Test a deeply nested valid config through **both** the Pi and MCP
   paths and confirm it is not rejected pre-relay.

**Known cost:** nested `required` inside the collapsed subtree stops being checked, because the diet
changes the private spec too. Top-level required fields still are. Accepted because the commit
endpoint does not validate the config shape either.

**Exit:** total ~5,500; tests green; a lab run commits and tests successfully.

## Phase 2 — Trim `query_spans`

**Win: ~5,500 → ~3,000 (84% cumulative).** Ends the token problem without touching the runner.

Shallow the filtering-DSL `$defs` in `_QUERY_SPANS_INPUT_SCHEMA` (1,463 → ~300), pointing at prose
for the DSL. Re-measure.

**Exit:** under ~3,000 total.

## Phase 3 — Lazy schema

**Win: ~3,000 → ~500 (97% cumulative).** Also the structural fix: after this a new op costs its
index entry (~12 tokens), not its schema. Discovery stays eager, so the index still grows linearly;
what stops is *schema* growth.

1. In `advertisedToolSpecs` (`public-spec.ts:57`), project a **stub** schema for platform ops
   instead of the full one. One site — all three harnesses inherit it.
2. Add a `load_op(op)` tool that returns the full schema as its result. Its description carries the
   op index (names + one-liners), so discovery is never a round trip.
3. Keep the stub permissive: `{type: "object"}`, no `required`, no `additionalProperties: false`.
   Client tools (`request_connection`, `request_input`) are **not** stubbed — the browser fulfils
   them and they are cheap.
4. One line in the `build-an-agent` skill about `load_op`.
5. Tests: an op executes with the **same** approval verdict as today; `$ctx` still binds
   server-side; a valid deeply-nested payload passes on both the Pi and MCP paths; a call missing a
   required arg errors from the relay naming the field, not from the server; an unknown `op` errors
   cleanly.

**No regression:** tool names are unchanged, so every permission gate is untouched. The private
spec is untouched too, so the relay still enforces the full schema including nested `required`.
Enforcement moves from harness-side to runner-side, both pre-execution.

**Cost:** one extra round-trip per distinct op used.

**Exit:** ~500 tokens; a lab run completes discover → wire → commit → schedule, loading schemas on
demand, with no permission code changed.

## Phase 4 — Measure

1. Session-level tokens (not a no-op turn), flag on vs off.
2. Lab / release-gate pass rate and wander failures.
3. `results.md`; decide default-on.

## Not in this plan

Lazy activation, card/menu invoker, op-set curation, turn-boundary activation, SSE + session ids,
mode-gating — all weighed and closed. Reasons and win comparison:
[alternatives.md](alternatives.md).
