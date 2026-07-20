# Status

**Last updated:** 2026-07-20

## Current stage

Planning workspace drafted (context, research, design, plan). No code written, nothing
committed. Ready for team review of the open implementation questions below. Research is
grounded in the current runner code (`file:line` in research.md); the token numbers are from the
2026-07-17 investigation and are explicitly flagged for a Slice 0 re-baseline.

## Locked decisions

- Seam = the runner advertisement layer (`advertisedToolSpecs`, `services/runner/src/tools/public-spec.ts`),
  consumed at `pi-assets.ts:353` and `environment.ts:721`. Execution + permission stay below it.
- Approach = a discovery meta-toolset (`agenta_ops` + `agenta_op`) that keeps op specs private in
  runner memory and moves schemas from the prompt into on-demand tool results.
- Skills, op-catalog contents, external `discover_tools`, and non-platform tool types are out of
  scope.
- Playground overlay only — no saved/committed-agent change.
- Schema diet is complementary and lands as its own slice (Slice 1).
- Ship behind a flag, default off, until measured.
- No commits during planning; implementation is a later, separate branch.

## Open implementation questions

1. **Invoker shape** — one `agenta_op` with describe-vs-execute mode, or two tools
   (`describe_op` + `call_op`)? *Recommendation: one tool* (smaller advertised surface; the mode
   is clear from presence of `args` or an explicit `mode`).
2. **Permission fidelity** — confirm `agenta_op` execute-mode builds the gate from the TARGET
   op's private spec and runs the existing `decide()`, rather than gating the invoker as a single
   tool. *Recommendation: yes, per-op* — otherwise `commit_revision` and other writes lose their
   approval prompt. Non-negotiable in the reviewer's eyes IMO, but calling it out explicitly.
3. **Catalog summary source** — build `{op, one_line, read_only}` runner-side from the resolved
   specs (zero new wire fields) vs. thread it from `op_catalog.py`. *Recommendation: runner-side.*
4. **Disclosure-eligible identification** — heuristic (collapse all direct-`call` callback specs)
   vs. a `source:"platform"` marker on `ResolvedToolSpec` (a `protocol.ts` + `wire.py` + golden
   add). *Recommendation: heuristic for the flagged POC; marker before default-on.*
5. **Sequencing** — do Slice 1 (schema diet) and ship it independently first, or hold it and land
   the whole thing together? *Recommendation: ship Slice 1 first* — it is ~11K of the win at
   near-zero risk and is useful even if the POC needs iteration.
6. **Default-on criteria** — what pass-rate / token target gates flipping the flag (Slice 3)?
   Needs a number from the team (e.g. "no regression on the lab matrix and ≥90% token cut on a
   no-op turn").