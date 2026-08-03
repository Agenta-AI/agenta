# Agent Analytics page

A new project-scoped **Analytics** page for the Agenta web app. It charts how a project's
agents perform over a chosen window: run volume, success and failure, latency, cost, and
tokens. The page reads the existing spec-driven analytics endpoint
(`POST /spans/analytics/query`) and reuses the frontend data-layer atoms already built for it,
so this work adds a page, not a data layer.

## Reading order

1. **context.md** — why the page exists, what a user sees today, goals and non-goals, and the
   locked scope decisions.
2. **scope.md** — the v1 / v2 split: what ships now versus what waits for backend work, each as
   a ranked table. Read it to know what is in scope before the how.
3. **research.md** — the code this feature reuses, path by path: the analytics fetch layer, the
   response-to-dashboard mapper, the sidebar and routing, and the charting library. Read it
   before you propose any new file.
4. **data-contract.md** — the request the page sends (window, filter, metric specs) and the
   response fields the new mapper reads, including the fields the current mapper drops.
5. **plan.md** — the build in phases, with the file list per phase and the seam where the
   deferred model and tool views drop in once the backend supports them.
6. **status.md** — current state, open questions, and decisions. This is the source of truth
   for progress; update it as work lands.
7. **capability-review.md** — an independent, evidence-backed review of what the analytics
   backend can answer today, written after the documents above. It tests each wanted capability
   against the running code with live queries, times those queries, and proposes a v1 and a v2.
   It contradicts the earlier documents in several places, so read it before you build. Where
   the two disagree, the review carries the evidence.

## Glossary

Terms used across these documents, defined once. This section is the workspace glossary; a
separate `CONTEXT.md` cannot sit beside `context.md`, because the filesystem is case-insensitive
and the two names collide.

- **Agent**: a configured AI agent in the project — the top-level thing a user builds, runs, and
  analyzes. It is the unit the page aggregates over and the unit the Agents filter narrows to.
  This page's copy never calls it application, app, workflow, or variant.
- **Run**: one agent invocation. On the backend it is one root span (a span with no parent). Run
  count per bucket equals the count of the `ag.type.trace` metric. This page says "run"; the
  Observability dashboard says "request" for the same metric, and the two may diverge until
  Observability is aligned later.
- **Span**: one unit of work inside a run — a model call, a tool call, or the agent step itself.
  Model name and tool name live on child spans, not on the root span.
- **Root span**: the top span of a run. Today's analytics endpoint reads root spans only.
- **Failed run**: a run whose root span status is `STATUS_CODE_ERROR`, a run-level outcome
  (there is no `STATUS_CODE_OK` on root spans, so success is the complement). It is counted from
  the `status_code` column, not from the errors metric.
- **Error**: any errored step inside a run. A run can contain errors and still succeed, so an
  error count is not a failed-run count.
- **Bucket**: one time slice of the chart x-axis — one day, or one hour. The endpoint returns
  one metrics object per bucket.
- **Metric spec**: a request instruction of the form `{type, path}` that tells the endpoint
  which JSON path on the span to summarize, and how. The endpoint has no fixed metric list; it
  summarizes whatever path a spec names.
- **Focus**: a request field that selects whether the query aggregates over root spans (`trace`)
  or all spans (`span`). Only `trace` works today; see context.md.
- **Project scope**: the web app always has exactly one project in context. This page lives at
  that level and, by default, aggregates every agent in the project.
