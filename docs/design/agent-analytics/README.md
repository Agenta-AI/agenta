# Agent Analytics page

A project-scoped **Analytics** page for the Agenta web app. It charts how a project's agents
perform over a chosen window: run volume, success and failure, latency, cost, and tokens. The
page reads the existing analytics endpoint (`POST /spans/analytics/query`) and reuses the
frontend data layer already built for it, so this work adds a page, not a data layer.

## State

**Planned, not built.** No code is written and no branch exists. The scope is designed against
today's endpoint; most of the open work — and every wanted-but-missing view — is v2 backend work.

## The docs

- **[scope.md](scope.md)** — the scope line: what the backend can answer **today** (with honest
  labels) versus what **needs v2 work** (blockers first, then deferred features, each ranked with
  the backend change it needs). Start here. Scan its tables in a few seconds.
- **[research.md](research.md)** — ground truth: how the analytics engine actually works
  (root-spans-only, the dead `focus` field, specs and percentiles, the silent-failure modes),
  what live queries prove, and the code the page reuses. Read it before proposing any change.
- **[capability-review.md](capability-review.md)** — the evidence base: every verdict tested
  against the running code with live queries on two stacks. Where a summary and the review
  disagree, the review carries the evidence. Its line citations are frozen at commit
  `31c0781d42`; the load-bearing ones are re-verified and corrected in research.md.

## The short version

**Today** the endpoint answers: runs (success vs failed), latency (avg + p95 + min/max), runs per
agent, and filters on agent / harness / configured model. Cost and the token split are
expressible but coverage-gated. Breakdowns by harness and configured model are run-counts only,
so the useful version — cost and tokens per harness/model — is v2. It reads root spans only, and
it fails silently — a killed query looks like an empty one.

**v2** is where the open problems live: two defects (silent query failures, and a mid-July
collapse in cost/token coverage), one contract decision, and the wall behind every missing view.
Some need only a group-by dimension (cost/tokens per harness and configured model, which are
root-span attributes); the rest wait on a `focus=span` fix because the endpoint cannot read child
spans — tool usage, the model that actually answered, per-resolved-model cost, and cache tokens.

## Glossary

- **Agent**: a configured AI agent in the project — the unit the page aggregates over. Never
  called application, app, workflow, or variant in the page copy.
- **Run**: one agent invocation. On the backend it is one root span (a span with no parent). Run
  count is the count of the `ag.type.trace` metric. The Observability page calls the same metric
  a "request"; the two may diverge until Observability is aligned later.
- **Root span** / **child span**: the top span of a run versus every other span in it. Today's
  endpoint reads root spans only. Model name and tool name live on child spans.
- **Configured / resolved / invoked**: what the author wrote down (the model alias, the tool
  list) / what the system turned it into at run time / what the run actually did. Today's page can
  chart only *configured* values; *resolved* and *invoked* are v2.
- **Failed run**: a run whose root span `status_code` is `STATUS_CODE_ERROR`. There is no
  `STATUS_CODE_OK` on root spans, so success is the complement. It is a run-level outcome, not a
  count of errored steps.
- **Bucket**: one time slice of the x-axis — a fixed-width period offset from the window start,
  not a calendar day. Calendar months are not expressible.
- **Metric spec**: a `{type, path}` instruction naming a JSON path to summarize. The endpoint
  has no fixed metric list; it summarizes whatever path a spec names.
- **Coverage-gated**: a metric that is expressible but often holds no data, so the chart renders
  only when enough runs carry the value and otherwise says so, rather than showing a zero.
