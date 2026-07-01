# `annotate_trace` platform-op

A design-only workspace for one catalog op that lets a self-reflecting agent grade its own
run. After a conversation, the agent writes a short reflection back onto the trace it just
produced, and that reflection surfaces in the annotation and evaluation views like any other
annotation. This is use case 3 of [builder-agent-reliability](../README.md).

The plumbing already exists (`POST /api/annotations/`, plus the run's own trace bindable via
`$ctx.trace.*`). The design work is one hard question the naive cut skipped: an annotation must
reference an evaluator, and the evaluator decides whether the agent's reflection is even
accepted. This workspace resolves where the evaluator comes from, then locks the self-target
around that answer.

## Files

- [context.md](context.md), why this exists, the case-3 self-reflection use case, goals and
  non-goals, and the background (no agent-callable annotate op existed).
- [research.md](research.md), the read-only trace: the evaluator investigation (the
  project-seeded `quality-rating` default and why its rigid schema cannot hold reflection), how
  the annotations API validates payloads against the evaluator schema, the runner's advisory
  arg validation (`relay.ts:211`), and the two self-target smuggle routes. With file/line
  citations.
- [plan.md](plan.md), the chosen design: one reserved self-reflection evaluator with a
  structured schema, seeded per project and backfilled by migration, bound server-side;
  airtight self-targeting by clearing and refilling the whole `links` and `references` subtrees;
  the op shape, the permission default, and the phases.
- [status.md](status.md), current state (design under review on PR #4999) and the one remaining
  open question.

## TL;DR

- **The op:** `annotate_trace` wraps `POST /api/annotations/`. The model supplies only
  `data.outputs` (the reflection content). The server binds the trace and the evaluator.
- **The evaluator:** one reserved `agent-self-reflection` evaluator with a small structured
  schema (a `reflection` string, a binary `score` to filter runs by success, and an open `meta`
  object for extras), seeded on project creation like `quality-rating` plus a backfill migration
  for existing projects, bound server-side. The model never names it. `reflection` and `score`
  render in the annotation UI; `meta` is stored but not drawn as a form control.
- **The self-target:** the server clears and refills the whole `links` and `references` subtrees
  (delete then set), so a smuggled sibling `links` key or a `references.evaluator.id` cannot
  retarget another trace or evaluator. The runner does not validate model args, so the closed
  schema alone is only advisory.
- **Permission:** `allow`, no approval. Additive self-metadata on the agent's own trace.
