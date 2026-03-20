# Route Gap Analysis

This file compares the legacy adapter-backed routes mounted in [api/entrypoints/routers.py](../../../api/entrypoints/routers.py#L827) against the new entity routers mounted under `/preview/*`.

## Mounted Legacy Routers

- `/apps` -> [api/oss/src/routers/app_router.py](../../../api/oss/src/routers/app_router.py)
- `/variants` -> [api/oss/src/routers/variants_router.py](../../../api/oss/src/routers/variants_router.py)
- `/environments` -> [api/oss/src/routers/environment_router.py](../../../api/oss/src/routers/environment_router.py)
- `/configs` -> [api/oss/src/routers/configs_router.py](../../../api/oss/src/routers/configs_router.py)

## Mounted New Routers

- `/preview/applications` -> [api/oss/src/apis/fastapi/applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L89)
- `/preview/workflows` -> [api/oss/src/apis/fastapi/workflows/router.py](../../../api/oss/src/apis/fastapi/workflows/router.py#L90)
- `/preview/evaluators` -> [api/oss/src/apis/fastapi/evaluators/router.py](../../../api/oss/src/apis/fastapi/evaluators/router.py#L104)
- `/preview/environments` -> [api/oss/src/apis/fastapi/environments/router.py](../../../api/oss/src/apis/fastapi/environments/router.py#L90)
- `/preview/simple/environments` -> [api/oss/src/apis/fastapi/environments/router.py](../../../api/oss/src/apis/fastapi/environments/router.py#L1164)

## Covered Legacy Behavior

### `/apps`

Covered by `/preview/applications`:

- `POST /apps/` -> create application
  - legacy: [app_router.py](../../../api/oss/src/routers/app_router.py#L197)
  - new: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L89)
- `GET /apps/{app_id}` -> fetch application
  - legacy: [app_router.py](../../../api/oss/src/routers/app_router.py#L293)
  - new: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L99)
- `PATCH /apps/{app_id}` -> edit application
  - legacy: [app_router.py](../../../api/oss/src/routers/app_router.py#L338)
  - new uses `PUT`: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L109)
- `GET /apps/` -> query applications
  - legacy: [app_router.py](../../../api/oss/src/routers/app_router.py#L414)
  - new: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L139)
- `GET /apps/{app_id}/variants` -> query application variants
  - legacy: [app_router.py](../../../api/oss/src/routers/app_router.py#L80)
  - new: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L201)
- delete/archive of apps is covered by archive/unarchive
  - legacy delete: [app_router.py](../../../api/oss/src/routers/app_router.py#L589)
  - new archive: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L119)

### `/variants`

Covered by `/preview/applications` generic variant/revision flows:

- fork/create from base
  - legacy: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L63)
  - new: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L211)
- archive variant
  - legacy: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L129)
  - new: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L181)
- fetch variant
  - legacy: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L338)
  - new: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L161)
- revision fetch/query/log/archive
  - legacy list revisions: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L376)
  - legacy fetch by number: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L430)
  - legacy batch query: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L474)
  - new retrieve/query/log/archive: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L223), [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L283), [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L303), [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L263)

### Legacy config mutation shorthands

These are covered by generic revision commit/edit because the new revision DTOs already carry `data.url`, `data.parameters`, and temporary legacy fields:

- workflow/application revision data supports legacy and flat fields:
  - [core/workflows/dtos.py](../../../api/oss/src/core/workflows/dtos.py#L177)
  - [core/applications/dtos.py](../../../api/oss/src/core/applications/dtos.py#L152)

Examples:

- `PUT /variants/{variant_id}/parameters`
  - legacy: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L181)
  - covered by commit/edit revision: [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L293), [applications/router.py](../../../api/oss/src/apis/fastapi/applications/router.py#L253)
- `PUT /variants/{variant_id}/service`
  - legacy: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L260)
  - covered by commit/edit revision with `data.url` or `data.service`

## True Gaps

### 1. One-call deploy RPCs

There is no new direct replacement for:

- `POST /environments/deploy`
  - legacy: [environment_router.py](../../../api/oss/src/routers/environment_router.py#L22)
- `POST /variants/configs/deploy`
  - legacy: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L904)

The new environment router has revision commit/query/log primitives:

- [environments/router.py](../../../api/oss/src/apis/fastapi/environments/router.py#L214)
- [environments/router.py](../../../api/oss/src/apis/fastapi/environments/router.py#L274)
- [environments/router.py](../../../api/oss/src/apis/fastapi/environments/router.py#L294)

But there is no dedicated deploy RPC that accepts an application/workflow revision and environment ref and performs the reference commit on behalf of the caller.

### 2. One-call retrieve-current-deployment RPCs

There is no new direct replacement for:

- `GET /apps/get_variant_by_env`
  - legacy: [app_router.py](../../../api/oss/src/routers/app_router.py#L143)
- `GET /configs/deployment/{deployment_revision_id}`
  - legacy: [configs_router.py](../../../api/oss/src/routers/configs_router.py#L144)
- `POST /variants/configs/fetch` when used with `environment_ref`
  - legacy: [variants_router.py](../../../api/oss/src/routers/variants_router.py#L697)

The new APIs can reconstruct this by:

1. querying or fetching the latest environment revision
2. reading the deployment references from `environment_revision.data.references`
3. fetching the referenced application/workflow revision

That works, but the old one-call UX is gone.

### 3. One-call revert-deployment RPC

There is no direct replacement for:

- `POST /configs/deployment/{deployment_revision_id}/revert`
  - legacy: [configs_router.py](../../../api/oss/src/routers/configs_router.py#L228)

This endpoint now manually bridges into the new environment tables when possible, which is a strong sign that the new stack still lacks a first-class revert RPC.

### 4. App-scoped environment convenience views

There is no exact new replacement for:

- `GET /apps/{app_id}/environments`
  - legacy: [app_router.py](../../../api/oss/src/routers/app_router.py#L641)
- `GET /apps/{app_id}/revisions/{environment_name}`
  - legacy: [app_router.py](../../../api/oss/src/routers/app_router.py#L712)

The new environment APIs are environment-centric, not app-centric. They support generic query/log/retrieve, but they do not expose an app-scoped "show me deployment state across environments" wrapper.

This is convenience, not storage capability.

## Deprecated Rather Than Missing

These old endpoints should not drive new API work:

- `POST /apps/{app_id}/variant/from-template`
  - legacy: [app_router.py](../../../api/oss/src/routers/app_router.py#L558)
- `GET /configs/?base_id=&config_name=...`
  - legacy: [configs_router.py](../../../api/oss/src/routers/configs_router.py#L44)

Reasons:

- `template_key`, `base_id`, and `config_name` are legacy adapter concepts
- the new entity model is revision-first, not base/config-name-first

## New APIs Worth Adding

### Environment RPCs

Recommended:

- `POST /preview/environments/deploy`
- `POST /preview/environments/retrieve`
- `POST /preview/environments/revert`

These should wrap the existing environment revision commit/query logic instead of reintroducing legacy router semantics.

### Optional workflow/application RPCs

Nice-to-have:

- `POST /preview/workflows/deploy`
- `POST /preview/workflows/retrieve`

or the same shape on `/preview/applications`.

These are optional. The real state owner is environments.

## SDK Migration Notes

The SDK should move off legacy adapter endpoints after the new RPCs exist.

Priority order:

1. deploy/retrieve/revert helpers
2. config fetch/list/history helpers
3. variant parameter/service shorthands

That migration belongs in SDK manager code, not Fern client generation.
