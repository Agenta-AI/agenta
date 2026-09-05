# The interface

## The role this field plays

Classify the field before naming it. "Return the newest revision of each workflow" is a
result-shaping instruction. It says how to fold the result set. It is not a filter on a
revision's own fields, it is not a scope reference, and it is not a policy.

The request object already separates those roles:

| Field | Role |
| --- | --- |
| `<entity>_revision` | attribute filter |
| `<entity>_refs`, `<entity>_variant_refs`, `<entity>_revision_refs` | scope |
| `include_archived` | policy |
| `windowing` | result shaping |

The new field belongs with `windowing`, as a sibling.

## The proposed shape

```jsonc
POST /workflows/revisions/query
{
  "workflow_refs": [{"id": "..."}, {"id": "..."}, {"id": "..."}],
  "windowing": { "order": "descending", "limit": 50 },
  "grouping":  { "by": "artifact" }
}
```

```python
class RevisionGrouping(BaseModel):
    by: Literal["artifact", "variant"] = Field(
        description="Return the newest eligible revision within each parent.",
    )
```

The first release carries `by` and nothing else. It returns at most one revision per
requested parent. We dropped a `limit` field for "the newest N per parent", because no
caller asks for it today, and it forces a second SQL branch plus a page cursor over
parents that we cannot define yet. The section "What we removed after review" explains
that decision.

Each entity request model gains one optional field:

```python
grouping: Optional[RevisionGrouping] = Field(
    default=None,
    description=(
        "Return the newest revisions within each parent instead of a flat list. "
        "When set, `windowing.limit` and `windowing.next` count parents, not revisions."
    ),
)
```

The two limits compose, and that is a sign the split is correct. `grouping.limit` says how
many revisions to keep inside each parent. `windowing.limit` still caps how many parents
come back. They answer different questions, so they sit side by side.

## Rules the contract must state

1. When `grouping` is absent, behavior does not change at all.
2. `grouping` needs a non-empty list of parent references, and the API caps how many.
   The result is then bounded by the number of parents the caller named.
3. Selection order is fixed by the server, and `windowing.order` does not change it.
   Ascending order would otherwise select the oldest revision inside each parent, which
   contradicts the name of the feature.
4. `grouping` with `windowing.next`, `windowing.newest`, or `windowing.oldest` returns a
   client error. A revision cursor cannot page over parents. See the next section.
5. `grouping` with the environments `references` filter returns a client error. That
   filter compares neighboring rows in a history, so it needs the history intact.
6. A parent with no eligible revision produces no row. It does not produce an empty one.
7. `grouping.by: "variant"` groups by the variant that owns the revision.
   `grouping.by: "artifact"` groups by the artifact above the variant.

## Why the cursor is rejected rather than redefined

An earlier draft said `windowing.next` would page over parents. That does not work, and
the failure is easy to reach.

The response cursor is built from the last returned revision's id, in
`apis/fastapi/shared/utils.py`. Take parent A with revisions 100 and 80, and parent B with
revision 90. Page one folds to A/100 and sets the cursor to 100. Page two applies `id < 100`
before the fold, so it returns B/90, and a later page returns A/80. Parent A appears twice.

Paging over parents needs a parent-keyed cursor and a response contract that several of
the six endpoints do not have today. No caller needs it, so the first release rejects the
combination instead of half-supporting it.

## What "newest" must mean

The frontend does not treat the newest row as the latest revision.
`selectMostRecentWorkflowRevision` in `web/packages/agenta-entities/src/workflow/api/api.ts`
skips version 0 and ranks by `created_at`. Version 0 is an auto-created placeholder.

A fold that picks the newest row by id can therefore pick a placeholder that the frontend
then discards, and the parent disappears from the result. That is a regression, not a
speed-up.

So the server must decide eligibility before it selects, and the rule has to be written
down. Version 0 is not automatically excluded: `WorkflowsService` distinguishes an empty
placeholder from a configured revision that happens to be version 0.

The same question applies to flags. `WorkflowsService` sends some flags to SQL, drops
server-owned flags from that filter, builds the revisions, then matches the requested
flags again in Python. Folding first can drop a parent whose older revision would have
matched. The contract must say which of these it means:

- the newest revision that matches the filter, or
- the newest revision, returned only when it matches.

Until that is settled per endpoint, `grouping` combined with post-SQL flag matching
returns a client error.

## Naming

`by` takes `artifact` or `variant`, not the entity's own name. The git DAO calls the
parent levels artifact and variant, and one shared DTO serves six entity families. A
value of `workflow` would not read correctly inside a testset request.

The field names use `lower_snake_case`, which matches the rest of the request.

## Shapes we rejected

### Extending the shared `Windowing`

```jsonc
"windowing": { "limit": 1, "order": "descending", "group_by": "artifact" }
```

`Windowing` already carries folding concepts, `interval` and `rate`, so this looks
consistent at first. It fails on reach. 87 request models embed `Windowing`, and only six
have a parent column. The other 81 would accept `group_by` and ignore it, and a caller
could not tell the difference between a field that worked and a field that did nothing.

It also breaks the meaning of `next`. That token is a cursor over one flat stream.
Grouping changes what the stream contains.

### A limit on the reference

```jsonc
"workflow_refs": [{"id": "...", "limit": 1}]
```

`Reference` is an identity type carrying `id`, `slug`, and `version`. Result shaping is
not identity. No reader would predict finding a limit there.

This shape is not hypothetical. The testsets batch fetcher in
`web/packages/agenta-entities/src/testset/api/api.ts` already sent it, and the API silently
dropped it. That dead code is now removed, along with a docstring that described a
`ReferenceWithLimit` feature which never existed.

### An `is_latest` query flag

```jsonc
"workflow_revision": { "flags": { "is_latest": true } }
```

Rejected for meaning and for effect.

On meaning: the flags describe what a revision *is*. Some are derived from its own fields,
some are user-declared, and some are merged from the artifact during a read. None of them
depend on the revision's position in its own history. "Newest among its siblings" does,
and it changes when a sibling arrives.

On effect: flags are matched in Python after each model is built. A flag filter would
still cut the serialization and compression cost, so it is not useless, but it would keep
the database transfer and the model construction. Those are 531 ms of the 1916 ms we
measured. Selecting in SQL removes all of it.

## Where the DTO lives

`RevisionGrouping` goes next to `RevisionQuery` in the git core DTOs, because the git DAO
serves all six entity families and one implementation should serve all of them.

All six request models get the field in the same change. Adding it to workflows alone
would split a family that is identical today, and consistency across the six is worth
more than a smaller diff.

## What we removed after review

Three things left the first release. Each added a branch of implementation and testing
that no caller needs today.

**The `limit` field, for the newest N per parent.** Every caller we found wants exactly
one. Supporting N forces a second SQL path with `ROW_NUMBER`, and it makes the result size
unbounded again, which is the problem we set out to fix.

**Paging over parents.** Explained above. It needs a cursor the six endpoints do not have.

**Grouping on unbounded queries.** `grouping` needs explicit parent references. Without
them the fold still scans every revision in the project.
