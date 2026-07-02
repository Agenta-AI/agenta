# Status

**State:** DESIGN ONLY. Not implemented, not merged. Under review on draft PR #4999
(`feat/annotate-trace-op`, base `big-agents`).

**Date:** 2026-07-01

## What is done

- Confirmed the annotations plumbing is ready: `POST /api/annotations/` works, and the run's
  own `trace_id`/`span_id` are captured and bindable via `$ctx.trace.*`. Only the catalog op
  was missing.
- Resolved the evaluator question. The project-seeded `quality-rating` default exists but its
  schema is a rigid `{approved: boolean}` thumbs, unfit for reflection. We reserve one
  dedicated evaluator, slug `agent-self-reflection`, with a **structured** outputs schema
  (`reflection` string, `score` binary good/bad, `meta` open object), bound server-side. The
  structure is enough to render in the annotation UI and to filter runs by success, and the
  `meta` object carries whatever extras a run wants. See [plan.md](plan.md) §1.
- Decided materialization: seed the reserved evaluator on project creation exactly like
  `quality-rating` (a preset plus a `_DEFAULT_EVALUATORS` entry) **and** ship a backfill
  migration for existing projects. We do not auto-create it at annotation time; the build-agent
  skill carries the create-it-yourself fallback instead.
- Made the self-target airtight in plain terms: the runner clears the whole `links` subtree the
  model sent, then refills only the two bound leaves from run context, so no smuggled sibling
  link survives. Same clear-then-refill for the evaluator `references`. See [plan.md](plan.md)
  §2.
- Wrote the op shape (model supplies `data.outputs` only), the permission default (`allow`),
  and the phases.

## Open question (one, minor)

- **Upsert vs append.** Should repeated `annotate_trace` calls on the same trace upsert (edit
  the one existing self-reflection annotation) rather than append a new one each time? Lean:
  **append**, because each reflection is a distinct record and reads naturally as its own row
  in the annotation UI. Upsert is worth keeping as an option to bound a runaway loop that would
  otherwise spam annotations on its own trace (the annotations API supports edit by
  trace/span). This is a rate/idempotency choice, not a permission one.

## Notes and residual wrinkles

- **Data-shape convention.** The `quality-rating` preset schema describes `data` directly as
  `{approved}`, while the annotation convention (and this op) wraps content in `data.outputs`.
  The reserved evaluator's stored schema must match the `data.outputs` shape the op actually
  sends, so the two stay consistent. The pre-existing `quality-rating` inconsistency is
  orthogonal and flagged for the annotations team.
- **Single vs multiple categories.** MVP is one reserved evaluator. A later fixed set (quality,
  safety) becomes additional reserved evaluators or a bound-from-config choice, never
  free-invented slugs.

## Cross-references

- Parent project: [builder-agent-reliability](../README.md) (use case 3).
- Research source: [`../../../scratch/console/builder-kit/findings/annotation.md`](../../../scratch/console/builder-kit/findings/annotation.md).
- Documented gap: `../build-notes.md` (case 3, the porting recommendation).
