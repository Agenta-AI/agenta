# Step Removal Semantics

## Decision

For now, evaluation step removal is **destructive**:

```text
remove_step -> prune the removed step's tensor cells
```

Removing a step means:

1. remove it from the active run graph
2. delete result cells for that step across scenarios and repeats
3. refresh/flush metrics that depended on that step
4. if the removed step is an input step, also remove scenarios that are sourced only from that step

This keeps the stored graph and stored tensor aligned with the current evaluation definition.

The alternative — archiving/deactivating steps while retaining historical cells — remains a valid future model, but it is **not** the model chosen for the current design.

## Why This Decision Exists

There are two coherent models for step lifecycle.

### Model A — Destructive removal

```text
stored graph  = current active graph
stored tensor = cells for the current active graph
```

A removed step no longer exists in the graph, and its cells are pruned.

### Model B — Archival lifecycle

```text
stored graph      = historical graph
active execution  = projection over active steps
stored tensor     = historical cells, including archived steps
```

An archived step remains historically present, but no longer participates in future work.

Both models are internally coherent. The current design chooses **Model A** because it is simpler, cleaner, and matches the existing unified-loop operation model.

## Existing Design Rationale For Remove + Prune

The existing eval-loop documents already leaned toward destructive removal for good reasons.

### Steps are immutable by reference

A step points to a concrete referenced revision. Changing a reference should not mutate the step in place.

Instead:

```text
change evaluator revision = remove old step + add new step
```

That preserves step identity semantics and avoids silently rewriting what a historical step meant.

### The graph defines tensor shape

The design treats graph steps as tensor dimensions:

- add a step -> add a tensor column dimension
- remove a step -> remove that tensor column's cells

This creates a simple invariant:

```text
current graph and current tensor have the same shape
```

### Remove + prune prevents stale state

If a step disappears but its result cells remain:

- cells exist for steps no longer in the graph
- metrics may still refer to retired steps
- UI needs to distinguish active from historical columns
- planner and topology logic need lifecycle-aware filtering

Pruning avoids all of that in the default path.

### The mutation model stays symmetric

The lower-level operation model remains clean:

```text
graph:  add_step / remove_step
tensor: populate / prune
```

That symmetry is useful for reasoning, implementation, and testing.

## Why Archival Was Considered

Archival has one major product advantage:

> it preserves auditability.

If a human evaluator or automatic evaluator is no longer active, retaining the old step and its cells would preserve:

- who evaluated what
- what outputs existed before the step was retired
- historical metric context
- a full explanation of past evaluation state

That is especially attractive if evaluations are treated as long-lived collaborative records rather than disposable execution definitions.

## Cost Of Destructive Removal

The chosen model deliberately gives up some history.

When a step is removed:

- its result cells are deleted
- metrics derived from it disappear from the active run
- prior human work for that step is no longer represented in the run tensor
- the run no longer explains that the step ever existed

If auditability becomes a product requirement later, destructive removal will not satisfy it by itself.

## Cost Of Archival

Archival avoids data loss, but it has broad implications across every layer of the system.

The rest of this document records those implications so the tradeoff remains explicit.

# Archival Implications

## 1. Model implications

Archival requires step lifecycle state, for example:

```python
archived_at: datetime | None
archived_by_id: UUID | None
```

A run would then contain two conceptual graphs:

```text
historical graph = all steps ever attached to the run
active graph     = historical graph minus archived steps
```

Any presence-style flags would need explicit semantics:

- `has_evaluators`
- `has_human`
- `has_auto`
- `has_custom`

For most product behavior, they would likely need to mean **active presence**, not historical presence.

If historical presence also matters, that would require separate query behavior or additional flags.

## 2. Data implications

Archived steps retain their tensor cells:

```text
scenario_id + step_key + repeat_idx
```

That preserves history, but results now divide into:

- active-step results
- archived-step results

Queries and APIs would need to decide whether they default to:

- active-only results
- all historical results
- or support explicit `include_archived_steps`

If archived steps remain embedded in JSON run data, active/historical filtering is service-derived and less relationally natural. If steps become first-class rows, lifecycle handling becomes cleaner but requires a larger schema refactor.

Archival also increases retained data volume over time because old cells remain instead of being pruned.

## 3. Metrics implications

Archival makes metric meaning more complex.

At minimum, the system would need to distinguish:

### Active metrics

Metrics over the current active graph, used for:

- current dashboards
- current summary views
- present-tense evaluation interpretation

### Historical metrics

Metrics including archived steps, used for:

- audit
- history
- lineage

Without that distinction, archived evaluators would continue to affect current dashboards.

Metric refresh would need to know whether it is computing over active steps only or over historical steps as well. Run mappings may also need lifecycle awareness so archived step mappings do not keep contributing to current aggregates.

## 4. Compute and planner implications

The planner would need to operate on **active steps only** by default.

Every execution path would need a shared helper such as:

```python
active_steps(run)
has_active_human_steps(run)
```

If archived steps remained in `run.data.steps`, raw iteration over `run.data.steps` would become unsafe.

`process(slice)` would need explicit semantics:

- `steps="all"` likely means all **active** steps
- archived steps require explicit inclusion for any historical replay or audit operation

Planner complexity would remain manageable if active filtering is centralized, but every planner, topology classifier, queue reconciler, and flag refresher would need to use the same lifecycle-aware projection.

## 5. Queue implications

Default queue eligibility would need to depend on **active** human steps:

```text
active default queue exists
and active human evaluator work exists
```

For default queues:

```text
step_keys=None
```

would need to mean all **active** queue-relevant steps, not all historical steps.

Custom queues that explicitly reference later-archived steps would need a policy, such as:

- retain the queue row
- stop generating active work for archived steps
- surface that the queue references inactive steps
- perhaps mark the queue degraded/inactive if all included steps are archived

## 6. API implications

Archival would require new lifecycle operations:

- `archive_step`
- `unarchive_step`

or equivalent run-mutation semantics.

Any response that exposes step definitions would need archival metadata so clients can distinguish active from historical steps.

The API would also need explicit lifecycle-aware query semantics, likely including some form of:

- active-only default behavior
- optional archived inclusion for audit/history views

Backward compatibility becomes non-trivial because older clients may assume every returned step is active.

## 7. UI implications

The UI would need an explicit active-versus-archived presentation model.

Likely implications:

- active steps shown normally
- archived steps grouped under a collapsed historical section
- current results tables show active columns by default
- archived result columns appear only in audit/history contexts or behind an explicit toggle
- current metric charts exclude archived steps by default
- historical metric views expose archived-step data intentionally
- queue screens show only active human work
- archived human work remains visible in evaluation history but not as new actionable queue work

Action labels would also need to change:

- ordinary user action: `Archive evaluator`
- stronger destructive action: `Delete step and results`

Without UI support for archived state, archival would preserve data technically but create user confusion.

## 8. Controller and service implications

Archival requires centralized lifecycle orchestration.

A step archive/unarchive transition would need to coordinate:

- active graph projection
- run flag recomputation
- queue reconciliation
- metric refresh
- possible custom-queue invalidation/degradation

Those changes should not be scattered across ad hoc call sites. They require one authoritative lifecycle path.

## 9. Conceptual implication

Archival changes the core invariant from:

```text
stored tensor = current graph
```

to:

```text
stored tensor = historical graph
active execution = projection over active graph
```

That is a richer but more expensive model.

# Destructive Removal Implications

## 1. Model implications

No additional step lifecycle state is required.

The run graph remains:

```text
run.data.steps = active graph
```

Presence flags continue to reflect the graph directly.

## 2. Data implications

Removed step cells are deleted.

This avoids:

- stale cells
- historical-vs-active result interpretation
- extra retained data volume for removed steps

But it sacrifices historical traceability inside the run.

## 3. Metrics implications

Metric handling stays simple:

- prune step cells
- refresh/flush dependent metrics
- current metrics remain aligned with the current graph

No separate active/historical metric families are required.

## 4. Compute and planner implications

Planner logic remains simpler:

- every step in the graph is active
- `steps="all"` means literally every stored step
- topology validation does not need step lifecycle filtering

## 5. Queue implications

Queue eligibility can be computed from the current graph without active/historical distinction.

A removed human step no longer contributes to queue eligibility because it no longer exists.

## 6. API implications

Only destructive graph operations are needed:

- `add_step`
- `remove_step`

No step archive/unarchive surface is required.

## 7. UI implications

The UI stays much simpler:

- no archived-step sections
- no archived-result toggles
- no historical metric mode
- “remove” means the thing is gone

The downside is that users cannot inspect retired step history through the run afterward.

## 8. Controller implications

Mutation side effects remain narrow:

- remove step
- prune cells
- refresh metrics
- if needed, reconcile queue flags from the new active graph

No long-lived archival state needs to remain synchronized.

# Comparison

| Concern | Destructive remove + prune | Archive/deactivate |
|---|---|---|
| Auditability | weak | strong |
| Current-state simplicity | strong | weaker |
| Storage growth | lower | higher |
| Planner complexity | lower | higher |
| Metric semantics | simple | active vs historical required |
| UI complexity | lower | higher |
| Queue semantics | simpler | must ignore archived steps |
| API lifecycle surface | smaller | larger |
| Graph/tensor invariant | identical current graph/tensor | historical storage + active projection |

# Current Choice

The current unified-eval-loop design chooses:

```text
remove + prune
```

as the normal behavior.

This is intentionally destructive, and the tradeoff is accepted for now because it provides:

- a clean graph/tensor invariant
- simpler planning and topology logic
- simpler metrics
- simpler UI/API behavior
- direct alignment with the existing operation model

If auditability becomes a product requirement later, the design should be revisited explicitly rather than approximated halfway. A future archival model would need full support across:

- step lifecycle metadata
- active/historical result semantics
- metric semantics
- queue eligibility
- APIs
- UI
- planner defaults

Until then, retaining removed-step cells without modeling archival everywhere is not acceptable because it would introduce ambiguity without delivering coherent auditability.
