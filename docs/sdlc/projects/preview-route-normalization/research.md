# Research

## API mount inventory

Source: `api/entrypoints/routers.py`.

Preview mounts currently present:

- `/preview/tracing`
- `/preview/invocations`
- `/preview/annotations`
- `/preview/testcases`
- `/preview/testsets`
- `/preview/simple/testsets`
- `/preview/queries`
- `/preview/simple/queries`
- `/preview/applications`
- `/preview/simple/applications`
- `/preview/workflows`
- `/preview/evaluators`
- `/preview/simple/evaluators`
- `/preview/environments`
- `/preview/simple/environments`
- `/preview/evaluations`
- `/preview/simple/evaluations`

Notable existing non-preview mount:

- `/tracing` already exists next to `/preview/tracing`, and preview tracing is already marked `include_in_schema=False`.

## Legacy route overlap check

Legacy routers (`api/oss/src/routers/*`) are still mounted for several old prefixes.

Key overlap risk:

- Legacy `/environments` is already mounted and serves `/deploy/` via `api/oss/src/routers/environment_router.py`.
- New environments routers are currently mounted under `/preview/environments` and `/preview/simple/environments`.
- Moving new environments router to `/environments` is possible but requires careful conflict and behavior validation.

## Consumer usage snapshot

File-level usage counts by mounted preview prefix (web + SDK search):

- `/preview/tracing`: web 4, sdk 1
- `/preview/invocations`: web 0, sdk 0
- `/preview/annotations`: web 4, sdk 0
- `/preview/testcases`: web 12, sdk 0
- `/preview/testsets`: web 20, sdk 1
- `/preview/simple/testsets`: web 5, sdk 1
- `/preview/queries`: web 4, sdk 0
- `/preview/simple/queries`: web 1, sdk 0
- `/preview/applications`: web 0, sdk 1
- `/preview/simple/applications`: web 0, sdk 1
- `/preview/workflows`: web 1, sdk 1
- `/preview/evaluators`: web 2, sdk 1
- `/preview/simple/evaluators`: web 4, sdk 1
- `/preview/environments`: web 0, sdk 0
- `/preview/simple/environments`: web 0, sdk 0
- `/preview/evaluations`: web 21, sdk 4
- `/preview/simple/evaluations`: web 2, sdk 1

Interpretation:

- Evaluations/testsets/testcases/evaluators are the highest-usage preview surfaces.
- Environments has no current client usage in web/SDK, but has server-side overlap risk.

## OpenAPI strategy

For each migrated route family:

1. Add canonical non-preview mount.
2. Keep preview mount for compatibility.
3. Set preview mount `include_in_schema=False` so only canonical paths remain in OpenAPI.

This is the same pattern currently used for tracing.
