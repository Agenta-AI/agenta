# What the code does now

All findings below come from the running `agenta-oss-team` stack on images `v0.114.5`,
and from the repository at the time of writing.

## The six endpoints share one shape

Six routers expose `POST /<entity>/revisions/query`:

| Router | Request model |
| --- | --- |
| `apis/fastapi/workflows/router.py:418` | `WorkflowRevisionQueryRequest` |
| `apis/fastapi/testsets/router.py:491` | `TestsetRevisionQueryRequest` |
| `apis/fastapi/evaluators/router.py:402` | `EvaluatorRevisionQueryRequest` |
| `apis/fastapi/environments/router.py:296` | `EnvironmentRevisionQueryRequest` |
| `apis/fastapi/applications/router.py:376` | `ApplicationRevisionQueryRequest` |
| `apis/fastapi/queries/router.py:290` | `QueryRevisionQueryRequest` |

The six request models are the same shape with different entity names:

```python
class <Entity>RevisionQueryRequest(BaseModel):
    <entity>_revision: Optional[<Entity>RevisionQuery]   # attribute filter
    <entity>_refs: Optional[List[Reference]]             # scope
    <entity>_variant_refs: Optional[List[Reference]]     # scope
    <entity>_revision_refs: Optional[List[Reference]]    # scope
    include_archived: Optional[bool]                     # policy
    windowing: Optional[Windowing]                       # result shaping
```

All six reach the same method, `GitDAO.query_revisions` at
`dbs/postgres/git/dao.py:1334`. Any change made in one place must be made in all six, or
the family drifts apart.

## `Windowing` shapes one flat stream

`Windowing` lives in `core/shared/dtos.py`. Its fields are grouped by comment:

```python
class Windowing(BaseModel):
    newest, oldest      # RANGE
    next                # TOKEN
    limit               # LIMIT
    order               # ORDER
    interval            # BUCKETS
    rate                # SAMPLES
```

`apply_windowing` in `dbs/postgres/shared/utils.py` applies it over one ordered result,
keyed on a time column or an id column. The `next` token is a cursor over that flat
stream.

87 request models across the API embed `Windowing`. Only the six above have a parent
column to group by.

## The frontend already reaches for this, twice

`web/packages/agenta-entities/src/workflow/api/api.ts:1291` drops the limit on purpose,
and says why in a comment.

`web/packages/agenta-entities/src/testset/api/api.ts:193` tries a different shape:

```js
testset_refs: testsetIds.map((id) => ({id, limit: 1})),
```

That `limit` does nothing. `Reference` is `class Reference(Identifier, Slug, Version)`
with no `model_config`, so pydantic ignores extra keys. We checked it on the running API:

```
Reference(**{"id": "...", "limit": 1})
  -> version=None slug=None id=UUID('...')
  -> dumped: {'id': UUID('...')}
```

The call therefore fetches every revision of every testset in the batch. It fails
silently. On the project we measured, testsets hold only 2 revisions, so nothing hurts
today. The defect is latent, not harmless.

## Where the cost sits

`WorkflowsService.query_workflow_revisions` at `core/workflows/service.py:2076` builds a
model per row:

```python
workflow_revision = await self._normalize_revision_for_read(
    project_id=project_id,
    revision=WorkflowRevision(**revision.model_dump(mode="json")),
    ...
)
if not self._matches_requested_flags(...):
    continue
```

Two facts follow from that order. First, every returned row is fully built before
anything is discarded. Second, `WorkflowRevisionData._validate` runs on construction, and
it calls `jsonschema.check_schema` on every schema. A filter applied at this point would
still save the later serialization and compression, but not the database transfer or the
model construction.

Measured on the project's real data, inside the API container:

| Stage | 177 revisions (two workflows) |
| --- | --- |
| Build models, including `check_schema` | 385 ms |
| `model_dump` | 146 ms |
| Serialize to JSON | 92 ms, giving 76.4 MB |
| gzip at level 5 | 1293 ms, giving 18.9 MB |
| **Total, none of it yielding** | **1916 ms** |

A single revision costs 2.2 ms to build. The project holds 19 workflows and 269
revisions, and two of those workflows hold 179 revisions and 30 MB between them.

## Why a query flag would not work

Adding `is_latest` to `<Entity>RevisionQueryFlags` looks natural, because the flags model
is rich. It fails for two reasons.

The flags are matched in Python at `service.py:2085`, after each model is built. A flag
filter would pay the full 2.2 ms per row and then throw the rows away. It removes no
cost, and the cost is the reason for the change.

The meaning is also wrong. The flags describe what a revision is. The code groups them as
`uri-derived`, `interface-derived`, and `slug-derived`, and others are user-declared or
merged from the artifact during a read. Not all of them are computed from the revision
alone, but none of them depend on where the revision sits in its own history. "Newest among
its siblings" does, and it changes when someone commits a new revision.

## The pattern to copy

`RecordsDAO.latest_message_per_session` at `dbs/postgres/sessions/records/dao.py:167`
solves the same shape. It uses `DISTINCT ON` to get the newest row per group in one
query, and it truncates the large column inside Postgres so the big value never leaves
the database. Its docstring gives the same reason we give here.
