# Request-body fields — git-backed entities

Inventory of **every non-meta field** on every request body, for all
git-backed entities (`workflows`, `applications`, `evaluators`, `queries`,
`testsets`, `environments`), all levels (artifact / variant / revision),
and both routers (`/<entities>/*` and `/simple/<entities>/*`).

Extracted programmatically from
`api/oss/src/apis/fastapi/<entity>/models.py` on branch
`refactor/unify-revision-request-fields` (PR #4470 stacked on PR #4469).
Meta fields (`project_id`, `user_id`, `windowing`, `include_archived`,
`include_*`) are filtered out.

---

## Generic shape

`<entity>` ∈ `{workflow, application, evaluator, query, testset, environment}`.
`<Entity>` is the PascalCase form.

### Simple/ router

| Endpoint | Fields |
|---|---|
| `POST /simple/<entities>/` | `<entity>: Simple<Entity>Create` |
| `PUT /simple/<entities>/{id}` | `<entity>: Simple<Entity>Edit` |
| `POST /simple/<entities>/query` | `<entity>: Simple<Entity>Query` + `<entity>_refs: List[Reference]` |

### Artifact level

| Endpoint | Fields |
|---|---|
| `POST /<entities>/` | `<entity>: <Entity>Create` |
| `PUT /<entities>/{id}` | `<entity>: <Entity>Edit` |
| `POST /<entities>/query` | `<entity>: <Entity>Query` + `<entity>_refs: List[Reference]` |
| `POST /<entities>/{id}/fork` *(not implemented — only `/variants/fork` is wired)* | `<entity>: <Entity>Fork` |

### Variant level

| Endpoint | Fields |
|---|---|
| `POST /<entities>/variants/` | `<entity>_variant: <Entity>VariantCreate` |
| `PUT /<entities>/variants/{id}` | `<entity>_variant: <Entity>VariantEdit` |
| `POST /<entities>/variants/query` | `<entity>_variant: <Entity>VariantQuery` + `<entity>_refs: List[Reference]` + `<entity>_variant_refs: List[Reference]` |
| `POST /<entities>/variants/fork` *(all six entities)* | `<entity>_variant: <Entity>VariantFork` + `<entity>_variant_ref: Reference` + `<entity>_revision_ref: Optional[Reference]` |

### Revision level

| Endpoint | Fields |
|---|---|
| `POST /<entities>/revisions/` | `<entity>_revision: <Entity>RevisionCreate` |
| `PUT /<entities>/revisions/{id}` | `<entity>_revision: <Entity>RevisionEdit` |
| `POST /<entities>/revisions/query` | `<entity>_revision: <Entity>RevisionQuery` + `<entity>_refs: List[Reference]` + `<entity>_variant_refs: List[Reference]` + `<entity>_revision_refs: List[Reference]` |
| `POST /<entities>/revisions/commit` | `<entity>_revision: <Entity>RevisionCommit` |
| `POST /<entities>/revisions/log` | `<entity>_revisions: <Entity>RevisionsLog` |
| `POST /<entities>/revisions/retrieve` | `<entity>_ref: Reference` + `<entity>_variant_ref: Reference` + `<entity>_revision_ref: Reference` + `environment_ref: Reference` + `environment_variant_ref: Reference` + `environment_revision_ref: Reference` + `key: str` + `resolve: bool` *(queries/testsets drop `environment_*`, `key`, and `resolve`; environments drop `key` only)* |
| `POST /<entities>/revisions/resolve` *(workflows, applications, evaluators, environments)* | `<entity>_ref: Reference` + `<entity>_variant_ref: Reference` + `<entity>_revision_ref: Reference` + `<entity>_revision: <Entity>Revision` + `max_depth: int` + `max_embeds: int` + `error_policy: ErrorPolicy` |
| `POST /<entities>/revisions/deploy` *(workflows, applications, evaluators)* | `<entity>_ref: Reference` + `<entity>_variant_ref: Reference` + `<entity>_revision_ref: Reference` + `environment_ref: Reference` + `environment_variant_ref: Reference` + `environment_revision_ref: Reference` + `key: str` + `message: str` |

---

## Naming rules

- **Create / Edit / Fork / Query (artifact, variant, revision)**: wrapper is
  the singular noun (`workflow`, `workflow_variant`, `workflow_revision`).
  The verb suffix is dropped on the field but kept in the type name.
- **Commit**: `<entity>_revision: <Entity>RevisionCommit`
- **Log**: `<entity>_revisions: <Entity>RevisionsLog` (plural `revisions`)
- **Retrieve / Resolve / Deploy**: no typed wrapper — flat `<entity>_ref` /
  `<entity>_variant_ref` / `<entity>_revision_ref` + extras.
- **Query bodies**: always carry `<entity>_refs: List[Reference]`; deeper
  levels also carry `<entity>_variant_refs` and `<entity>_revision_refs`.
- **Variant Fork**: `<entity>_variant: <Entity>VariantFork` (new variant
  config: slug, name, description, flags — same noun-only convention as
  Create/Edit/Query), `<entity>_variant_ref: Reference` (source variant to
  copy from), `<entity>_revision_ref: Optional[Reference]` (pin to a
  specific revision; defaults to source head).

---

## Inline-resolve mode

`/revisions/resolve` supports two modes for all four entities that have it
(`workflows`, `applications`, `evaluators`, `environments`):

| Mode | How to trigger | What happens |
| --- | --- | --- |
| **Reference mode** | Pass `<entity>_ref` / `<entity>_variant_ref` / `<entity>_revision_ref` | Server retrieves the revision from DB, then resolves its `@ag.references` embeds. |
| **Inline mode** | Pass `<entity>_revision: <Entity>Revision` (a full revision object) | Server resolves the embed tokens in the supplied revision without touching the DB. The caller must already hold the revision data. |

**Who uses inline mode?** The SDK resolver
(`sdks/python/agenta/sdk/middlewares/running/resolver.py`) calls inline
mode on `/workflows/revisions/resolve` when it has already fetched the
revision and needs to expand `@ag.references` tokens without a second
round-trip. The same field is available on the other three entities
(`applications`, `evaluators`, `environments`) but is not yet called from
the SDK.

**Why not queries/testsets?** Those entities do not support `@ag.references`
embed tokens, so they have no Resolve endpoint at all.

---

## Cross-entity filter on EnvironmentRevisionQuery

`EnvironmentRevisionQueryRequest` carries `references: List[Reference]`
in addition to the standard `environment_refs` / `environment_variant_refs` /
`environment_revision_refs`. This lets callers scope environment revisions by
the entities they reference — useful when querying which environment
revisions point at a given application variant.

**Why only environments?** Environment revisions carry a `data.references`
map that links environments to application (and workflow/evaluator) variants.
Filtering environment revisions by the application they point at is a natural
join; the inverse (filtering application revisions by which environment
deploys them) is not currently implemented but could follow the same pattern.

---

## Per-entity full class listings

### workflows

```
SimpleWorkflowCreateRequest:
    workflow: SimpleWorkflowCreate
SimpleWorkflowEditRequest:
    workflow: SimpleWorkflowEdit
SimpleWorkflowQueryRequest:
    workflow: SimpleWorkflowQuery
    workflow_refs: List[Reference]

WorkflowCreateRequest:
    workflow: WorkflowCreate
WorkflowEditRequest:
    workflow: WorkflowEdit
WorkflowForkRequest:
    workflow: WorkflowFork
WorkflowQueryRequest:
    workflow: WorkflowQuery
    workflow_refs: List[Reference]

WorkflowVariantCreateRequest:
    workflow_variant: WorkflowVariantCreate
WorkflowVariantEditRequest:
    workflow_variant: WorkflowVariantEdit
WorkflowVariantQueryRequest:
    workflow_variant: WorkflowVariantQuery
    workflow_refs: List[Reference]
    workflow_variant_refs: List[Reference]
WorkflowVariantForkRequest:
    workflow_variant: WorkflowVariantFork
    workflow_variant_ref: Reference
    workflow_revision_ref: Optional[Reference]

WorkflowRevisionCreateRequest:
    workflow_revision: WorkflowRevisionCreate
WorkflowRevisionEditRequest:
    workflow_revision: WorkflowRevisionEdit
WorkflowRevisionQueryRequest:
    workflow_revision: WorkflowRevisionQuery
    workflow_refs: List[Reference]
    workflow_variant_refs: List[Reference]
    workflow_revision_refs: List[Reference]
WorkflowRevisionCommitRequest:
    workflow_revision: WorkflowRevisionCommit
WorkflowRevisionsLogRequest:
    workflow_revisions: WorkflowRevisionsLog
WorkflowRevisionRetrieveRequest:
    workflow_ref: Reference
    workflow_variant_ref: Reference
    workflow_revision_ref: Reference
    environment_ref: Reference
    environment_variant_ref: Reference
    environment_revision_ref: Reference
    key: str
    resolve: bool
WorkflowRevisionResolveRequest:
    workflow_ref: Reference
    workflow_variant_ref: Reference
    workflow_revision_ref: Reference
    workflow_revision: WorkflowRevision    # inline-resolve mode
    max_depth: int
    max_embeds: int
    error_policy: ErrorPolicy
WorkflowRevisionDeployRequest:
    workflow_ref: Reference
    workflow_variant_ref: Reference
    workflow_revision_ref: Reference
    environment_ref: Reference
    environment_variant_ref: Reference
    environment_revision_ref: Reference
    key: str
    message: str
```

### applications

```
SimpleApplicationCreateRequest:
    application: SimpleApplicationCreate
SimpleApplicationEditRequest:
    application: SimpleApplicationEdit
SimpleApplicationQueryRequest:
    application: SimpleApplicationQuery
    application_refs: List[Reference]

ApplicationCreateRequest:
    application: ApplicationCreate
ApplicationEditRequest:
    application: ApplicationEdit
ApplicationForkRequest:
    application: ApplicationFork
ApplicationQueryRequest:
    application: ApplicationQuery
    application_refs: List[Reference]

ApplicationVariantCreateRequest:
    application_variant: ApplicationVariantCreate
ApplicationVariantEditRequest:
    application_variant: ApplicationVariantEdit
ApplicationVariantQueryRequest:
    application_variant: ApplicationVariantQuery
    application_refs: List[Reference]
    application_variant_refs: List[Reference]
ApplicationVariantForkRequest:
    application_variant: ApplicationVariantFork
    application_variant_ref: Reference
    application_revision_ref: Optional[Reference]

ApplicationRevisionCreateRequest:
    application_revision: ApplicationRevisionCreate
ApplicationRevisionEditRequest:
    application_revision: ApplicationRevisionEdit
ApplicationRevisionQueryRequest:
    application_revision: ApplicationRevisionQuery
    application_refs: List[Reference]
    application_variant_refs: List[Reference]
    application_revision_refs: List[Reference]
ApplicationRevisionCommitRequest:
    application_revision: ApplicationRevisionCommit
ApplicationRevisionsLogRequest:
    application_revisions: ApplicationRevisionsLog
ApplicationRevisionRetrieveRequest:
    application_ref: Reference
    application_variant_ref: Reference
    application_revision_ref: Reference
    environment_ref: Reference
    environment_variant_ref: Reference
    environment_revision_ref: Reference
    key: str
    resolve: bool
ApplicationRevisionResolveRequest:
    application_ref: Reference
    application_variant_ref: Reference
    application_revision_ref: Reference
    application_revision: ApplicationRevision    # inline-resolve mode
    max_depth: int
    max_embeds: int
    error_policy: ErrorPolicy
ApplicationRevisionDeployRequest:
    application_ref: Reference
    application_variant_ref: Reference
    application_revision_ref: Reference
    environment_ref: Reference
    environment_variant_ref: Reference
    environment_revision_ref: Reference
    key: str
    message: str
```

### evaluators

```
SimpleEvaluatorCreateRequest:
    evaluator: SimpleEvaluatorCreate
SimpleEvaluatorEditRequest:
    evaluator: SimpleEvaluatorEdit
SimpleEvaluatorQueryRequest:
    evaluator: SimpleEvaluatorQuery
    evaluator_refs: List[Reference]

EvaluatorCreateRequest:
    evaluator: EvaluatorCreate
EvaluatorEditRequest:
    evaluator: EvaluatorEdit
EvaluatorForkRequest:
    evaluator: EvaluatorFork
EvaluatorQueryRequest:
    evaluator: EvaluatorQuery
    evaluator_refs: List[Reference]

EvaluatorVariantCreateRequest:
    evaluator_variant: EvaluatorVariantCreate
EvaluatorVariantEditRequest:
    evaluator_variant: EvaluatorVariantEdit
EvaluatorVariantQueryRequest:
    evaluator_variant: EvaluatorVariantQuery
    evaluator_refs: List[Reference]
    evaluator_variant_refs: List[Reference]
EvaluatorVariantForkRequest:
    evaluator_variant: EvaluatorVariantFork
    evaluator_variant_ref: Reference
    evaluator_revision_ref: Optional[Reference]

EvaluatorRevisionCreateRequest:
    evaluator_revision: EvaluatorRevisionCreate
EvaluatorRevisionEditRequest:
    evaluator_revision: EvaluatorRevisionEdit
EvaluatorRevisionQueryRequest:
    evaluator_revision: EvaluatorRevisionQuery
    evaluator_refs: List[Reference]
    evaluator_variant_refs: List[Reference]
    evaluator_revision_refs: List[Reference]
EvaluatorRevisionCommitRequest:
    evaluator_revision: EvaluatorRevisionCommit
EvaluatorRevisionsLogRequest:
    evaluator_revisions: EvaluatorRevisionsLog
EvaluatorRevisionRetrieveRequest:
    evaluator_ref: Reference
    evaluator_variant_ref: Reference
    evaluator_revision_ref: Reference
    environment_ref: Reference
    environment_variant_ref: Reference
    environment_revision_ref: Reference
    key: str
    resolve: bool
EvaluatorRevisionResolveRequest:
    evaluator_ref: Reference
    evaluator_variant_ref: Reference
    evaluator_revision_ref: Reference
    evaluator_revision: EvaluatorRevision    # inline-resolve mode
    max_depth: int
    max_embeds: int
    error_policy: ErrorPolicy
EvaluatorRevisionDeployRequest:
    evaluator_ref: Reference
    evaluator_variant_ref: Reference
    evaluator_revision_ref: Reference
    environment_ref: Reference
    environment_variant_ref: Reference
    environment_revision_ref: Reference
    key: str
    message: str
```

### queries

```
SimpleQueryCreateRequest:
    query: SimpleQueryCreate
SimpleQueryEditRequest:
    query: SimpleQueryEdit
SimpleQueryQueryRequest:
    query: SimpleQueryQuery
    query_refs: List[Reference]

QueryCreateRequest:
    query: QueryCreate
QueryEditRequest:
    query: QueryEdit
QueryForkRequest:
    query: QueryFork
QueryQueryRequest:
    query: QueryQuery
    query_refs: List[Reference]

QueryVariantCreateRequest:
    query_variant: QueryVariantCreate
QueryVariantEditRequest:
    query_variant: QueryVariantEdit
QueryVariantQueryRequest:
    query_variant: QueryVariantQuery
    query_refs: List[Reference]
    query_variant_refs: List[Reference]
QueryVariantForkRequest:
    query_variant: QueryVariantFork
    query_variant_ref: Reference
    query_revision_ref: Optional[Reference]

QueryRevisionCreateRequest:
    query_revision: QueryRevisionCreate
QueryRevisionEditRequest:
    query_revision: QueryRevisionEdit
QueryRevisionQueryRequest:
    query_revision: QueryRevisionQuery
    query_refs: List[Reference]
    query_variant_refs: List[Reference]
    query_revision_refs: List[Reference]
QueryRevisionCommitRequest:
    query_revision: QueryRevisionCommit
QueryRevisionsLogRequest:
    query_revisions: QueryRevisionsLog
QueryRevisionRetrieveRequest:
    query_ref: Reference
    query_variant_ref: Reference
    query_revision_ref: Reference
    # no environment_* triple, no key
```

### testsets

```
SimpleTestsetCreateRequest:
    testset: SimpleTestsetCreate
SimpleTestsetEditRequest:
    testset: SimpleTestsetEdit
SimpleTestsetQueryRequest:
    testset: SimpleTestsetQuery
    testset_refs: List[Reference]

TestsetCreateRequest:
    testset: TestsetCreate
TestsetEditRequest:
    testset: TestsetEdit
TestsetForkRequest:
    testset: TestsetFork
TestsetQueryRequest:
    testset: TestsetQuery
    testset_refs: List[Reference]

TestsetVariantCreateRequest:
    testset_variant: TestsetVariantCreate
TestsetVariantEditRequest:
    testset_variant: TestsetVariantEdit
TestsetVariantQueryRequest:
    testset_variant: TestsetVariantQuery
    testset_refs: List[Reference]
    testset_variant_refs: List[Reference]
TestsetVariantForkRequest:
    testset_variant: TestsetVariantFork
    testset_variant_ref: Reference
    testset_revision_ref: Optional[Reference]

TestsetRevisionCreateRequest:
    testset_revision: TestsetRevisionCreate
TestsetRevisionEditRequest:
    testset_revision: TestsetRevisionEdit
TestsetRevisionQueryRequest:
    testset_revision: TestsetRevisionQuery
    testset_refs: List[Reference]
    testset_variant_refs: List[Reference]
    testset_revision_refs: List[Reference]
TestsetRevisionCommitRequest:
    testset_revision: TestsetRevisionCommit
TestsetRevisionsLogRequest:
    testset_revisions: TestsetRevisionsLog
TestsetRevisionRetrieveRequest:
    testset_ref: Reference
    testset_variant_ref: Reference
    testset_revision_ref: Reference
    # no environment_* triple, no key
```

### environments

```
SimpleEnvironmentCreateRequest:
    environment: SimpleEnvironmentCreate
SimpleEnvironmentEditRequest:
    environment: SimpleEnvironmentEdit
SimpleEnvironmentQueryRequest:
    environment: SimpleEnvironmentQuery
    environment_refs: List[Reference]

EnvironmentCreateRequest:
    environment: EnvironmentCreate
EnvironmentEditRequest:
    environment: EnvironmentEdit
EnvironmentForkRequest:
    environment: EnvironmentFork
EnvironmentQueryRequest:
    environment: EnvironmentQuery
    environment_refs: List[Reference]

EnvironmentVariantCreateRequest:
    environment_variant: EnvironmentVariantCreate
EnvironmentVariantEditRequest:
    environment_variant: EnvironmentVariantEdit
EnvironmentVariantQueryRequest:
    environment_variant: EnvironmentVariantQuery
    environment_refs: List[Reference]
    environment_variant_refs: List[Reference]
EnvironmentVariantForkRequest:
    environment_variant: EnvironmentVariantFork
    environment_variant_ref: Reference
    environment_revision_ref: Optional[Reference]

EnvironmentRevisionCreateRequest:
    environment_revision: EnvironmentRevisionCreate
EnvironmentRevisionEditRequest:
    environment_revision: EnvironmentRevisionEdit
EnvironmentRevisionQueryRequest:
    environment_revision: EnvironmentRevisionQuery
    environment_refs: List[Reference]
    environment_variant_refs: List[Reference]
    environment_revision_refs: List[Reference]
    references: List[Reference]            # cross-entity filter: scope env revisions by any referenced entity
EnvironmentRevisionCommitRequest:
    environment_revision: EnvironmentRevisionCommit
EnvironmentRevisionsLogRequest:
    environment_revisions: EnvironmentRevisionsLog
EnvironmentRevisionRetrieveRequest:
    environment_ref: Reference
    environment_variant_ref: Reference
    environment_revision_ref: Reference
    resolve: bool
    # no key (environments are the pointer, not the target of a key lookup)
EnvironmentRevisionResolveRequest:
    environment_ref: Reference
    environment_variant_ref: Reference
    environment_revision_ref: Reference
    environment_revision: EnvironmentRevision    # inline-resolve mode
    max_depth: int
    max_embeds: int
    error_policy: ErrorPolicy
```
