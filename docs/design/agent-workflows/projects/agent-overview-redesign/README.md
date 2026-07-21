# Agent Overview redesign

**Status:** Planning (design workspace only — no implementation)
**Date:** 2026-07-21

Redesign the agent Overview page so it shows an agent's *work* instead of the
prompt-management views it inherited (deployments, variants, evaluations). The page is
organized around three questions — **does it need me?**, **what has it been doing?**, **is
it healthy?** — and handles the empty/no-data state and fresh-agent onboarding as
first-class states, not afterthoughts. This workspace names the views and data (each
grounded in a verified backend source) and slices the implementation; it does not prescribe
the visual design.

## Decisions

- Replace prompt-era Overview views with agent-native ones, gated by workflow kind.
- Organize around three questions; lead with work (outcomes + produced artifacts), not
  config.
- Keep the charts; relabel Requests → Runs.
- Surface resource usage as a first-class group — context usage (how full the model's
  window gets), token consumption, cache savings, cost per run — mapped to three personas
  (owner, builder, budget owner).
- Reuse PR #5402's context-budget primitive (Arda) for context usage — occupancy measure,
  shared `MODEL_CONTEXT_WINDOWS` map; don't fork it.
- Phase 1 composes existing data only (tracing, mounts, session interactions, triggers);
  no new backend endpoints.
- Artifacts load lazily per row; file-less runs degrade to message output.
- Three distinct zero states; new agents get onboarding, not zeroed charts.
- Name views/data here; leave layout/visuals to design.

## Deliverables

- [context.md](context.md) — problem, scope, non-goals, product language, success
  criteria.
- [research.md](research.md) — current wiring and the verified backend data sources, with
  `file:line`.
- [design.md](design.md) — the view catalog, empty-state behavior, and onboarding flow.
- [plan.md](plan.md) — sliced implementation (Slice 0–5) with exit checks.
- [status.md](status.md) — living source of truth: locked decisions + open questions.

## Intended outcome

Opening an agent's Overview, a user immediately sees whether it needs them, what it has
produced (plain-language outcomes and downloadable artifacts), and whether it is healthy —
with drill-down to traces, tools, and token detail available but never forced. A
brand-new agent sees a short onboarding path to its first successful run and first trigger
instead of a wall of zeros.
