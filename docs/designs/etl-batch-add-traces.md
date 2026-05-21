# Batch-add Traces to Annotation Queues

**Created:** 2026-05-21
**Status:** RFC — Reviewed (eng + design review complete), ready to implement
**Related:** [etl-engine](./etl-engine.md), [eval-etl-engine](./eval-etl-engine.md)
**Authors:** Arda

---

## Summary

Add **all traces matching the observability filter** to an annotation queue,
without scrolling the trace table and checkbox-selecting page by page.

Batch-add of *checkbox-selected* traces already works. The gap — the friction
the team flagged ("lowers a bit of friction of scrolling") — is "add everything
matching the filter."

**Engine (post-review):** this **generalizes the existing
`fetchAllTracesForExport` scan loop** — the proven loop behind "export all
matching traces to CSV" — into a reusable `scanAllMatchingTraces`. CSV export
and queue-add become two consumers of one loop. No new ETL pipeline; no API
change; frontend-only.

> Naming note: the file and branch keep the `etl-` prefix for history. The
> reviewed design does **not** use the ETL `runLoop` engine — see
> [Resolved decisions](#resolved-decisions).

---

## Background — the friction

Team framing: *"Batch adding from traces to annotation queues — it lowers a bit
of friction of scrolling but does not change the workflow by a lot."* LOW
priority. To queue ~800 filter-matching traces today, a user scrolls the
virtual table and ticks rows across N pages. There is no "select all matching."

---

## Current state

### Observability page

- `ObservabilityTable` (`web/oss/src/components/pages/observability/`) renders
  traces from `tracesQueryAtom` — cursor-paginated `POST /tracing/spans/query`.
- Multi-select checkbox column → `selectedRowKeysAtom`.
- Selection-scoped add already exists: select → `AddActionsDropdown` →
  `AddToQueuePopover` → `simpleQueueMolecule.actions.addTraces(queueId, ids[])`.

### The scan loop already exists

`fetchAllTracesForExport` (`web/oss/src/state/newObservability/atoms/queryHelpers.ts`)
already loops `executeTraceQuery` with the cursor and pages through **every
trace matching the current observability filter** — with `AbortSignal`, an
`onProgress` callback, a 20k-row safety cap, empty-page detection, and request
throttling. It is the engine behind the CSV-export feature.

### Annotation queues

- A queue is an `EvaluationRun` with `flags.is_queue = true`; each queued trace
  becomes an `evaluation_scenarios` row.
- **`POST /simple/queues/{id}/traces/`** takes `{trace_ids: List[str]}` →
  `add_traces` → `evaluate_batch_traces` (a Taskiq background job). Only direct
  `kind = traces` queues accept ad-hoc adds.

---

## Architecture

Batch-add-to-queue needs the *same scan* the CSV export does — page every
trace matching the filter — with a different write target. So: extract the
loop, share it.

```
scanAllMatchingTraces({ params, appId, signal, onPage, cap })
   │   the existing fetchAllTracesForExport loop, extracted:
   │   cursor pagination, AbortSignal, onProgress, cap, empty-page, throttle
   ├── CSV export  — onPage: collect spans → Papa.unparse → csvParts
   └── queue-add   — onPage: buffer trace_ids → flush addTraces
```

### `scanAllMatchingTraces` (the generalized loop)

`fetchAllTracesForExport` keeps its public signature (the export feature is
unchanged from the caller's view) but its loop body is extracted into
`scanAllMatchingTraces`, parameterised by an `onPage(traces)` callback. CSV
export becomes the first caller; its CSV-specific code (`collectSpans`,
`formatRow`, `Papa.unparse`) moves into *its* `onPage`.

### The queue-add consumer

A new caller of `scanAllMatchingTraces` whose `onPage`:

- collects `trace_id`s from each page,
- buffers them and flushes `addTraces(queueId, ids)` every **~250** (tunable,
  decoupled from the scan page size — bounded payload, ~8 background jobs for
  2000 traces, not ~40),
- a final flush after the scan ends,
- a failed `addTraces` flush **surfaces** (never silent) — partial state is a
  known multiple of the flush size.

### Dedup

Before building, **verify** whether `evaluate_batch_traces` / scenario creation
dedups by `trace_id`. If it does, v1 is free. If not, the queue-add consumer
fetches the queue's existing scenario `trace_id`s and excludes them — the
exclude-fetch must itself be bounded/paginated for large queues.

---

## Resolved decisions

| Topic | Decision |
|-------|----------|
| **Engine** | Generalize `fetchAllTracesForExport` into `scanAllMatchingTraces`; CSV export + queue-add share it. **No ETL `runLoop` / `traceSource` / `queueAddSink`.** |
| **Phase** | Single-phase, frontend-only. No observability data-layer migration. |
| **Queue-add batching** | `onPage` buffers `trace_id`s, flushes `addTraces` at a tunable ~250, decoupled from scan page size. |
| **Dedup** | Verify backend idempotency; client-side exclude of already-queued `trace_id`s only if absent. |

**Considered and rejected:**

- **ETL `traceSource` + `runLoop` + `queueAddSink`** — a new ETL pipeline.
  Rejected: `fetchAllTracesForExport` already implements the scan loop;
  `runLoop` would be a second loop paging the same endpoint, duplicating proven
  cancel/cap/empty-page handling. `runLoop` earns its keep when streaming into a
  rendered viewport — this feature only scans and writes.
- **Observability paginated-store migration** — considered in eng review,
  rejected as a false prerequisite (the scan never needed it).
- **Backend `POST /simple/queues/{id}/traces/query` filter-add endpoint** —
  the cleaner long-term layer (server already does filter→scenarios at queue
  creation); the review kept this frontend-only. Recorded as the alternative if
  the client-side scan becomes a problem at scale.

---

## UI affordance (design review)

**Entry point — two scope-labelled actions** in the observability action area:

- *"Add N selected to queue"* — the existing selection-scoped add (enabled only
  when rows are checked).
- *"Add all matching filter to queue"* — the new filter-scoped add.

Each label states its scope. No single ambiguous "Add to queue".

**No-filter guard:** with no filter active, "Add all matching filter to queue"
opens a confirm — *"This will queue every trace in the project. Continue?"* —
before running. With a filter active it goes straight to the queue picker.

**Queue picker:** reuse the existing `AddToQueuePopover`
(`web/packages/agenta-annotation-ui/`) — pick a `kind = traces` queue.

**Progress:** a non-blocking antd `notification` on run — a live counter and a
Cancel button. The user keeps working while the scan runs. Navigating away from
observability aborts the run (messaged as a partial add).

**Honest copy:** `evaluate_batch_traces` is fire-and-forget — progress reflects
*IDs submitted*, not scenarios materialized. Say **"queued"**, never
"added" / "done".

### Interaction states

| State | What the user sees |
|-------|--------------------|
| Idle, no filter | "Add all matching filter to queue" enabled → click opens the no-filter confirm |
| Idle, filter active | Action enabled → click opens the queue picker |
| Queue picker | Existing `AddToQueuePopover` — pick a `kind = traces` queue |
| Running | Non-blocking notification: *"Queued N traces…"* + Cancel |
| Done | Notification updates: *"Queued N traces to {queue}. They'll appear as the queue processes."* + a "View queue" link |
| Cancelled (partial) | *"Cancelled — N traces queued to {queue} before you stopped."* |
| No match | *"No traces match this filter — nothing queued."* |
| Error (partial) | *"Queued N traces; M failed to queue."* + a Retry action — surfaced, never silent |

The entry-point label carries **no count** — the observability query exposes no
reliable dataset total. The count appears once the run starts, via the live
notification counter.

---

## Edge cases & constraints

- **Queue kind:** only `kind = traces` direct queues accept ad-hoc adds.
- **Cancellation:** abortable mid-run; leaves a partial add (a known multiple of
  the flush size) — the UI must message this.
- **Partial failure:** an `addTraces` flush failing mid-run leaves the queue
  partially filled; surface it, never silently.
- **Scan cap:** `fetchAllTracesForExport` caps at 20k rows — the queue-add
  consumer inherits a cap; decide whether 20k is the right ceiling here.
- **Dedup race:** a trace queued by someone else between the exclude-fetch and
  the run can still duplicate — acceptable for v1, note it.

---

## Test requirements

```
scanAllMatchingTraces (extracted loop)
  ├── [GAP][CRITICAL] CSV export still works after the extraction (regression)
  ├── [GAP] onPage called once per page; cursor advances; stops at end
  └── [GAP] AbortSignal cancellation mid-scan; cap + empty-page guards hold
queue-add consumer
  ├── [GAP] buffers trace_ids, flushes addTraces at the threshold
  ├── [GAP] final flush after scan ends
  └── [GAP] addTraces flush failure surfaces (no silent drop)
dedup exclude (if backend not idempotent)
  └── [GAP] already-queued trace_ids excluded before the run
UI affordance
  ├── [GAP] run → notification counter ticks; cancel → scan aborts
  └── [GAP] [→E2E] apply filter → add all matching → traces land in queue
```

The CSV-export regression test is **critical** — the extraction must not change
export behaviour.

---

## NOT in scope

- **ETL `runLoop` pipeline for this feature** — generalized the export loop
  instead (see Resolved decisions).
- **Observability paginated-store migration** — rejected false prerequisite.
- **Backend filter-query add endpoint** — kept frontend-only; the documented
  alternative.
- **Source-backed queues** (`kind != traces`); **creating a queue on the fly.**

---

## Implementation tasks

- [ ] **T1 — `scanAllMatchingTraces`** — extract the loop from `fetchAllTracesForExport` into a reusable function with an `onPage` callback; refactor CSV export to consume it. Verify: **CSV export regression test** + loop/cursor/cancel tests.
- [ ] **T2 — queue-add consumer** — `onPage` that buffers `trace_id`s and flushes `addTraces` at a tunable ~250, final flush, failure surfacing. Verify: unit tests.
- [ ] **T3 — dedup** — verify `evaluate_batch_traces` idempotency; bounded client-side exclude only if needed.
- [ ] **T4 — UI affordance** — two scope-labelled entry-point actions; no-filter confirm; reuse `AddToQueuePopover`; non-blocking notification with live counter + cancel; all interaction states + copy per the UI spec. Verify: component test + E2E.
- [ ] **T5 — E2E** — apply filter → add all matching → traces appear in the queue.

Priority: LOW. Effort: small — one loop extraction + one consumer + one UI
affordance, all on proven code.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 6 decisions resolved, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 3/10 → 9/10, 3 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE VOICE:** Claude subagent — challenged the plan's shape; drove the single-phase re-decision (no observability migration) and flagged the ETL framing as forced.
- **D7 (implementation-time finding):** starting T1 surfaced that `fetchAllTracesForExport` already implements the trace scan loop. Engine changed from a new ETL `runLoop` pipeline to **generalizing that existing loop** — confirms the outside voice's "ETL is forced here" point. All eng + design UX decisions carry over unchanged.
- **UNRESOLVED:** 0
- **VERDICT:** ENG + DESIGN REVIEW CLEARED — ready to implement.
