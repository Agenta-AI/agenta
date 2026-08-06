# Route Matrix

Legend:

- `done`: canonical mount added and preview hidden from OpenAPI.
- `open`: requires additional design/validation before adding canonical mount.
- `blocked`: client migration is pending (API dual-mount available).
- `not-started`: migration work not yet applied.
- `n/a`: no usage found in current web/SDK scans.

| Route family | Preview mount(s) | Canonical target(s) | Add canonical status | Frontend migration | SDK migration | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| tracing | `/tracing` | `/tracing` | done | not-started (uses preview in 4 files) | not-started (uses preview in 1 file) | Canonical already exists; preview already hidden from schema. |
| invocations | `/invocations` | `/invocations` | done | n/a | n/a | Canonical mount added; preview hidden from schema. |
| annotations | `/annotations` | `/annotations` | done | blocked (preview in 4 files) | n/a | Frontend migration needed. |
| testcases | `/testcases` | `/testcases` | done | blocked (preview in 12 files) | n/a | High frontend touch count. |
| testsets | `/testsets`, `/simple/testsets` | `/testsets`, `/simple/testsets` | done | blocked (preview in 20 + 5 files) | blocked (preview in 1 + 1 files) | High blast radius in web and entities package. |
| queries | `/queries`, `/simple/queries` | `/queries`, `/simple/queries` | done | blocked (preview in 4 + 1 files) | n/a | Include revisions/query endpoints under new prefix. |
| applications | `/applications`, `/simple/applications` | `/applications`, `/simple/applications` | done | n/a | blocked (preview in 1 + 1 files) | SDK managers use these paths. |
| workflows | `/workflows` | `/workflows` | done | blocked (preview in 1 file) | blocked (preview in 1 file) | Mostly invoke-related usage. |
| evaluators | `/evaluators`, `/simple/evaluators` | `/evaluators`, `/simple/evaluators` | done | blocked (preview in 2 + 4 files) | blocked (preview in 1 + 1 files) | Used by eval UI + SDK manager. |
| environments | `/environments`, `/simple/environments` | `/environments`, `/simple/environments` | open | n/a | n/a | Legacy `/environments` router already mounted; requires conflict and behavior validation. |
| evaluations | `/evaluations`, `/simple/evaluations` | `/evaluations`, `/simple/evaluations` | done | blocked (preview in 21 + 2 files) | blocked (preview in 4 + 1 files) | Highest active preview usage in web+SDK. |

## Safe-now set

- invocations
- annotations
- testcases
- testsets (+ simple)
- queries (+ simple)
- applications (+ simple)
- workflows
- evaluators (+ simple)
- evaluations (+ simple)

## Open set

- environments (+ simple)
  - Primary reason: coexistence with legacy `/environments` router mounted from `api/oss/src/routers/environment_router.py`.
  - Needs explicit verification of route matching behavior, generated OpenAPI clarity, and backward compatibility for `/environments/deploy/`.
