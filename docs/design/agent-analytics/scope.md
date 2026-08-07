# Scope — possible today vs needs v2 work

The scope line for the Analytics page: what the backend can answer **today**, and what needs a
backend change in **v2**. This is a scoping doc, not a build guide — it says what is in and what
is out, not how to wire it. The mechanics behind every verdict are in [research.md](research.md);
the live-query evidence is in [capability-review.md](capability-review.md) (`§`).

Priority ranks value against effort (P0 first). Effort is S (a day), M (a few days), L (a week+).

---

## V1 = Possible today

Works against today's endpoint with no backend change. Each is verified backend-available in
§4.2. The label matters: several of these are proxies that must be named honestly in the UI.

| Capability | What the number actually means | Ready? |
|---|---|---|
| Runs per period | Root spans in the window, in fixed-width buckets. Calendar months are not expressible | **Yes**, with a `trace_type` filter |
| Success vs failed runs | Root-span status. Blind to failures inside a run that recovered a clean root (~1.2%) | **Yes**, with the corrected `status_code` filter |
| Average latency per period | Mean root-span wall clock | **Yes** |
| Latency min / max / p95 | Exact percentile over root durations; 27 percentiles ship free on every numeric spec | **Yes** |
| Total tokens per period | Harness-reported total tokens | **Yes**, with a coverage label |
| Runs per agent | Agent identity from `references`; two naming families unioned | **Yes**, run counts only |
| Filter by agent / harness / configured model | Server-side conditions on root-span fields | **Yes** |


---

## V2 Missing features/issues

One table, ordered by priority (P0 first) and, within a tier, **fixes before missing
capabilities**. The **Type** column says whether a row repairs something that exists but is broken
(**Fix**) or builds a capability that isn't there yet (**Missing**). The "Blocked by / fix" column
is the gate: for a Fix it is the repair, for a Missing item the capability it waits on — one gate
often unlocks several rows. The wall behind most missing items: the endpoint reads root spans only,
and the `focus` field that would widen the scan to child spans is accepted, echoed, and ignored
(§4.3, [research.md](research.md)).

| Priority | Type | Item | Blocked by / fix | Effort |
|---|---|---|---|---|
| **P0** | Fix | **B1** — killed / rejected queries return an empty HTTP 200, indistinguishable from no data | Raise a typed timeout/filter error in core; re-raise as `HTTPException` (504 / 4xx) at the router; add a per-metric `sample_count` | M |
| **P0** | Fix | **B2** — cost + token-split coverage collapsed to near zero mid-July, cause unknown | Diagnose the collapse (first checks in §4.4 item 4); both measured stacks were local dev, production unverified | M–? |
| **P0** | Fix | **Contract** — request is an arbitrary JSON path validated by silence, pinning every UI to today's ingest shape | Keep it, or move to a typed contract (named metrics/dimensions, filter grammar, caps); gates F1–F5 | M |
| P1 | Fix | **Total cost per period** — harness-reported run total (`gen_ai.usage.cost`); total only, canonical paths empty on roots. UI built + coverage-gated, so it lights up on the B2 fix | B2 | S (UI done) |
| P1 | Fix | **Prompt / completion token split** — same field family as total tokens. UI built + coverage-gated, lights up on the B2 fix | B2 | S (UI done) |
| P1 | Fix | **Stop reading JSONB on the chart path** (F2) — a permanent latency win + a home for invoked facts | Ingest + storage change (hot columns or a facts table) | M–L |
| P1 | Missing | **Tool usage per period** — which tools actually ran | `focus=span` wiring (F1) | M |
| P1 | Missing | **Resolved model usage** — the model that answered | `focus=span` (shares F1) | M |
| P2 | Fix | **Cost on the canonical path** — map `gen_ai.usage.cost` → `ag.metrics.costs.cumulative.total` | Semconv adapter map | S |
| P2 | Missing | **Cost / tokens per harness & per configured model** — the breakdowns worth showing; today's give run counts only | A group-by dimension (F3); both are root-span attributes, so **no** `focus=span` | M |
| P2 | Missing | **Cost / tokens per resolved model** — split by the model that answered | `focus=span` **and** a group-by dimension (F3) | L |
| P2 | Missing | **Cache tokens per period** | `focus=span`, or roll up to the root | M |
| P2 | Missing | **Calendar-aware periods** — true days/months, timezone-correct | Timezone-aware bucketing | M |
| P3 | Missing | **Skills used (invoked)** | Runner instrumentation, then promotion to the root | L |
| P3 | Missing | **Pre-aggregation rollups** — fast wide-window queries at scale | A rollup table, sequenced last | L |


### What the gates require

- **F1 — span-focus wiring.** Make `WHERE parent_id IS NULL` conditional on `focus`. Ship three
  guards or it returns wrong numbers: cumulative metrics double-count (use the `incremental`
  paths), the run count needs a dedupe (`ag.type.trace` is on every span), and non-root rows need
  an index (~5x row fan-out). Do not ship it before B1. §8.4 item 3.
- **F2 — storage.** Reading one number out of a 10 KB JSONB value costs a full detoast; the fix
  is storage, not SQL. Promote hot fields to typed columns, or build a per-run facts table (which
  also homes invoked tools and resolved models). Both need a late-arriving-batch plan. §8.4 item 4.
- **F3 — a group-by dimension.** No request can split a numeric metric by a category today. Prefer
  a per-series dimension under the typed contract over one `group_by` path per query, and cap
  cardinality. Harder; defer until F1 ships. §8.4 item 5.

### Also unresolved before the page leaves beta

Not analytics questions, but the page cannot ship past beta without answers (§8.5): whether
Analytics **replaces or sits beside** Observability (and the two deprecated, uncalled analytics
routes still in the clients); **test coverage** (one analytics unit test exists, asserting bucket
order); **tenancy tests** (nothing proves a filter cannot reach another project's rows); a
**performance gate** on production-shaped data; and a **rollout flag** until B2 is answered.
