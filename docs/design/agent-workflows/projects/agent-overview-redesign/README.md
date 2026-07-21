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
- Keep the charts, but drive them from the analytics gateway (`POST /analytics/query`) with
  explicit specs — the current dashboard uses ~5% of the endpoint. Relabel Requests → Runs;
  upgrade Latency from avg-only to percentiles. The endpoint is root-only (run-level), so
  child-span breakdowns (tools, per-cause failures) stay on per-run trace reads. See
  `research.md` §5–6.
- Surface resource usage as a first-class group — context usage (how full the model's
  window gets), token consumption, cache savings, cost per run — mapped to three personas
  (owner, builder, budget owner). Agent cost/token totals depend on a backend attribution fix
  (`research.md` §6); until it lands these views degrade gracefully, never showing a false zero.
- Reuse the shipped context-budget primitive (PR #5402 + #5434) for context usage —
  occupancy measure; denominator from `contextWindowForModel` (`@agenta/entities/workflow`,
  sourced from the model catalog), not a hardcoded map.
- Phase 1 composes existing data only (tracing, mounts, session interactions, triggers) and
  reuses `/analytics/query`; no new backend endpoints (one ingest-side attribution fix is a
  Phase 2 dependency for the Cost/Token views).
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
