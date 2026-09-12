# The interface

## What the caller asks for

A grouped revision query makes two choices:

1. `by` divides matching revisions by their parent.
2. `get` selects one revision from each group.

Both fields shape the result set, so they belong in one top-level `grouping` object beside
`windowing`. They do not belong in `<entity>_revision`, which filters attributes of an
individual revision.

```jsonc
POST /workflows/revisions/query
{
  "workflow_refs": [{"id": "..."}, {"id": "..."}],
  "grouping": {
    "by": "artifact",
    "get": "latest"
  }
}
```

This reads as: group revisions by workflow and get the latest eligible revision from each
group. The response remains a flat list.

For the latest revision of each variant under the requested workflows:

```jsonc
{
  "workflow_refs": [{"id": "..."}],
  "grouping": {
    "by": "variant",
    "get": "latest"
  }
}
```

## Request model

```python
class RevisionGrouping(BaseModel):
    by: Literal["artifact", "variant"]
    get: Literal["latest"]
```

`get` is required. `grouping.by` alone would leave the selection rule implicit. It could
reasonably mean a nested response, an aggregate, or a first row. Requiring both fields makes
the operation explicit and leaves room for another selection rule when a caller needs one.

Each of the six revision-query request models gains:

```python
grouping: Optional[RevisionGrouping] = Field(
    default=None,
    description=(
        "Divide matching revisions by artifact or variant and select one revision "
        "from each group."
    ),
)
```

## Query order

The server evaluates a grouped query in this order:

1. Apply project scope, parent references, revision attribute filters, and archive policy.
2. Exclude empty seed revisions. A configured revision whose version is `"0"` remains
   eligible.
3. Divide the eligible rows by `artifact_id` or `variant_id`.
4. For `get: "latest"`, select the row with the greatest UUID7 revision id in each group.
5. Return the selected rows as a flat list ordered by revision id, newest first.

The UUID7 id records commit order. The `version` column cannot define latest because it is a
string and restarts for every variant. Ordering it descending puts `"9"` before `"10"`, and
two variants can both have the same version.

An empty seed revision is version `"0"` with no `data`, `flags`, `tags`, or `meta`. A first
real commit can also be version `"0"`, but it carries at least one of those fields and remains
eligible.

Filters apply before selection. Therefore a grouped query means "the latest eligible revision
that matches the request", not "the absolute latest revision, if it matches". This follows the
normal query rule that filters determine the candidate rows before result shaping occurs.

## Supported combinations

1. Omitting `grouping` preserves existing behavior.
2. `grouping.by: "artifact"` requires non-empty artifact references.
3. `grouping.by: "variant"` requires non-empty artifact or variant references.
4. A parent with no eligible matching revision contributes no row.
5. `grouping` cannot be combined with `windowing` in the first release.
6. `grouping` cannot be combined with explicit revision references. Exact revision references
   already select rows, so applying another selection rule would silently discard requested
   revisions.
7. A grouped request rejects any domain filter that is evaluated after the SQL query. This
   includes server-owned revision flags and the environment `references` history filter.
8. Malformed or unsupported grouping returns a client error. A parser must never swallow the
   error and broaden the query.

## Why grouped windowing is rejected

The current cursor identifies a revision in one flat stream. It cannot page groups correctly.

Take workflow A with revisions 100 and 80, and workflow B with revision 90. A first page could
select A/100 and use 100 as its cursor. The next page applies `id < 100` before grouping and
returns B/90 and A/80. Workflow A now appears twice.

Paging groups needs a cursor based on the group and a response contract shared by all six
endpoints. No current caller needs it, so this release rejects every `windowing` field when
`grouping` is present.

## Shared scope

`RevisionGrouping` lives beside `RevisionQuery` in the git core DTOs. The shared git DAO serves
these endpoints:

- `/workflows/revisions/query`
- `/testsets/revisions/query`
- `/evaluators/revisions/query`
- `/environments/revisions/query`
- `/applications/revisions/query`
- `/queries/revisions/query`

In that layer, `artifact` is the common name for a workflow, testset, evaluator, environment,
application, or saved query. `variant` is a branch of that artifact.

## Shapes rejected

### `workflow_revision.latest_per_artifact`

```jsonc
{
  "workflow_revision": {"latest_per_artifact": true}
}
```

The behavior is clear, but the location is wrong. `workflow_revision` filters attributes of an
individual row. Latest-per-parent shapes the whole result. The boolean also hard-codes artifact
grouping and cannot express the variant case.

### `grouping.by` without `grouping.get`

```jsonc
{"grouping": {"by": "artifact"}}
```

This states how rows are divided but leaves the selection behavior implicit. Grouping does not
inherently mean latest. Requiring `get: "latest"` states the complete operation.

### Extending `Windowing`

```jsonc
{"windowing": {"limit": 1, "group_by": "artifact"}}
```

Eighty-seven request models embed `Windowing`, while only the six revision endpoints have the
artifact and variant columns. Adding the field there would expose it on unrelated APIs. It also
mixes a revision cursor with a per-parent selection operation.

### A limit on each reference

```jsonc
{"workflow_refs": [{"id": "...", "limit": 1}]}
```

`Reference` identifies an entity through `id`, `slug`, or `version`. A result limit is not part
of identity. The testset client previously sent this field, and Pydantic silently discarded it.

### An `is_latest` revision flag

```jsonc
{"workflow_revision": {"flags": {"is_latest": true}}}
```

A revision flag describes that revision. "Latest among siblings" changes whenever a sibling is
created. Flags are also matched in Python in several services, after the expensive rows have
already left PostgreSQL.

## Deferred behavior

The first release supports exactly one selection rule, `latest`, and one selected row per group.
It does not support newest N per group or paging groups. Those features need a real caller and a
group-aware cursor contract before we add them.
