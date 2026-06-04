# Evaluation Topologies

The topology classifier (`classify_steps_topology`, in
`sdks/python/agenta/sdk/evaluations/runtime/topology.py`) inspects a run's step
graph — its input families (query / testset / trace / testcase), whether it has
an application (invocation) step, whether it has evaluator (annotation) steps,
and the `is_live` flag — and returns a `TopologyDecision`.

Each decision carries a `status` and, when runnable, a `dispatch` of two
orthogonal axes:

- **source** — which input family seeds the run: `query` / `testset` / `trace` /
  `testcase`.
- **mode** — how items arrive and execute:
  - `live` — scheduler-driven, windowed by the tick (windowing OFF on the
    resolver so each tick's range is preserved).
  - `batch` — one-shot over a bounded set (windows from the source's own bounds).
  - `queue` — an open queue; nothing runs at start, batches arrive async via
    `run_from_batch`.

A run is **allowed** (executes) only when `status == "supported"`. The other
statuses are recognized but not run. Order matters: the classifier returns the
first matching branch.

---

## Supported (these run)

### Live query → evaluator
`dispatch = {query, live}`. Live + query input + evaluators, no application.
A scheduler tick feeds new query traces straight into evaluators; windowing
stays off so the tick's time range survives for temporal bucketing.

### Batch query → evaluator
`dispatch = {query, batch}`. Query input + evaluators, no application, not live.
A one-shot evaluation over the query revision's own bounded trace set.

### Direct traces → evaluator
`dispatch = {trace, queue}`. Trace input + evaluators, no application.
An open queue: trace batches are pushed in later and each finalizes itself.

### Direct testcases → evaluator
`dispatch = {testcase, queue}`. Testcase input + evaluators, no application.
Same open-queue shape as traces, seeded by direct testcases instead.

### Testset → application → evaluator
`dispatch = {testset, batch}`. Testset input + one application + evaluators.
The canonical batch evaluation: run the app over each testcase, then score it.

### Testset → application (batch inference)
`dispatch = {testset, batch}`. Testset input + one application, no evaluators.
Bulk invocation only — produce outputs over a testset, no scoring step.

---

## Recognized but not allowed

### Query → application *(potential)*
`status = potential`. Query input + application. Plausible (query traces could
seed app calls) but deferred: source trace links must not be attached as
application links, or the new app traces get misclassified as annotations.

### Testset → evaluator, no application *(potential)*
`status = potential`. Testset input + evaluators, no application. Deferred:
non-queue testcase-only evaluator execution needs an explicit evaluator
contract first.

### Mixed query + testset sources *(not planned)*
`status = not_planned`. Two source families in one run — not a planned shape.

### Live testset evaluation *(not planned)*
`status = not_planned`. `is_live` + testset — not a meaningful product shape.

### Multiple application steps *(not planned)*
`status = not_planned`. More than one invocation step — A/B app comparisons
belong in separate evaluations.

### Anything else *(unsupported)*
`status = unsupported`. No dispatch path matches the graph; the run is dropped
at start.
