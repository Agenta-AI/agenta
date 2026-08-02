# Agent Analytics page

A new project-scoped **Analytics** page for the Agenta web app. It charts how the
project's agents perform over a time window: run volume, success and failure, latency,
cost, and token usage. The page reads from the existing spec-driven analytics endpoint
(`POST /spans/analytics/query`) and reuses the frontend data-layer atoms that already exist
for it, so this work adds a page, not a new data layer.

## Reading order

1. **context.md** : why this page exists, what a user sees today, goals and non-goals, and
   the three scope decisions that are already locked.
2. **research.md** : the parts of the codebase this feature reuses, with exact file paths:
   the analytics fetch layer, the response-to-dashboard mapper, the sidebar and routing,
   and the charting library. Read this before proposing any new file.
3. **data-contract.md** : the request the page sends (time window, filter, metric specs)
   and the response fields it reads, including the fields the current mapper drops that
   this page needs.
4. **plan.md** : the build broken into phases, with the file list per phase and the clean
   boundary where the deferred model and tool views drop in once the backend supports them.
5. **status.md** : current state, open questions, and decisions. This is the source of
   truth for progress; update it as work lands.

## Glossary

Terms used across these documents, defined once here.

- **Run**: one agent invocation. On the backend it is one root span (a span with no
  parent). Run count per time bucket equals the count of the `ag.type.trace` metric.
- **Span**: one unit of work inside a run (a model call, a tool call, or the agent step
  itself). Model name and tool name live on child spans, not on the root span.
- **Root span**: the top span of a run. Today's analytics endpoint only reads root spans.
- **Bucket**: one time slice of the chart x-axis (for example one day, or one hour). The
  endpoint returns one metrics object per bucket.
- **Metric spec**: a request instruction of the form `{type, path}` that tells the endpoint
  which JSON path on the span to summarize and how. The endpoint has no fixed metric list;
  it summarizes whatever path a spec names.
- **Focus**: a request field selecting whether the query aggregates over root spans
  (`trace`) or all spans (`span`). Today only `trace` works; see context.md.
- **Project scope**: the web app always has exactly one project in context. This page lives
  at that level and, by default, aggregates every agent in the project.
- **Health score**: a single 0 to 100 number this page computes in the browser from success
  rate and average latency. It is a display aid, not a backend metric.
