# Research

## API mount inventory

Source: `api/entrypoints/routers.py`.

Preview mounts currently present:

- `/tracing`
- `/invocations`
- `/annotations`
- `/testcases`
- `/testsets`
- `/simple/testsets`
- `/queries`
- `/simple/queries`
- `/applications`
- `/simple/applications`
- `/workflows`
- `/evaluators`
- `/simple/evaluators`
- `/environments`
- `/simple/environments`
- `/evaluations`
- `/simple/evaluations`

Notable existing non-preview mount:

- `/tracing` already exists next to `/tracing`, and preview tracing is already marked `include_in_schema=False`.

## Legacy route overlap check

Legacy routers (`api/oss/src/routers/*`) are still mounted for several old prefixes.

Key overlap risk:

- Legacy `/environments` is already mounted and serves `/deploy/` via `api/oss/src/routers/environment_router.py`.
- New environments routers are currently mounted under `/environments` and `/simple/environments`.
- Moving new environments router to `/environments` is possible but requires careful conflict and behavior validation.

## Consumer usage snapshot

File-level usage counts by mounted preview prefix (web + SDK search):

- `/tracing`: web 4, sdk 1
- `/invocations`: web 0, sdk 0
- `/annotations`: web 4, sdk 0
- `/testcases`: web 12, sdk 0
- `/testsets`: web 20, sdk 1
- `/simple/testsets`: web 5, sdk 1
- `/queries`: web 4, sdk 0
- `/simple/queries`: web 1, sdk 0
- `/applications`: web 0, sdk 1
- `/simple/applications`: web 0, sdk 1
- `/workflows`: web 1, sdk 1
- `/evaluators`: web 2, sdk 1
- `/simple/evaluators`: web 4, sdk 1
- `/environments`: web 0, sdk 0
- `/simple/environments`: web 0, sdk 0
- `/evaluations`: web 21, sdk 4
- `/simple/evaluations`: web 2, sdk 1

Interpretation:

- Evaluations/testsets/testcases/evaluators are the highest-usage preview surfaces.
- Environments has no current client usage in web/SDK, but has server-side overlap risk.

## OpenAPI strategy

For each migrated route family:

1. Add canonical non-preview mount.
2. Keep preview mount for compatibility.
3. Set preview mount `include_in_schema=False` so only canonical paths remain in OpenAPI.

This is the same pattern currently used for tracing.
