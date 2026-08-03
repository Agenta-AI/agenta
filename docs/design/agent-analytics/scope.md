# Scope: v1 now, v2 later

This page draws the line between what ships now (**v1**) and what waits (**v2**). It is the
roadmap view; plan.md holds the build steps, and capability-review.md holds the evidence behind
every verdict.

## The rule

- **v1** is the planned release scope: the charts and Agents filter we will build against
  today's endpoint — runs, latency, cost, tokens, and the harness / configured-model / agent
  breakdowns. No code is written yet (see status.md); this is the plan, not a shipped state.
- **v2** is anything that needs backend integration or a major fix — a new query capability, a
  storage change, or new instrumentation.
- **Exception, by decision of the requester:** the two backend items in Phase 0 (make a killed or
  rejected query surface an error, and investigate the cost / token coverage collapse) stay in
  **v1 as blockers**, not v2. v1 does not ship until they land, because without them the page
  cannot tell "no data" from "the query died", and cost may read empty with no signal.

## How to read the tables

- **Priority** ranks work within each scope by value against effort: `P0` first, then `P1`, `P2`,
  `P3`.
- **Value** — how much the feature matters to a user: High / Med / Low.
- **Effort** — how much work it is: `S` (a day or so), `M` (a few days), `L` (a week or more, or
  open-ended).
- **Backend blocker** rows are flagged; everything else in v1 is frontend-only.

---

## Scope v1 — build now

Planned against today's endpoint, plus the two backend blockers. No code is written yet (see
status.md). Every capability here is verified backend-*available* in capability-review.md §4.2
unless a note says otherwise — "ready" describes what the endpoint can answer today, not shipped
UI, and B1 and B2 remain release blockers.

| Priority | Feature | What it delivers | Value | Effort | Depends on |
|---|---|---|---|---|---|
| P0 | Page shell, route, sidebar | The Analytics page exists, reachable, project-scoped | Enabler | S | — |
| P0 | Data layer (`specs` field + fetch + mapper) | The page requests explicit specs and maps buckets to chart shape | Enabler | M | — |
| P0 | **B1 — Make killed / rejected queries surface an error** *(backend blocker)* | 504 / 4xx + per-metric `sample_count` instead of a silent empty 200 | High | M | — |
| P0 | Runs per period (success vs failed) | Stacked Runs chart; corrected `status_code is STATUS_CODE_ERROR` filter + second query | High | M | B1 |
| P0 | Latency per period (avg + p95 + min/max) | Latency chart with per-bucket p95 line; ships free on the numeric spec | High | S | — |
| P0 | Time-range control (any window, 7-day default) | Reuses the observability `Sort` / `SortResult` | High | S | — |
| P0 | Four page states (data / no-data / unavailable / failed) | Honest empty vs failure vs coverage-gap, per card | High | M | B1 |
| P1 | **B2 — Investigate cost / token coverage collapse** *(backend blocker)* | Restores dependable coverage for cost and the token split | High | M–? | — |
| P1 | Cost per period (coverage-gated total) | Cost chart from `gen_ai.usage.cost`; renders only above the coverage threshold | High | M | B2 |
| P1 | Tokens per period (total + coverage-gated split) | Tokens chart; the prompt/completion split shows only above threshold | Med | M | B2 (split only) |
| P1 | Breakdown charts: runs per harness / configured model / agent | Three `categorical/single` breakdowns; agent unions `workflow_variant` + `application_variant` | High | M | — |
| P1 | Filters: agents, harness, configured model | Three server-side filters on root-span fields; no backend change (§4.2 items 10–12). Agents by `references`; the model filter narrows the configured alias | High | M | — |

Notes:

- **Cost** is "blocked on coverage" in the review (§4.2 item 4). v1 ships the chart
  coverage-gated; B2 is what makes it dependable.
- **Configured model** is a proxy for the model that answered — the author's alias. It is
  labeled honestly; the real answered model is v2 (needs `focus=span`).
- **Not on the v1 page at all:** tool usage, resolved-model usage, per-model cost, cache tokens,
  per-user numbers, skills. All are v2 (below), each for a backend reason.

---

## Scope v2 — future, needs backend work

Ordered by dependency and combined value-vs-effort. The backend column names the enabling change
and its capability-review.md §8.4 item.

| Priority | Feature | What it delivers | Value | Effort | Backend work it needs |
|---|---|---|---|---|---|
| P0 | Typed analytics contract | Named metrics / dimensions / aggregations, validated and capped; the foundation the rest build on | High | M | Replace the arbitrary-path protocol (§8.4 item 2) |
| P1 | Stop reading JSONB on the chart path | Hot columns or a per-run facts table; a permanent latency win and a home for invoked facts | High | M–L | Ingest + storage change (§8.4 item 4) |
| P1 | Tool usage per period (which tools ran) | Real tool-call counts, and a path to per-tool error rate | High | M | `focus=span` wiring + 3 guards + non-root index (§8.4 item 3) |
| P1 | Resolved model usage per period | The model that actually answered, distinct from the configured alias | High | M | `focus=span` (shares the wiring) |
| P2 | Per-model cost / tokens | A numeric metric split by model in one call | High | L | `focus=span` + a group-by dimension (§8.4 item 5) |
| P2 | Cost mapped to the canonical path | `gen_ai.usage.cost` → `ag.metrics.costs.cumulative.total`; also fixes evaluation cost | Med | S | Semconv adapter map (§8.4) |
| P2 | Cache tokens per period | Cache read and write per model call | Low–Med | M | `focus=span`, or roll up to the root |
| P2 | Per-user numbers | Runs / latency / cost per user | Med* | S | A nameable `created_by_id` dimension (needs the contract or facts table) (§8.4 item 6) |
| P2 | Calendar-aware periods | True calendar days and months, timezone-correct | Low | M | Timezone-aware bucketing in the backend (§4.4 item 1) |
| P3 | Skills used (invoked) | Which skills the agent actually invoked | Med | L | Runner instrumentation, then promotion to the root (§4.4 item 14) |
| P3 | Pre-aggregation rollups | Fast wide-window queries at high volume | Med | L | A rollup table; sequence last, after facts land (§8.4 item 7) |

\* Per-user value is conditional: it means nothing until a project has more than one writing
credential. On both measured stacks `created_by_id` had exactly one value per project (§4.4
item 13).

---

## Where each source draws the line

- **capability-review.md §4.2** — the per-capability verdict table (ready / proxy / not
  available) that seeds v1 versus v2.
- **capability-review.md §8.3** — the v1 beta scope.
- **capability-review.md §8.4** — the v2 backend work, in dependency order.
- **plan.md** — the v1 build, phase by phase (Phase 0 = the two blockers; Phases 1–4 = the page;
  Phase 5 = the first slice of v2).
