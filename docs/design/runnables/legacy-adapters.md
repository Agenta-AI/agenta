# Legacy Adapters — Drop Analysis

> **Question:** If we drop all legacy routers (`/apps`, `/variants`, `/configs`, `/environments`, `/containers`) and `legacy_adapter.py`, keeping only the new Git-based endpoints — what API functionality do we lose?
>
> **Answer:** Nothing material. All functionality is either already covered by new endpoints, intentionally deprecated, or addressable with thin deployment wrappers.

---

## Architecture Context

The API currently runs a **dual stack**:

- **Legacy routers** (`api/oss/src/routers/`): function-based, use `LegacyApplicationsAdapter` and `LegacyEnvironmentsAdapter` to translate between old response shapes and new Git-based services.
- **New routers** (`api/oss/src/apis/fastapi/`): class-based, operate directly on Git entities (artifacts, variants, revisions).

Both stacks share the same underlying services and database. The legacy adapter (~2,200 lines in `api/oss/src/services/legacy_adapter.py`) exists solely to maintain backward compatibility with old SDK/web callers.

### Files to Remove

| File | Purpose |
|------|---------|
| `api/oss/src/services/legacy_adapter.py` | Adapter translating new services → legacy response shapes |
| `api/oss/src/routers/app_router.py` | Legacy `/apps` endpoints |
| `api/oss/src/routers/variants_router.py` | Legacy `/variants` + `/variants/configs/*` endpoints |
| `api/oss/src/routers/configs_router.py` | Legacy `/configs` endpoints |
| `api/oss/src/routers/environment_router.py` | Legacy `/environments` endpoints |
| `api/oss/src/routers/container_router.py` | Legacy `/containers` endpoints |

---

## Endpoint-by-Endpoint Analysis

### Legacy App Router (`/apps`)

| Legacy Endpoint | New Equivalent | Status |
|---|---|---|
| `GET /apps/` | `POST /applications/query` | **Covered** — filter by project, new shape |
| `POST /apps/` | `POST /applications/` | **Covered** |
| `GET /apps/{app_id}/` | `GET /applications/{id}` | **Covered** |
| `PATCH /apps/{app_id}/` | `PATCH /applications/{id}` | **Covered** |
| `DELETE /apps/{app_id}/` | `POST /applications/{id}/archive` | **Covered** (archive instead of delete) |
| `GET /apps/{app_id}/variants/` | `POST /applications/variants/query` | **Covered** |
| `GET /apps/get_variant_by_env/` | — | **Needs wrapper** (see Deployments section) |
| `GET /apps/{app_id}/environments/` | `POST /environments/query` | **Covered** (not app-scoped, but environments are project-level now) |
| `GET /apps/{app_id}/revisions/{env_name}/` | `POST /environments/revisions/log` | **Covered** (query by environment, not by app) |
| `POST /apps/{app_id}/variant/from-service/` | Variant create + revision commit | **Deprecated** — replaced by workflow catalog |
| `POST /apps/{app_id}/variant/from-template/` | — | **Deprecated** — template_key concept removed |

### Legacy Variants Router (`/variants`)

| Legacy Endpoint | New Equivalent | Status |
|---|---|---|
| `POST /variants/from-base/` | `POST /applications/variants/fork` | **Covered** |
| `DELETE /variants/{variant_id}/` | `POST /applications/variants/{id}/archive` | **Covered** |
| `PUT /variants/{variant_id}/parameters/` | `POST /applications/revisions/commit` | **Covered** |
| `PUT /variants/{variant_id}/service/` | `POST /applications/revisions/commit` | **Covered** |
| `GET /variants/{variant_id}/` | Query via `/applications/variants/` | **Covered** |
| `GET /variants/{variant_id}/revisions/` | `POST /applications/revisions/log` | **Covered** |
| `GET /variants/{variant_id}/revisions/{num}/` | `POST /applications/revisions/retrieve` | **Covered** |
| `POST /variants/revisions/query` | `POST /applications/revisions/query` | **Covered** |
| `DELETE /variants/{variant_id}/revisions/{id}/` | `POST /applications/revisions/{id}/archive` | **Covered** |

### Legacy Configs Endpoints (`/variants/configs/*`)

| Legacy Endpoint | New Equivalent | Status |
|---|---|---|
| `POST /variants/configs/fetch` | `POST /applications/revisions/retrieve` (by variant ref) or environment query + resolve (by env ref) | **Covered** — two calls for env-based fetch (see Deployments section) |
| `POST /variants/configs/deploy` | — | **Needs wrapper** (see Deployments section) |
| `POST /variants/configs/query` | `POST /applications/revisions/query` | **Covered** |
| `POST /variants/configs/add` | Variant create + revision commit | **Covered** (two calls instead of one) |
| `POST /variants/configs/commit` | `POST /applications/revisions/commit` | **Covered** |
| `POST /variants/configs/list` | `POST /applications/variants/query` | **Covered** |
| `POST /variants/configs/history` | `POST /applications/revisions/log` | **Covered** |
| `POST /variants/configs/fork` | `POST /applications/variants/fork` | **Covered** |
| `POST /variants/configs/delete` | Archive variant | **Covered** |

### Legacy Configs Router (`/configs`)

| Legacy Endpoint | New Equivalent | Status |
|---|---|---|
| `GET /configs/?base_id=&config_name=` | — | **Deprecated** — `base_id` concept removed |
| `GET /configs/deployment/{id}/` | Environment revision resolve | **Deprecated** — use environment revision queries |
| `POST /configs/deployment/{id}/revert/` | — | **Needs wrapper** (see Deployments section) |

### Legacy Environment Router (`/environments`)

| Legacy Endpoint | New Equivalent | Status |
|---|---|---|
| `POST /environments/deploy/` | — | **Needs wrapper** (see Deployments section) |

### Legacy Container Router (`/containers`)

| Legacy Endpoint | New Equivalent | Status |
|---|---|---|
| `GET /containers/templates/` | — | **Deprecated** — replaced by workflow catalog |

---

## Intentionally Deprecated Concepts

These legacy concepts do not carry over to the new system:

| Concept | Why it's gone |
|---------|--------------|
| `base_id` (VariantBaseDB) | Replaced by variant_id directly. The base abstraction layer is unnecessary in the Git model. |
| `template_key` | Replaced by workflow catalog. Apps are no longer created from hardcoded template keys. |
| `app_type` ("chat", "completion", "custom (sdk)") | Replaced by workflow flags. The type is derived from the workflow definition, not a top-level field. |
| `add_variant_from_url` / `add_variant_from_service` | Replaced by standard variant create + revision commit. URL/service registration is part of the revision data. |
| `container_templates` endpoint | Static template list replaced by workflow catalog. |
| `ConfigDTO` response shape | Replaced by standard revision DTOs. The high-level config abstraction (params + url + lifecycle in one object) is replaced by revision data. |
| Username resolution in responses | New endpoints return user UUIDs. Username resolution is a presentation concern handled by the frontend. |
| Server-side response caching | Legacy routers used `get_cache`/`set_cache`. New system relies on client-side caching (TanStack Query). Can be re-added at the service layer if needed. |

---

## What Needs to Be Added: Deployment RPCs

The only functional gap is around **deployment convenience**. The new system can do everything the old one could, but some deployment operations require the caller to orchestrate multiple calls. Adding thin RPC-style wrappers on both environments and workflows closes this gap.

### RPCs on Environments

Environments own deployment state. These RPCs operate on a specific key (workflow slug) within an environment:

#### Deploy

Set a workflow revision at a key in the environment.

```
POST /environments/{id}/deploy

Body: { key: "my-workflow.revision", revision_id }
```

Internally: build delta reference → commit to environment revision.

#### Retrieve

Get the deployed revision for a specific key in the environment.

```
POST /environments/{id}/retrieve

Body: { key: "my-workflow.revision" }
```

Internally: fetch latest environment revision → extract reference at key → return resolved revision.

#### Revert

Re-deploy a previous environment revision (replay its references as a new commit). May or may not be needed — could be a frontend-only operation.

```
POST /environments/{id}/revert

Body: { revision_id }  // historical environment revision to restore
```

Internally: read historical revision references → commit as new revision with same references.

### RPCs on Workflows

Workflows provide the same deploy/retrieve but from the workflow's perspective, accepting an environment ref:

#### Deploy

Deploy a workflow revision to an environment.

```
POST /workflows/{id}/deploy

Body: { environment_ref, revision_id }
```

Internally: resolve environment ref → build delta reference using workflow slug → commit to environment.

#### Retrieve

Get the deployed revision of this workflow in a given environment.

```
POST /workflows/{id}/retrieve

Body: { environment_ref }
```

Internally: resolve environment ref → extract reference for this workflow → return resolved revision.

> **Note:** Revert does not apply at the workflow level — it's an environment-level concept (restoring an entire environment snapshot, not a single workflow's deployment).

---

## Migration Plan (SDK + Web)

Dropping the legacy adapters requires migrating two controlled consumers:

1. **SDK** — update all config fetch/deploy/commit calls to use new endpoint shapes. We control the SDK, so this is a coordinated release.
2. **Web frontend** — update API calls from legacy shapes (`AppVariantResponse`, `ConfigDTO`, etc.) to new DTOs (`ApplicationResponse`, `ApplicationRevisionResponse`, etc.).

Both are internal consumers. No external API contract to maintain.

---

## Conclusion

The legacy adapters can be dropped with **zero functionality loss** once:

1. Deployment RPCs are added to both environments (deploy, retrieve, maybe revert) and workflows (deploy, retrieve).
2. SDK is updated to use new endpoint shapes.
3. Web frontend is updated to use new endpoint shapes.

The ~2,200-line `legacy_adapter.py` and 6 legacy router files can then be removed entirely.
