# Origin execution model: today (`human`/`auto`/`custom`) and the future (`web`/`api`/`sdk`/`custom`)

Status: design / forward-looking. The "today" section documents shipped
behavior; the "future" section is a proposal, not yet implemented.

## What `origin` means

Every evaluation step (`input`, `invocation`, `annotation`) carries an
`origin`. `origin` answers exactly one question: **who is responsible for
executing this step?** It is not "who created the run", not "who started it",
not "who dispatched the job" — only who *runs the work in a given slice*.

- Type (SDK): `agenta/sdk/models/evaluations.py` — `Origin = Literal["custom", "human", "auto"]`
- Type (API): `api/oss/src/core/evaluations/types.py` — same literal.

The evaluation runtime (`EvaluationPlanner` + the slice processor) is shared:
the **same** code runs inside the backend worker and inside the SDK
`evaluate()` loop. So `origin` is the only thing that lets one body of code
decide "is this step mine to run, or someone else's?". Two hosts read the same
plan and each runs only its own steps.

## Today: `human` / `auto` / `custom`

| origin   | Who executes the step                          | Who reads it                              |
| -------- | ---------------------------------------------- | ----------------------------------------- |
| `human`  | A person, via the web frontend                 | Web only                                  |
| `auto`   | The runtime host (backend worker, or the SDK)  | Backend worker; SDK when it is the host   |
| `custom` | The SDK / an external client                   | The SDK runtime, **only** when it is that client |

Read carefully: `auto` and `custom` are **not** symmetric.

- `auto` is read by *whatever runtime is currently hosting the run* — the
  backend worker when the backend runs it, the SDK runtime when `evaluate()`
  runs it. "auto" = "the runtime should run this".
- `custom` means "an external client runs this." The only situation where
  `custom` resolves to "run it here" is when the SDK `evaluate()` loop **is**
  that external client — i.e. the evaluation was both created and executed in
  the SDK via `aevaluate()`. In every other context (a `custom` step on a run
  the web created, or one the backend picked up), `custom` means "not mine" and
  the step is left for whoever the external client is.

### Where this is enforced in code

- **Planner** — `agenta/sdk/evaluations/runtime/planner.py`,
  `EvaluationPlanner._runnable_cells`:

  ```python
  manual_origins = {"human"} if execute_custom else {"human", "custom"}
  is_manual_annotation = step.type == "annotation" and step.origin in manual_origins
  # should_execute = not is_manual_annotation
  ```

  `execute_custom` is the context flag that says "I am the external client for
  custom steps." It is threaded `aevaluate() -> process_evaluation_source_slice
  -> EvaluationPlanner.plan/plan_bindings -> _runnable_cells`.

- **SDK host** — `agenta/sdk/evaluations/preview/evaluate.py`: wires a local
  evaluator runner for `origin != "human"` (so auto **and** custom), and calls
  the processor with `execute_custom=True`. The SDK is the custom client.

- **Backend host** — `api/oss/src/core/evaluations/tasks/processor.py`: wires
  runners only for annotation steps with `origin not in {"human", "custom"}`
  (auto only), and never sets `execute_custom` (defaults `False`). The backend
  leaves both human and custom alone.

  Confirmed in worker logs: a `custom` annotation processed by the backend
  resolves to `runner_keys=[]` and the slice completes with the step left
  pending — the backend does not run it.

### How the web labels runs (`custom` = "SDK")

The web does not store an authoritative "kind" — it **derives** it from the
run's step origins (`web/oss/src/lib/evaluations/utils/evaluationKind.ts`,
`deriveEvaluationKind`), priority order:

1. online (live / source-backed)
2. `human` — any annotation step with `origin="human"`
3. `custom` — any step with `origin="custom"`
4. `auto` — default

So in the UI a run containing `custom` steps is shown as the "SDK"/custom kind.
This is *load-bearing*: changing local-callable SDK evaluators from `custom` to
`auto` would silently reclassify every SDK evaluation as a backend `auto` run in
the UI. That is why local-callable evaluators created by `evaluate()` keep
`origin="custom"`, even though the SDK is the one running them.

### The tension this resolves

`custom` is overloaded: it means both "the SDK ran this" (when `evaluate()` is
the host) and "an external client owns this" (everywhere else). The
`execute_custom` flag is what disambiguates the two at runtime without changing
the stored origin — so the web's `custom`→"SDK" classification stays intact
while the backend correctly refuses to run custom steps.

## Future direction (proposal): `web` / `api` / `sdk` / `custom`

The cleaner long-term model replaces the *role-by-actor* origins with
*role-by-executor* origins. `origin` would name the executor that owns the step:

| origin   | Who executes the step                          |
| -------- | ---------------------------------------------- |
| `web`    | The web frontend (a person, in the browser)    |
| `api`    | The backend behind the API                     |
| `sdk`    | An Agenta SDK runtime (Python today, others later) |
| `custom` | Anything else — external scripts, third-party code; **no one in the platform picks it up** |

Each executor runs exactly the steps stamped with its own name; everyone else
treats the rest as no-ops. `custom` becomes a true "nobody here runs this" —
unlike today, where `custom` sometimes means "the SDK runs this."

This is strictly about **who runs a step in a slice**, independent of who
dispatched the job, who started the run, or who created it.

### Why this is cleaner — and the open problem it raises

- It removes the `auto`/`custom` overload. `auto` today secretly means "the
  current runtime host", which is ambiguous once there is more than one runtime.
- It removes the need for the `execute_custom` context flag: an `sdk` step is
  run by the SDK, full stop; an `api` step by the backend. No "am I the client
  for this?" question.

The open problem (and why we did **not** adopt this now): **the SDK runtime is
unified with the backend runtime.** The same planner/processor runs in both. If
both backend and SDK are "the runtime", what distinguishes an `api` step from an
`sdk` step beyond a label? And once there is a TypeScript SDK — a *different*
codebase also running evaluations — is that `sdk` too, or does it need its own
origin? A second candidate model ("web vs. runtime", only two values) collapses
under exactly this: it cannot tell a backend-run step from an SDK-run step,
because they share the runtime. The four-value `web/api/sdk/custom` model is the
one that survives multiple SDKs, at the cost of every executor having to know
its own identity.

### Implications

**Schema.** `origin` is currently `Literal["custom", "human", "auto"]` in both
`sdk/models/evaluations.py` and `core/evaluations/types.py`, stored inside the
run's `data.steps[].origin` (a `json` column, not `jsonb`). Moving to
`web/api/sdk/custom` is a value-domain change, not a column change — no DDL, but
every producer and reader of `origin` must agree on the new vocabulary
simultaneously, which is the hard part.

**Data migration.** Existing rows carry `human`/`auto`/`custom`. A migration
would remap stored step origins:

- `human` → `web`
- `auto`  → `api` (the backend was the implied runtime host for stored auto runs)
- `custom` → split: SDK-run customs → `sdk`; everything else → `custom`.
  This split is the lossy one — historically `custom` did not record *which*
  external client ran it. A backfill can only infer "this was an SDK run" from
  surrounding signal (e.g. the run was created via the SDK upsert path / has SDK
  meta), and must fall back to `custom` when it cannot prove `sdk`.

**Backward compatibility.** Run during the transition:

- Keep accepting the legacy literals on write; normalize to the new domain at
  the boundary (an adapter mapping `human/auto/custom` → `web/api/sdk/custom`),
  the same shape as the existing legacy adapters in the API (cf. the
  `__dedup_id__`/`testcase_dedup_id` normalization).
- The web's `deriveEvaluationKind` already special-cases `custom`; it would gain
  `sdk` and treat `web`/`api` as the new human/auto. Keep reading the legacy
  values for old runs.
- Dual-read for at least one deprecation window: planners must treat `api` and
  legacy `auto` identically on the backend, `sdk` and "legacy custom that the
  SDK runs" identically in the SDK, until all stored runs are migrated.

**Net.** The future model is cleaner conceptually but requires (a) every
executor to self-identify, (b) a lossy `custom`→`sdk` backfill, and (c) a
dual-read compatibility window. The shipped `human/auto/custom` + `execute_custom`
model is the pragmatic interim: it fixes the actual bug (the SDK not running its
own custom evaluators) without a vocabulary migration, and keeps the web's
existing `custom`→"SDK" classification working unchanged.
