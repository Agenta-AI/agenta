# Plan — sliced implementation

## Scope now

- Behind a flag/env (default OFF) so the disclosed path A/B's against today's always-advertise
  path before it becomes default.
- Playground platform ops only; no saved-agent change; no committed-agent behavior change.
- The schema diet (Slice 1) is independently shippable and lands first.
- Each slice leaves the tree working and testable. Order: baseline → diet → mechanism → measure.

## Slice 0 — Baseline (pin the real cost)

1. Write a measurement script (tiktoken `o200k_base`) that resolves the default build-kit overlay
   and reports per-op advertised token cost + total, using the same `advertisedToolSpecs`
   projection the runner ships (or a faithful mirror).
2. Confirm which ops actually advertise live today — resolve with `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`
   off, and record whether `test_run` is in the advertised set.
3. Add a runner unit test asserting the current behavior: every resolved platform op appears in
   `advertisedToolSpecs(plan.toolSpecs)`. This is the invariant later slices intentionally flip.
4. Check a `baseline.md` table into this folder (before-numbers, per op).

**Exit:** `baseline.md` exists with per-op numbers; the "all platform ops advertised today" test
passes on `main`.

## Slice 1 — Schema diet (large, low-risk win, independent)

1. In `op_catalog.py`, replace the embedded agent-template delta schema in `commit_revision`
   (and `test_run`) with an open object (`{"type":"object"}`) plus a description pointing at the
   skill's `references/config-schema.md`.
2. Update the platform-op / wire contract tests that pin those schemas.
3. Re-run the Slice 0 script; record the drop (expect ~11K).
4. Lab check: an agent can still `commit_revision` with a valid config (the model has the shape
   from the skill reference, and the server still validates).

**Exit:** measured total drops by ~11K; contract tests green; a lab run commits a revision
successfully.

## Slice 2 — Disclosure mechanism (the POC), flagged

1. Add the flag/env (default off) that turns disclosure on for a run.
2. Introduce a disclosure transform applied to the advertised set at the two call sites
   (`pi-assets.ts:353`, `environment.ts:721`): when on, replace the disclosure-eligible specs
   (see design "Identifying the disclosure-eligible set" — heuristic for the POC) with the two
   meta-tools `agenta_ops` + `agenta_op`; keep client tools and everything else advertised.
   `plan.toolSpecs` / `toolSpecsByName` stay complete.
3. Implement the invoker dispatch: `agenta_ops` returns `{op, one_line, read_only}` built
   runner-side from the resolved specs; `agenta_op` describe-mode returns one op's input schema;
   `agenta_op` execute-mode builds the gate from the TARGET op's spec, runs `decide()`, then
   `assembleBody`/`directCallUrl`/`callDirect` (reuse the `executeRelayedTool` core).
4. Unit tests: (a) with the flag on, only the meta-tools + client tools are advertised; (b) the
   full private specs remain in `toolSpecsByName`; (c) per mutating op (`commit_revision`,
   `create_schedule`, `remove_*`), `agenta_op` execute-mode produces the SAME approval verdict as
   a direct call — no approval regression; (d) `$ctx` binding still fills server-side (the model
   cannot retarget); (e) describe-mode has no side effect and no approval.
5. Add the one-line nudge to the `build-an-agent` skill.

**Exit:** flag on → a lab run completes discover → wire → commit → schedule using only the
meta-tools; every mutating-op approval test passes; `tsc` + `pnpm test` green in `services/runner`.

## Slice 3 — Measure, decide default, scope M2

1. Re-run the Slice 0 script with the flag on; record the no-op turn cost (target: low hundreds).
2. Run the build-an-agent lab / release gate with the flag on vs off; compare pass rate and
   "wander" failures.
3. Write a `results.md` comparison (tokens + reliability, before/after).
4. Decide: flip default on? And is M2 (dynamic real-name advertisement) worth it for the ops that
   most benefit from schema-validated calls?

**Exit:** `results.md` checked in with the before/after; a go/no-go recommendation on
default-on and on M2.

## Not in this plan

- Marker-based eligibility (Slice 2 uses the heuristic); adding a `source:"platform"` wire marker
  is a follow-up if we default-on for gateway/reference too.
- Disclosing gateway/code/client/MCP tools.
- M2 dynamic advertisement implementation.
