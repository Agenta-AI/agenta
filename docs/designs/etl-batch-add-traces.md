# Batch-add Traces to Annotation Queues

**Created:** 2026-05-21
**Status:** RFC — Reviewed (eng + design review complete); D7 engine decision revised — ready to implement
**Related:** [etl-engine](./etl-engine.md), [eval-etl-engine](./eval-etl-engine.md)
**Authors:** Arda

---

## Summary

Add **all traces matching the observability filter** to an annotation queue,
without scrolling the trace table and checkbox-selecting page by page.

Batch-add of *checkbox-selected* traces already works. The gap — the friction
the team flagged ("lowers a bit of friction of scrolling") — is "add everything
matching the filter."

**Engine:** this is the **first production consumer of the ETL engine**
(`@agenta/entities/etl` — the `Source` / `Transform` / `Sink` contracts driven
by `runLoop`). Batch-add is a scan-and-write pipeline, which is the engine's
exact shape. A `traceSource` pages the observability filter, an
`extractTraceIds` transform dedups, a `queueAddSink` flushes to the queue. No
new API; frontend-only. Eval filtering will be the engine's second consumer.

> The CSV-export scan loop (`fetchAllTracesForExport`) stays as-is — this
> feature does not touch it. Converging export onto `traceSource` + a
> `csvSink` is a documented follow-up, not a prerequisite — see
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

### The ETL engine exists

`@agenta/entities/etl` — `runLoop` plus the `Source` / `Transform` / `Sink`
contracts — is the chunked scan-and-write engine built this session. It
guarantees bounded memory, observable progress, cancellation, and natural
backpressure. Batch-add-to-queue is its first production consumer.

### The trace query loop exists

`executeTraceQuery`
(`web/oss/src/state/newObservability/atoms/queryHelpers.ts`) already does the
hard per-page work of paging traces — the two-step annotation-filter
pagination, the `+1ms` cursor bump so the backend's strict-less-than filter
keeps boundary rows, `AbortSignal` plumbing. The oss adapter
`createObservabilityTraceFetchPage` wraps it into a `fetchPage`; the
cursor-advance loop, empty-page guard, and throttle live in the package's
`makeSourceFromCursorFetch`. `fetchAllTracesForExport` keeps its own copy of
that loop for CSV export — untouched by this feature.

### Annotation queues

- A queue is an `EvaluationRun` with `flags.is_queue = true`; each queued trace
  becomes an `evaluation_scenarios` row.
- **`POST /simple/queues/{id}/traces/`** takes `{trace_ids: List[str]}` →
  `add_traces` → `evaluate_batch_traces` (a Taskiq background job). Only direct
  `kind = traces` queues accept ad-hoc adds.

---

## Architecture

Batch-add-to-queue is a **scan-and-write pipeline**: page every trace matching
the observability filter, dedup by `trace_id`, write the ids to a queue. That
is the ETL engine's exact shape — `Source` → `Transform` → `Sink` driven by
`runLoop`.

It is built from **three generic ETL primitives** in `@agenta/entities/etl`
(reusable by eval filtering and any future scan), a **thin feature
composition** in `@agenta/entities/simpleQueue/etl`, and a **single
oss-coupled adapter** that supplies the trace transport.

```
@agenta/entities/etl  (generic, zero coupling)
  ├── makeSourceFromCursorFetch  — Source from a cursor-paged fetchPage
  ├── makeUniqueKeyTransform     — Transform: dedup rows → unique keys
  └── makeBufferedBatchSink      — Sink: buffer items, flush in batches

@agenta/entities/simpleQueue/etl  (feature composition)
  └── addAllMatchingTracesToQueue — wires the three above through runLoop

oss  (transport glue only)
  └── createObservabilityTraceFetchPage — wraps executeTraceQuery as fetchPage
```

### Generic primitives — `@agenta/entities/etl`

- **`makeSourceFromCursorFetch`** — builds a `Source<T>` from an injected
  `fetchPage(cursor, signal)`. Owns the scan loop: cursor advance, the
  empty-page no-progress guard, throttling, `AbortSignal`, `cursor: null`
  end-of-stream signaling.
- **`makeUniqueKeyTransform`** — a `Transform<TIn, string>` that captures a
  `Set` and emits each row's key once across the whole scan; honors an
  optional exclude `Set`.
- **`makeBufferedBatchSink`** — a `Sink<T>` that buffers items and flushes via
  an injected `flush(batch)` every **~250** (tunable, decoupled from the scan
  page size — bounded payload, ~8 background jobs for 2000 traces, not ~40).
  `finalize` flushes the remainder on clean completion; on cancel or after a
  failed flush it drops the buffer, so a partial write stays a clean multiple
  of the batch size. A failed flush throws `BatchFlushError` carrying the
  flushed-so-far count — **surfaces, never silent**.

All three are dependency-injected and pure — no entity, oss, or network
coupling — so they unit-test against fakes under the package's vitest setup.

### Feature composition — `addAllMatchingTracesToQueue`

In `@agenta/entities/simpleQueue/etl`. Wires `makeSourceFromCursorFetch`
(`fetchPage` injected) → `makeUniqueKeyTransform` (`selectKey = trace_id`) →
`makeBufferedBatchSink` (`flush` calls the injected `addTraces`), drives
`runLoop`, and adds the scan cap and abort→`cancelled` handling. Both
transports are injected, so the composition is itself pure and unit-testable.

### oss transport — `createObservabilityTraceFetchPage`

The one oss-coupled piece. Wraps `executeTraceQuery` (which carries the
two-step annotation-filter pagination, the `+1ms` cursor bump, `AbortSignal`)
into the `fetchPage` shape, and owns the observability-query seeding (`size`,
`newest`). `executeTraceQuery` stays in oss — it is genuinely
observability-coupled — so this thin adapter is the entire oss surface of the
pipeline.

### Dedup

**Verified:** `_evaluate_batch_items` (the `evaluate_batch_traces` worker)
creates exactly one `evaluation_scenarios` row per submitted `trace_id` with no
check for an existing scenario — scenario creation is **not** idempotent by
`trace_id`. Re-running "add all matching" over an overlapping filter therefore
duplicates scenarios.

v1 ships without a client-side dedup-exclude. It is consistent with the
existing selection-scoped add (also un-deduped), and a frontend exclude would
need a heavy two-level fetch — the `trace_id` lives on `evaluation_results`,
not on the scenario row, so deriving a queue's existing `trace_id`s means
paginating scenarios *and* their results. `addAllMatchingTracesToQueue`
already accepts an `excludeTraceIds` option (fed to `makeUniqueKeyTransform`'s
exclude `Set`) — wiring is one line once a source of already-queued ids
exists. The clean fix is server-side — skip `trace_id`s
that already have a scenario in the run, fixing both add paths at once. See
[Follow-ups](#follow-ups-not-v1).

---

## Resolved decisions

| Topic | Decision |
|-------|----------|
| **Engine** | Build on the ETL engine. Three generic primitives — `makeSourceFromCursorFetch` → `makeUniqueKeyTransform` → `makeBufferedBatchSink` — in `@agenta/entities/etl`, composed by `addAllMatchingTracesToQueue` in `@agenta/entities/simpleQueue/etl`, driven by `runLoop`. oss keeps only a `fetchPage` adapter. |
| **Phase** | Single-phase, frontend-only. No observability data-layer migration. |
| **Queue-add batching** | `queueAddSink` buffers `trace_id`s, flushes `addTraces` at a tunable ~250, decoupled from scan page size. |
| **Dedup** | **Verified: the backend does not dedup by `trace_id`** — `_evaluate_batch_items` creates one scenario per id with no existence check. v1 ships without a dedup-exclude (consistent with the existing selection-scoped add, also un-deduped). `addAllMatchingTracesToQueue` keeps the wired-but-unused `excludeTraceIds` option; the proper fix is server-side — see [Follow-ups](#follow-ups-not-v1). |
| **CSV export** | Untouched. Keeps its own scan loop (`fetchAllTracesForExport`). Converging it onto `traceSource` + a `csvSink` is a documented follow-up, not a prerequisite. |

**Considered and rejected:**

- **Generalize `fetchAllTracesForExport` into a shared `scanAllMatchingTraces`
  loop** — extract the CSV-export scan loop and have queue-add consume it via
  an `onPage` callback. Rejected by product direction: the ETL engine built
  this session is the scan-and-write engine and will also serve eval filtering;
  routing the first real feature around it would leave it unproven and would
  not produce the reusable `traceSource`. The export loop stays as-is;
  converging it onto `traceSource` later is a clean follow-up.
- **Observability paginated-store migration** — considered in eng review,
  rejected as a false prerequisite. The ETL `Source` is just an
  `AsyncIterable<Chunk>`; `traceSource` wraps `executeTraceQuery` directly and
  never needs a paginated store. Independent of the engine choice.
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
  the flush size — `finalize` drops the buffer on cancel) — the UI must message
  this.
- **Partial failure:** an `addTraces` flush failing mid-run leaves the queue
  partially filled; `queueAddSink` throws `QueueAddError` — surfaced, never
  silent.
- **Scan cap:** the pipeline wrapper caps at 20k traces scanned (`maxTraces`,
  tunable) — decide whether 20k is the right ceiling here.
- **Dedup:** scenario creation is not idempotent (verified) — re-running over
  an overlapping filter, or queueing a trace already in the queue, duplicates
  scenarios. v1 accepts this; see [Dedup](#dedup) and Follow-ups.

---

## Test requirements

```
makeSourceFromCursorFetch (Source)        — @agenta/entities vitest
  ├── [GAP] one chunk per page; cursor advances; final chunk has cursor: null
  └── [GAP] AbortSignal cancellation mid-scan; empty-page no-progress guard holds
makeBufferedBatchSink (Sink)              — @agenta/entities vitest
  ├── [GAP] load flushes every full ~250 batch; finalize flushes the remainder
  ├── [GAP] cancel / prior error → finalize drops the buffer (clean multiple)
  └── [GAP] failed flush throws BatchFlushError (no silent drop)
makeUniqueKeyTransform (Transform)        — @agenta/entities vitest
  └── [GAP] dedups keys across chunks; exclude Set honoured
addAllMatchingTracesToQueue (composition) — @agenta/entities vitest
  ├── [GAP] runLoop wiring: scanned / queued progress; cap stops the run
  └── [GAP] dedup exclude — already-queued trace_ids excluded before the run
UI affordance
  ├── [GAP] run → notification counter ticks; cancel → scan aborts
  └── [GAP] [→E2E] apply filter → add all matching → traces land in queue
```

CSV export is **untouched** by this design — no export regression surface.

---

## NOT in scope

- **Migrating CSV export onto the ETL engine** — `fetchAllTracesForExport`
  stays as-is. Converging it onto `traceSource` + a `csvSink` is the documented
  follow-up.
- **Observability paginated-store migration** — rejected false prerequisite.
- **Backend filter-query add endpoint** — kept frontend-only; the documented
  alternative.
- **Source-backed queues** (`kind != traces`); **creating a queue on the fly.**

---

## Follow-ups (not v1)

- **Server-side scenario dedup by `trace_id`** — `_evaluate_batch_items` should
  skip `trace_id`s that already have a scenario in the run. Fixes duplicate
  scenarios for *both* the selection-scoped and filter-scoped adds, race-free,
  and is the natural home for dedup (the backend owns the `trace_id`↔scenario
  mapping). Preferred over a client-side exclude.
- **Converge CSV export onto `traceSource` + a `csvSink`** — retire the second
  trace-scan loop that still lives in `fetchAllTracesForExport`.

---

## Implementation tasks

- [x] **T1 — generic ETL primitives** — `makeSourceFromCursorFetch`, `makeBufferedBatchSink`, `makeUniqueKeyTransform` in `@agenta/entities/etl`: dependency-injected, zero coupling. oss supplies the trace transport via `createObservabilityTraceFetchPage`.
- [x] **T2 — `addAllMatchingTracesToQueue`** — the feature composition in `@agenta/entities/simpleQueue/etl` wiring the three primitives through `runLoop` (scan cap, abort→cancelled, `BatchFlushError` surfacing). Unit tests pending — see Test requirements.
- [x] **T3 — dedup** — **verified: the backend is not idempotent** by `trace_id`. v1 ships without the exclude (consistent with the selection-scoped add); `extractTraceIds` keeps the wired-but-unused `excludeTraceIds` hook. Proper fix is server-side — recorded as a follow-up.
- [ ] **T4 — UI affordance** — two scope-labelled entry-point actions; no-filter confirm; reuse `AddToQueuePopover`; non-blocking notification with live counter + cancel; all interaction states + copy per the UI spec. Verify: component test + E2E.
- [ ] **T5 — E2E** — apply filter → add all matching → traces appear in the queue.

Priority: LOW. Effort: small — one Source + one Sink + one transform + one UI
affordance, on the ETL engine built this session.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 6 decisions resolved, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 3/10 → 9/10, 3 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE VOICE:** Claude subagent — challenged the plan's shape; drove the single-phase re-decision (no observability migration) and flagged the ETL framing.
- **D7 (revised):** an implementation-time finding briefly flipped the engine to "generalize the export loop." Reverted by product direction — the ETL engine built this session will serve eval filtering too, and batch-add-to-queue is the same scan-and-write shape, so it is the engine's first production consumer. Final engine: `traceSource` → `extractTraceIds` → `queueAddSink` on `runLoop`. The CSV-export loop is left untouched. The observability-migration rejection (D6) is independent and still holds — the scan never renders into the table. All eng + design UX decisions carry over unchanged.
- **UNRESOLVED:** 0
- **VERDICT:** ENG + DESIGN REVIEW CLEARED — ready to implement.
