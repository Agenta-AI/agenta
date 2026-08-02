# Agent Analytics page

A new project-scoped **Analytics** page for the Agenta web app. It charts how the
project's agents perform over a time window: run volume, success and failure, latency,
cost, and token usage. The page reads from the existing spec-driven analytics endpoint
(`POST /spans/analytics/query`) and reuses the frontend data-layer atoms that already exist
for it, so this work adds a page, not a new data layer.

## Reading order

1. **context.md** : why this page exists, what a user sees today, goals and non-goals, and
   the scope decisions that are locked.
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

Terms used across these documents, defined once here. This section is the workspace glossary;
a separate `CONTEXT.md` cannot live here because the filesystem is case-insensitive and would
collide with `context.md`.

- **Agent**: a configured AI agent in the project, the top-level thing a user builds, runs,
  and analyzes. It is the unit this page aggregates over and the unit the Agents filter
  narrows to. Not called application, app, workflow, or variant in this page's copy.
- **Run**: one agent invocation. On the backend it is one root span (a span with no
  parent). Run count per time bucket equals the count of the `ag.type.trace` metric. This
  page says "run"; the Observability dashboard says "request" for the same metric, and the two
  are allowed to diverge until Observability is aligned later. Not called request here.
- **Span**: one unit of work inside a run (a model call, a tool call, or the agent step
  itself). Model name and tool name live on child spans, not on the root span.
- **Root span**: the top span of a run. Today's analytics endpoint only reads root spans.
- **Failed run**: a run whose root span status is `ERROR`, a run-level outcome. Counted from
  the `status_code` column, not from the errors metric.
- **Error**: any errored step inside a run. A run can contain errors and still succeed, so an
  error count is not a failed-run count.
- **Success rate**: successful runs over total runs, where a failed run is the one above.
- **Bucket**: one time slice of the chart x-axis (for example one day, or one hour). The
  endpoint returns one metrics object per bucket.
- **Metric spec**: a request instruction of the form `{type, path}` that tells the endpoint
  which JSON path on the span to summarize and how. The endpoint has no fixed metric list;
  it summarizes whatever path a spec names.
- **Focus**: a request field selecting whether the query aggregates over root spans
  (`trace`) or all spans (`span`). Today only `trace` works; see context.md.
- **Project scope**: the web app always has exactly one project in context. This page lives
  at that level and, by default, aggregates every agent in the project.
- **Health score**: a single 0 to 100 number this page computes in the browser from the
  success rate alone (latency was dropped because a fixed latency band mislabels slow-but-
  healthy agents). The bands map directly to success: Healthy at 85 and above, Watch from 65
  to 84, At risk below 65. It is a display aid, not a backend metric.
