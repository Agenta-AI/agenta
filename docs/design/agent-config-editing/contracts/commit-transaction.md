# Contract: the atomic commit transaction and its response

Status: proposed. It answers must-fix item 2 of the design gate review.
Owner: engine-spike. Date: 4 August 2026.

This document defines one transaction. It also defines the wire response for a commit
that changes nothing, and for a commit built on a stale base.

## 1. What the code does today

Three separate transactions run for one delta commit.

| Step | Code | Session |
|---|---|---|
| Read the head | `_resolve_revision_delta` calls `fetch_workflow_revision` | its own |
| Enrich the data | `commit_workflow_revision` | none |
| Insert | `workflows_dao.commit_revision` opens `self.engine.session()` | its own |

Sources: `api/oss/src/core/workflows/service.py:1852` (commit),
`api/oss/src/core/workflows/service.py:1984` (`_resolve_revision_delta`),
`api/oss/src/dbs/postgres/git/dao.py:1565` (`commit_revision`).

Four facts matter for the design.

1. **A row lock already exists, for one case only.** `commit_revision` locks the variant
   row with `SELECT ... FOR UPDATE` when `initial=True`
   (`api/oss/src/dbs/postgres/git/dao.py:1606`). The mechanism is there. We extend it.
2. **The DAO swallows exceptions.** `commit_revision` carries
   `@suppress_exceptions(exclude=[InitialRevisionConflict])`. Any other exception becomes
   a log line and a `None` return (`api/oss/src/utils/exceptions.py:85`). A conflict error
   raised inside the DAO would disappear.
3. **The service enriches the data after the read and before the insert.** It normalizes
   snippet data, infers `url` from `uri`, merges the interface `schemas`, infers the
   `outputs` schema, and infers `flags`. All five helpers are synchronous and do no I/O
   (`sdks/python/agenta/sdk/engines/running/utils.py:518,586,663,702,966`).
4. **The router invalidates the cache and emits a second event, always.** It calls
   `invalidate_cache` and `_emit_committed_revision_data_event` after every commit
   (`api/oss/src/apis/fastapi/workflows/router.py:1557`). The service emits
   `publish_revision_event` separately.

## 2. The invariant

> Between the head read that the change set applies to, and the insert of the new
> revision, no other revision for that variant may be inserted.

A comparison that lives only in `_resolve_revision_delta` does not give this. Two callers
can both read head N, both pass the base check, and both insert. The head must be read
under a lock that the insert holds until it commits.

## 3. The transaction

One database session. One `SELECT ... FOR UPDATE` on the variant row. Everything else
happens inside.

```text
BEGIN
 1. SELECT * FROM variants WHERE project_id = ? AND id = ? FOR UPDATE
    -> variant missing: ROLLBACK, 404
 2. SELECT the latest non-archived revision for that variant  -> head
 3. IF base_revision_id is present AND base_revision_id != head.id
       -> ROLLBACK, 409 revision_conflict            (section 6)
 4. candidate = build(head)                          (section 4, pure, no I/O)
       -> ChangeSetError: ROLLBACK, 422              (change-set.md section 10)
       -> NonEmbeddableWorkflowReferenceError: ROLLBACK, 422
 5. validate(candidate)                              (schema + unique names)
       -> issues: ROLLBACK, 422 final_validation_failed
 6. canonical_new  = canonicalize(candidate)         (section 5)
    canonical_head = canonicalize(head)
 7. IF canonical_new == canonical_head
       -> COMMIT (nothing was written), status = no_change, return head
 8. INSERT the new revision row
 9. compute and store the version number
COMMIT
 -> status = committed, return the new revision
```

Step 7 commits an empty transaction only to release the lock. It writes no row.

### 3.1 The seam in code

`commit_revision` grows a checked sibling. The service keeps its enrichment logic, but
gives it to the DAO as a callback, because the callback must run while the lock is held.

```python
async def commit_revision_checked(
    self, *, project_id, user_id, variant_id,
    base_revision_id: Optional[UUID],
    build: Callable[[Optional[Revision]], BuildOutcome],
) -> CommitOutcome:
    ...
```

Three rules on `build`:

1. It is synchronous. It must not `await`. An await inside an open transaction that holds
   a row lock is a deadlock risk and a lock-hold-time risk.
2. It does no I/O. It calls the engine and the five enrichment helpers. All are pure.
3. It raises `ChangeSetError` or `ValidationError`. It never returns a partial tree.

`commit_revision_checked` must add `RevisionConflict` and `ChangeSetError` to the
`suppress_exceptions(exclude=[...])` list. Fact 2 of section 1 explains why. Without it,
a 409 becomes a silent `None`, and the router answers `count: 0`.

### 3.2 Lock scope and cost

The lock is one row, in one project, for one variant. It is held for the length of a pure
in-memory transformation over a configuration tree of at most a few hundred kilobytes.
Two commits to the same variant queue. Two commits to different variants do not meet.

A statement timeout must bound the wait. A caller that waits longer than the timeout gets
503, not a hung request.

## 4. `build`: what it does, in order

```text
build(head):
  base      = head.data as a plain dict, or {} when the variant has no data revision
  result    = apply_change_set(base, delta, scope_policy, validate=None)
  data      = WorkflowRevisionData(**result.data)
  data      = normalize_snippet_data(data)
  data      = infer url from uri                 (when uri is set and url is not)
  data      = merge interface schemas            (retrieve_interface + infer_outputs_schema)
  reject_non_embeddable_workflow_embeds(data)    (MANDATORY, see 4.1)
  flags     = infer_flags_from_data(...)
  return BuildOutcome(data=data, flags=flags, warnings=result.warnings)
```

A full-data commit skips the engine and starts from the supplied `data`. Every later step
is identical, so both paths produce the same canonical form.

### 4.1 The non-embeddable-reference check stays

`commit_workflow_revision` calls `_reject_non_embeddable_workflow_embeds` today
(`api/oss/src/core/workflows/service.py:1884`, definition at `:1353`). The checked
transaction must keep it. It is not optional, and it is not a legacy step.

The check scans the finished configuration for `@ag.embed` references, and it refuses a
reference to a static workflow that may not be embedded. It raises
`NonEmbeddableWorkflowReferenceError`. Dropping it would let a change set write an embed
that the old path refused, so the ordered form would be weaker than the legacy form.

Three properties make it fit inside the lock:

1. It is synchronous, and it does no I/O. It reads the dumped configuration and the
   in-memory static catalog.
2. It runs on the FINAL data, after every enrichment step. An embed can arrive through an
   operation value, so the check must see the result, not the delta.
3. It maps to 422, like every other change-set refusal. The reason code is
   `non_embeddable_reference`. Add it to the reason table of `change-set.md` section 10 as
   a wrapper-owned code, and add `NonEmbeddableWorkflowReferenceError` to the
   `suppress_exceptions(exclude=[...])` list of section 3.1.

## 5. Canonicalization and the equality test

The comparison happens on the form that would be stored, not on the engine's output. The
enrichment of section 4 fills `url`, `schemas`, and `flags`. The stored head already went
through the same pipeline. A comparison before enrichment reports a change when only the
enrichment differs.

### 5.1 The comparison covers every persisted behavior-bearing field

`data` alone is not enough. `flags` is computed by `infer_flags_from_data` and stored in
its own column (`api/oss/src/dbs/postgres/git/dao.py:1596`). Two revisions can hold equal
`data` and different `flags`, because the flag inference can change between deployments.
A comparison over `data` alone would then answer `no_change` for a commit that really does
change behavior, and the new flags would never reach the database.

So the comparison covers a record, not a tree:

```text
canonical(revision_like) = {
    "data":  json_dump(data,  exclude_none=True),
    "flags": json_dump(flags, exclude_none=True),
}
with every object key sorted, recursively, at every depth
```

- `json_dump` is `model_dump(mode="json", exclude_none=True)`, the same call the insert
  path uses. The comparison must use the persisted form, not the in-memory objects.
- The head side reads `head.data` and `head.flags` from the stored row. It does NOT
  re-infer them. A re-inference would hide exactly the drift this rule exists to catch.
- Both sides sort object keys recursively, so key order never decides the answer.

**Behavior-bearing means: the field changes what a run does.** `data` and `flags` do.
Section 5.2 lists what does not.

### 5.2 What stays out of the comparison

| Field | In the comparison | Why |
|---|---|---|
| `data` | yes | It is the configuration. |
| `flags` | yes | It routes and gates the run. Section 5.1. |
| `message` | no | Commit metadata. |
| `name`, `description` | no | Revision metadata. |
| `tags`, `meta` | no | Labels. They do not change a run. |
| `slug`, `id`, `version`, `author`, `date` | no | Identity, assigned at insert. |

A commit that changes only a field in the second group is a no-change commit. It creates
no revision. A caller who wants to record a message with no configuration change must be
told that no revision was created; the `no_change` status and its warning do that.

This is a deliberate call, and it has a cost: an agent cannot leave a note in the history
without changing something. Section 12 lists it as an open item.

### 5.3 Three rules

1. **Validate before you compare.** An invalid change set must fail with 422, even when
   its result would equal the head. A caller who sends a bad operation must learn that.
2. **Compare the canonical persisted record.** Section 5.1 defines it. `message`, `name`,
   `description`, `tags`, and `meta` stay out.
3. **List order is data.** Two `tools` lists with the same entries in a different order
   are not equal. `add_item` appends, so a remove-then-add of the same entry moves it to
   the end and is a real change.

## 6. Precedence

The order is fixed. A stale base always wins.

1. The variant does not exist: 404.
2. `base_revision_id` is present and does not equal the head: **409**.
3. The change set fails: 422.
4. The non-embeddable-reference check fails: 422. Section 4.1.
5. Final validation fails: 422.
6. The canonical record equals the head record: **200 `no_change`**. Section 5.1.
7. Otherwise: **200 `committed`**.

Rule 2 beats rule 6 on purpose. A stale caller can produce a result that happens to equal
the new head. Answering `no_change` would tell that caller its base was current. It was
not. The caller must re-read and decide again.

### 6.1 The 409 body

```json
{
  "detail": {
    "code": "revision_conflict",
    "message": "The workflow head changed. No revision was committed.",
    "base_revision_id": "019c-old",
    "current_revision_id": "019c-new",
    "current_revision_version": "17",
    "retryable": true
  }
}
```

The body carries the current head id, so the agent can read that exact revision in one
step. It does not carry the configuration. That would recreate the large-payload problem
the whole project exists to remove.

## 7. The response

The review is right that a warning plus a head id does not fit the existing shape.
`WorkflowRevisionResponse` returns a complete revision, and the playground refresh path
depends on it (`api/oss/src/apis/fastapi/workflows/models.py:387`,
`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:838`).

So the response always carries a complete revision. Two fields are added.

```python
class WorkflowRevisionResponse(BaseModel):
    count: int
    workflow_revision: Optional[WorkflowRevision]
    resolution_info: Optional[ResolutionInfo]
    retrieval_info: Optional[RetrievalInfo]
    # new
    status: Optional[Literal["committed", "no_change"]] = None
    warnings: Optional[List[CommitWarning]] = None
```

- On `committed`, `workflow_revision` is the new revision. `count` is 1.
- On `no_change`, `workflow_revision` is the **current head**, complete and unchanged.
  `count` is 1. Every existing consumer keeps working: it gets a real revision, and a
  refresh with it is correct.
- `status` is absent on the paths that do not use the checked commit. A reader must treat
  an absent `status` as `committed`.

```python
class CommitWarning(BaseModel):
    code: str
    message: str
    target: Optional[List[Union[str, TargetSelector]]] = None
    operation_index: Optional[int] = None
```

The warning codes are in `change-set.md` section 7.1, plus one the wrapper owns:

| Code | When |
|---|---|
| `no_change` | The commit produced no new revision. |

The engine returns warnings. The wrapper puts them on the response. This is the answer to
the D33 / O8 contradiction the review found.

## 8. `base_revision_id`

| Caller | Rule |
|---|---|
| Ordered delta | Required. A missing value is 422 `invalid_delta`. |
| Legacy delta from the runner | The runner fills it from `$ctx.workflow.revision.id` when the model omits it. This is defaulting, not binding: a model-supplied value wins. |
| Legacy delta, direct API call | Optional. When absent, no base check runs, and today's last-write-wins behavior stays. A warning says so. |
| Full-data commit | Optional, same rule. |

The default must NOT go through `context_bindings`. That mechanism overwrites a
model-supplied value (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:91`). An agent
that hit a 409 would stay pinned to its stale run revision and could never retry inside
the same run. The runner fills the field only when it is absent.

On a draft run there is no `$ctx.workflow.revision.id`. The runner therefore fills nothing,
and no base check runs for a legacy draft-run commit. An ordered delta still needs the
value from the model. `read-config.md` section 10.1 states the single rule and names the
state source.

## 9. Events and cache

| Path | `publish_revision_event` | `_emit_committed_revision_data_event` | `invalidate_cache` |
|---|---|---|---|
| `committed` | yes | yes | yes |
| `no_change` | **no** | **no** | **no** |
| 409 / 422 | no | no | no |

The router calls `invalidate_cache` and `_emit_committed_revision_data_event`
unconditionally today (`api/oss/src/apis/fastapi/workflows/router.py:1557`). Both calls
must become conditional on `status == "committed"`.

This is not only tidiness. A commit event evicts the warm session. A no-change commit that
emitted the event would throw away a warm sandbox for nothing, which is exactly the cost
RFC Q5 wants to remove.

## 10. Errors across the router decorators

The commit endpoint carries `@intercept_exceptions()` and
`@suppress_exceptions(default=..., exclude=[HTTPException])`. A `ChangeSetError` or a
`RevisionConflict` that reaches that decorator becomes a default response, not a 4xx.

The service layer must therefore translate:

| Internal | HTTP |
|---|---|
| `ChangeSetError` | `HTTPException(422, detail=error.to_detail())` |
| `NonEmbeddableWorkflowReferenceError` | `HTTPException(422, reason `non_embeddable_reference`)` |
| `RevisionConflict` | `HTTPException(409, detail={...})` |

The translation lives at the service or router boundary, and `HTTPException` is already
excluded from suppression.

## 11. Tests this contract requires

1. **Two writers, one winner.** Two concurrent commits on one variant, both built on head
   N. Exactly one gets 201-equivalent `committed`. The other gets 409 with
   `current_revision_id` equal to the winner's id. Run it against a real database, with
   two sessions.
2. **No-change against a moving head.** A stale commit whose result equals the NEW head
   must get 409, not `no_change`.
3. **No-change is clean.** A commit whose result equals its own base head returns
   `no_change`, inserts no row, publishes no event, and invalidates no cache. Assert the
   revision count before and after.
4. **Validation beats no-change.** A change set with an invalid operation whose result
   would equal the head returns 422.
5. **Canonical equality.** A commit that only reorders object keys is `no_change`. A
   commit that only reorders a list is `committed`.
6. **Message-only commit.** A new `message` with an identical tree is `no_change`.
7. **Enrichment parity.** A full-data commit and an equivalent delta commit produce the
   same canonical stored data.
8. **Suppression.** A forced `RevisionConflict` inside the DAO reaches the client as 409,
   not as `count: 0`. Repeat it for `NonEmbeddableWorkflowReferenceError` and 422.
9. **Lock timeout.** A commit that waits longer than the statement timeout fails loudly.
10. **Flags decide equality.** A commit with identical `data` but different inferred
    `flags` returns `committed`, and the stored row carries the new flags. Force the
    difference by changing what `infer_flags_from_data` sees, not by writing flags
    directly. Section 5.1.
11. **Flags are read, not re-inferred.** The head side of the comparison uses the stored
    `flags` column. A test changes the inference rule, leaves `data` alone, and asserts
    `committed`.
12. **The embed check survives.** A change set that writes an `@ag.embed` reference to a
    non-embeddable static workflow returns 422 `non_embeddable_reference`, through both
    the ordered form and the legacy form. Section 4.1.
13. **The embed check sees the result.** The embed arrives through an operation `value`,
    not through the base. The check must still catch it.

## 12. Open items

1. **Where does `build` live?** It must run inside the DAO's session, but it is service
   logic. The callback keeps the layering. An alternative is to move the head read into
   the service and pass an open session down. The callback is smaller and is preferred.
2. **Archived revisions.** The head read uses `include_archived=False`, like
   `fetch_workflow_revision` today. Confirm that archiving the head cannot make an older
   revision the base for a commit that a caller built on the archived one.
3. **The v0 seed.** A variant with a null-data seed revision has `data = None`. `build`
   starts from `{}`. Confirm the resulting first real revision numbers correctly, because
   `commit_revision` nulls the fields of version `0`
   (`api/oss/src/dbs/postgres/git/dao.py:1668`).
4. **Statement timeout value.** Pick it with the team, and make it an env setting through
   `api/oss/src/utils/env.py`.
5. **A message-only commit creates nothing.** Section 5.2 keeps `message` out of the
   comparison, so an agent cannot leave a note in the history without a real change. If
   the team wants a note-only revision, that is a new decision, and it needs its own
   status value.
6. **Product call 12, storing the authored operations.** The gate lists it as blocking
   this contract. If we store the operations, the persisted record grows a field. Decide
   before the wrapper lands, or accept a schema migration later.

## 13. Gate 2 resolution

Gate 2 marked item 2 PARTIAL, with two named gaps. New problem 6 restates both.

| Gate point | Answered in |
|---|---|
| §4 omits `_reject_non_embeddable_workflow_embeds` | Section 4 pseudocode, and section 4.1 for the rules, the error code, and the placement after enrichment. |
| §5 claims flags are canonicalized, but compares only `data` | Section 5.1. The comparison covers `data` and `flags` as one record. Section 5.2 lists what stays out and why. |
| Canonical equality must cover every persisted behavior-bearing field | Section 5.1 defines "behavior-bearing". Section 5.2 gives the full field table. |
| The checked build must retain the embed check | Section 4.1, point 2: it runs on the FINAL data, so an embed that arrives through an operation value is caught. |

Supporting changes: section 3 pseudocode step 4, section 6 precedence steps 4 and 6,
section 10 error translation, and tests 8 and 10 to 13.

Still open from gate 2, and not in this contract's scope: item 7, the slice plan, and
item 8, the mixed-version rollout order and kill switch. Both live in `plan.md`.
