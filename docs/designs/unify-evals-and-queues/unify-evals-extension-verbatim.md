Yes — I think this is a better model than the one I was circling around before.

It gives each fact its own place instead of forcing `is_queue` to carry a hidden runtime meaning that does not match its name.

## The revised flag model

### Add inferred source flags

Alongside:

- `has_queries`
- `has_testsets`
- `has_evaluators`

add:

- `has_traces`
- `has_testcases`

Then the source family becomes explicit:

| Source shape | Flags |
|---|---|
| query-backed | `has_queries=True` |
| testset-backed | `has_testsets=True` |
| externally supplied traces | `has_traces=True` |
| externally supplied testcases | `has_testcases=True` |

That gives us the right vocabulary for:

- validation
- topology classification
- query filtering
- avoiding mixed source families
- distinguishing declared sources from externally supplied concrete items

And importantly:

> that source distinction does not need to be smuggled through `is_queue`.

I like that a lot.

## Then redefine `is_queue`

Under your proposal:

```text
is_queue = there is an active default queue
           and at least one active human evaluator step
```

or more plainly:

```text
this evaluation is currently interactable as a simple annotation queue
```

That is much more intuitive.

It answers the product-relevant question:

> Can this run be interacted with through the simple queue / annotation queue surface?

And it can turn off when:
- the default queue is archived
- there are no active human evaluator steps

That means `is_queue` is no longer an execution/input-source flag. It becomes a derived **human-work availability** flag.

I think that is actually the right use of the name.

## The clean separation becomes

| Fact | Where represented |
|---|---|
| declared query source | `has_queries` |
| declared testset source | `has_testsets` |
| external trace source | `has_traces` |
| external testcase source | `has_testcases` |
| has evaluators | `has_evaluators` |
| has active human evaluators | `has_human` or eventually `has_active_human` if step archival becomes explicit |
| can be used via simple queues | `is_queue` |
| this particular queue is canonical | `EvaluationQueue.flags.is_default` |

That is much clearer.

---

# A few important consequences

## 1. `is_queue` can no longer be derived from the run alone

Today run flags are derived only from run data.

Under this model, `is_queue` depends on:

- run graph state
- queue existence
- queue archival state

So we should stop thinking of all run flags as purely “derived from steps.”

Some are graph-derived:
- `has_queries`
- `has_testsets`
- `has_traces`
- `has_testcases`
- `has_evaluators`
- `has_human`
- `has_auto`

But `is_queue` is relationship/lifecycle-derived:
- active default queue exists
- active human work exists

That is fine, but it means the reconciliation path needs to update the run flag whenever the default queue is created, archived, or unarchived.

## 2. `has_traces` / `has_testcases` solve the current synthetic-source hack

Right now the code has this awkward logic:

```python
if flags.is_queue and not _references:
    inspect step_key text for "query" or "testset"
```

That exists because direct queues use synthetic input steps and the system still wants to classify them as trace/testcase-ish through the old flags.

With explicit:

- `has_traces`
- `has_testcases`

we can stop overloading:
- `has_queries` to mean “trace-like”
- `has_testsets` to mean “testcase-like”
- `is_queue` to help infer source family from missing references

That should make validation and topology much more honest.

## 3. Source-backed human evaluations can naturally be simple queues

Then your desired product rule becomes straightforward:

```text
simple queue eligible
iff
run.is_queue == True
```

because `is_queue` now means exactly:

```text
active default queue + active human evaluator work
```

So:

| Run | `is_queue` |
|---|---:|
| query-backed + human evaluator + active default queue | true |
| testset-backed + human evaluator + active default queue | true |
| direct traces + human evaluator + active default queue | true |
| direct testcases + human evaluator + active default queue | true |
| auto-only eval with eager default queue | false |
| human eval whose default queue is archived | false |

That is much more useful than the current meaning.

---

# On the default queue itself

Yes: I think we need an explicit queue flag:

```python
EvaluationQueueFlags.is_default: bool
```

because shape alone is not enough once custom queues exist. A custom queue could happen to also have:

- no scenario filter
- no step filter
- no assignments

and still not be the canonical default queue.

## Default queue invariants

For `is_default=True`, enforce:

```text
scenario_ids is None
step_keys is None
user_ids is None
```

You mentioned “no repeat index”; today queues do not have a repeat-index filter field, so in current schema that translates to **no assignments**, because assignment lanes are the queue-level way repeats are partitioned. If repeat-index filtering is later added explicitly, then yes, default queues should also forbid that.

And I agree with the behavior:

- default queue archived → it still exists
- creating another default queue for same run should fail
- reconciliation should unarchive the existing one rather than create a second row

So the invariant is:

```text
at most one default queue per run, including archived queues
```

That likely wants a real uniqueness guarantee, not just service logic. Since `is_default` inside JSONB flags is awkward for constraints, I would at least consider making `is_default` a real DB column or adding an explicit indexed field rather than burying it only in JSON flags. If we keep it only inside JSONB, enforcement is still possible but less pleasant and less obvious.

---

# On simple queue identifiers

Yes — today the simple queue endpoints are queue-ID-centric.

If after unification the simple queue is fundamentally:

```text
the simple projection of the run’s default queue
```

then using the **run ID** is probably the better canonical identifier for that surface.

Because the user-facing thing is increasingly “the evaluation’s queue,” not “some arbitrary queue row.”

## Compatibility shape

Your compatibility idea is reasonable:

- if the identifier resolves to a queue ID, use that queue
- otherwise, if it resolves to a run ID, fetch that run’s default queue
- eventually prefer run IDs in the new API/UI paths

Since both are UUIDs, this is a pragmatic compatibility shim rather than a semantically clean contract. It works, but the implementation should be careful and deterministic:

1. try queue ID lookup first
2. if no queue exists, try default queue by run ID
3. if both could theoretically exist, queue ID wins

UUID collision across tables is extraordinarily unlikely, but the precedence should still be explicit.

Longer term, I would probably prefer:
- queue-specific endpoints remain queue-ID based
- simple queue endpoints become run-ID based
- maybe add explicit routes like `/simple/queues/by-run/{run_id}` during transition

But as an internal compatibility move, your suggestion is sound.

---

# The resulting model is much stronger

I would now summarize it this way:

```text
Source flags describe where scenarios come from:
  has_queries
  has_testsets
  has_traces
  has_testcases

Queue flags describe queue identity:
  is_default

Run.is_queue describes product eligibility:
  active default queue + active human evaluator work

SimpleQueue is the simplified API view over:
  the run's default queue
```

That gives each concern one home.

It also removes the awkwardness where a run could “have a queue” but `is_queue=False`, or have `is_queue=True` mostly because it accepts source batches. Under your model, the name and the meaning line up again.

## One thing I would still decide explicitly

Whether `is_queue` should be persisted at all or always recomputed.

Because it depends on both:
- run state
- queue state

If it is persisted, reconciliation must update it transactionally whenever:
- default queue created
- default queue archived/unarchived
- active human evaluator steps appear/disappear

If it is recomputed, queries become more expensive or need joins.

Given that you explicitly want it queryable, persisting it as a denormalized derived flag is reasonable — but then I would treat **default queue reconciliation + run flag refresh** as one logical operation.

This is a much cleaner design than the earlier alternatives.

---

Yes — on both points.

## 1. Uniqueness for the default queue

`scenario_ids`, `step_keys`, and `user_ids` all currently live inside `EvaluationQueueData`, which is stored in the queue’s JSON `data` column. So if we define the default queue only by the shape:

```text
scenario_ids is None
step_keys is None
user_ids is None
```

then a normal relational unique index over those fields is not straightforward.

You could technically build expression indexes over JSON paths, but that would be a poor foundation for a first-class invariant like:

```text
at most one default queue per run
```

I think your instinct is right: if **defaultness** matters enough to enforce uniqueness, it wants a first-class indexed column.

### Recommended shape

Add something like:

```python
is_default: bool
```

as a real queue column, even if it is also mirrored into DTO flags for API symmetry.

Then enforce:

```text
unique(project_id, run_id) where is_default = true
```

That gives you the exact invariant you want:

- only one default queue per run
- archived default queue still occupies the slot
- trying to create another default queue fails
- reconciliation can find and unarchive the existing one

And separately, enforce in service validation:

```text
if is_default:
    scenario_ids must be None
    step_keys must be None
    user_ids must be None
    batch settings must be None
```

The uniqueness invariant should key on **identity** (`is_default`), not on a coincidental combination of empty filters.

That is much safer than saying “whichever queue happens to have no filters is default.”

## 2. Simple queues can stay queue-ID based if default queue lookup is easy

I agree with your revised take.

If we add a very small direct way to fetch the default queue for a run, then we do **not** need to overload simple queue identifiers with run IDs.

Something like:

```http
GET /evaluations/runs/{run_id}/queue
```

or more explicitly:

```http
GET /evaluations/runs/{run_id}/default-queue
```

would be enough.

Then the flow becomes:

1. evaluation screen has `run_id`
2. fetch default queue in one cheap call
3. receive `queue_id`
4. use existing simple queue endpoints with `queue_id`

That preserves the clean existing identity model:
- queue resources use queue IDs
- runs use run IDs
- no ambiguous UUID interpretation
- no compatibility shim needed unless product wants one for some other reason

I’d favor:

```http
GET /evaluations/runs/{run_id}/default-queue
```

because it is unambiguous and leaves room for other queue relationships later.

Possibly also:

```http
POST /evaluations/runs/{run_id}/default-queue/archive
POST /evaluations/runs/{run_id}/default-queue/unarchive
```

if we want run-scoped convenience operations, though the generic queue archive/unarchive endpoints may already be enough.

## 3. Persisting `run.flags.is_queue`

I agree with you.

Because we want:

- cheap filtering
- parity with the other persisted inferred run flags
- no joins for the common read paths
- and queue archival/unarchival is a meaningful state transition anyway

then `is_queue` should be persisted and eagerly maintained.

Under the new meaning:

```text
run.flags.is_queue =
    active default queue exists
    and active human evaluator work exists
```

And yes, that means queue lifecycle operations must update the run flags eagerly:

| Event | `run.flags.is_queue` effect |
|---|---|
| default queue created and human work exists | `true` |
| default queue unarchived and human work exists | `true` |
| default queue archived | `false` |
| last active human evaluator archived | `false` |
| human evaluator added/restored while default queue active | `true` |

This is analogous to the other denormalized flags:
- they are persisted
- they are inferred/maintained eagerly
- query paths stay cheap

The only thing I would be careful about is **where** that synchronization lives. I would want one narrow service-level operation that owns the invariant, rather than scattered manual edits:

```text
reconcile_default_queue_and_run_flags(...)
```

or maybe two lower-level pieces used transactionally:

```text
reconcile_default_queue(...)
refresh_run_flags(...)
```

But conceptually, yes: persist it and keep it in sync.

## Updated model after your refinements

```text
EvaluationRunFlags
  has_queries
  has_testsets
  has_traces
  has_testcases
  has_evaluators
  has_human
  has_auto
  is_queue        # can be used via simple queue surface

EvaluationQueue
  is_default      # first-class indexed identity field

Default queue invariant
  at most one per run
  scenario_ids=None
  step_keys=None
  user_ids=None
  no batching constraints

Simple queue endpoints
  remain queue-ID based

Default queue lookup
  add a direct run-scoped endpoint to get queue_id cheaply
```

That feels quite settled to me now.

---

Yes — if `is_default` is materialized inside the queue `flags` JSONB, then Postgres can enforce uniqueness from that directly. We do **not** necessarily need a dedicated physical column just for the index.

For example, conceptually:

```sql
CREATE UNIQUE INDEX ux_evaluation_queues_default_per_run
ON evaluation_queues (project_id, run_id)
WHERE (flags ->> 'is_default')::boolean = true;
```

That would give us the important invariant:

```text
at most one default queue per run, including archived rows
```

because archived rows still satisfy the partial-index predicate.

So yes: if we are comfortable treating `flags.is_default` as a materialized persisted field, a partial unique index over the JSONB expression is enough.

The tradeoff is mainly ergonomics:
- **JSONB expression index**: no extra column, keeps queue flags grouped together
- **real column**: easier to inspect/query/index conventionally

But technically, your approach is sound, and in this codebase it may be the more consistent choice if other queue flags already live in JSONB.

And agreed: **no** to run-scoped archive/unarchive endpoints.

We only need:
- generic queue archive/unarchive operations
- plus a simple way to fetch the default queue for a run

So the useful addition is something like:

```http
GET /evaluations/runs/{run_id}/default-queue
```

but not special lifecycle endpoints hanging off the run.
