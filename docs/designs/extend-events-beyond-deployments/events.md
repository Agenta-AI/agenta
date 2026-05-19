# Extend Events Beyond Deployments - Event Catalog

## Rules

- Add every event below to both `EventType` and `WebhookEventType`.
- **Read actions** (`retrieve` / `fetch` / `query` / `log`, plus trace and testcase reads) emit from the **router** boundary, after the response is materialized. The same handler emits whether mounted at the stable path or at a `/preview/*` duplicate (both prefixes share one handler instance, so each call still emits exactly once).
- **Write actions** (currently just `commit`) emit from the **service layer**, at the operation's seam — e.g. `commit_*_revision(...)`. This covers direct commit routes, simple-service create/edit, deploy paths, and any other caller of the same service method. Future write actions (`archive`, `unarchive`, …) should follow the same service-layer rule.
- The read/write split is asymmetric on purpose: reads have legitimate internal callers that must stay silent; writes do not. See `core/events/utils.py` module docstring for the full rationale.
- Do not emit from `TracingRouter` or `SpansRouter` (legacy / out-of-scope span endpoints).
- Do not emit workflow revision events for now.
- Suppress emission when `count == 0` (and for commits when the revision is not returned).
- Do not put generic `links` in every payload. Use event-specific fields only where useful.
- Cap event-specific reference lists at 1000 entries. `count` stays uncapped.

## Existing Environment Commit Event

Current producer:

- `api/oss/src/core/environments/service.py::commit_environment_revision`
- Event type: `environments.revisions.committed`

Current attributes body:

```json
{
  "user_id": "user-id",
  "references": {
    "environment": {
      "id": "environment-id"
    },
    "environment_variant": {
      "id": "environment-variant-id"
    },
    "environment_revision": {
      "id": "environment-revision-id",
      "slug": "v3",
      "version": 3
    }
  },
  "state": {
    "references": {
      "app": {
        "application_revision": {
          "id": "application-revision-id"
        }
      }
    }
  },
  "diff": {
    "created": {
      "app": {
        "new": {
          "application_revision": {
            "id": "application-revision-id"
          }
        }
      }
    },
    "updated": {},
    "deleted": {}
  }
}
```

Current-code detail:

- `EnvironmentRevisionCommit` accepts `data` and `delta`.
- Delta commits are resolved into full `data` before the DAO commit.
- The existing event records the committed revision references, normalized committed `state`, and a references `diff`.
- The current `diff` shape is `{created, updated, deleted}`. Created entries contain `new`; updated entries contain `old` and `new`; deleted entries contain `old`.

Commit payload rule:

- Keep the existing `environments.revisions.committed` `references`, `state`, and `diff`.
- Add optional `message` to `environments.revisions.committed` for commit-event uniformity.
- For the new application, query, testset, and evaluator commit events, do not include `state` or `diff` in the first version.
- Include `message` on new commit events when present.
- Delta commits emit exactly one `*.revisions.committed` event, after the delta is resolved into full committed data.

Environment commit body shape:

```json
{
  "user_id": "user-id",
  "references": {
    "environment": {"id": "environment-id"},
    "environment_variant": {"id": "environment-variant-id"},
    "environment_revision": {"id": "environment-revision-id", "slug": "v3", "version": 3}
  },
  "message": "Promote prompt changes",
  "state": {
    "references": {
      "app-id": {
        "application": {"id": "application-id"},
        "application_variant": {"id": "application-variant-id"},
        "application_revision": {"id": "application-revision-id"}
      }
    }
  },
  "diff": {
    "created": {
      "app-id": {
        "new": {
          "application": {"id": "application-id"},
          "application_variant": {"id": "application-variant-id"},
          "application_revision": {"id": "application-revision-id"}
        }
      }
    },
    "updated": {},
    "deleted": {}
  }
}
```

For delta commits, the event still describes the resulting committed state and diff:

```json
{
  "user_id": "user-id",
  "references": {
    "environment": {"id": "environment-id"},
    "environment_variant": {"id": "environment-variant-id"},
    "environment_revision": {"id": "environment-revision-id", "slug": "v4", "version": 4}
  },
  "message": "Update one app reference",
  "state": {
    "references": {
      "app-id": {
        "application_revision": {"id": "application-revision-id-new"}
      }
    }
  },
  "diff": {
    "created": {},
    "updated": {
      "app-id": {
        "old": {"application_revision": {"id": "application-revision-id-old"}},
        "new": {"application_revision": {"id": "application-revision-id-new"}}
      }
    },
    "deleted": {}
  }
}
```

For remove delta commits:

```json
{
  "user_id": "user-id",
  "references": {
    "environment": {"id": "environment-id"},
    "environment_variant": {"id": "environment-variant-id"},
    "environment_revision": {"id": "environment-revision-id", "slug": "v5", "version": 5}
  },
  "message": "Remove retired app reference",
  "state": {
    "references": {}
  },
  "diff": {
    "created": {},
    "updated": {},
    "deleted": {
      "app-id": {
        "old": {"application_revision": {"id": "application-revision-id-old"}}
      }
    }
  }
}
```

## Revision Payload Pattern

Read events (`retrieved` / `fetched` / `queried` / `logged`) always include `count`. Commit events (`committed`) omit `count` — the helper drops it automatically. Per-event examples below reflect this; the generic shapes in this section apply to read events.

Single revision read events use domain-specific `references`:

```json
{
  "user_id": "00000000-0000-0000-0000-000000000001",
  "count": 1,
  "references": {
    "application": {"id": "app-id"},
    "application_variant": {"id": "variant-id"},
    "application_revision": {"id": "revision-id", "slug": "v1", "version": 1}
  }
}
```

Multi-result revision query/log events may include capped `references`:

```json
{
  "user_id": "00000000-0000-0000-0000-000000000001",
  "count": 2,
  "references": [
    {
      "artifact": {"id": "entity-id"},
      "variant": {"id": "variant-id"},
      "revision": {"id": "revision-id-1", "slug": "v2", "version": 2}
    },
    {
      "artifact": {"id": "entity-id"},
      "variant": {"id": "variant-id"},
      "revision": {"id": "revision-id-2", "slug": "v1", "version": 1}
    }
  ]
}
```

Cap `references` at 1000 and keep `count` uncapped.

`references` are partial identity objects, not full entity snapshots. Include the fields available on the returned DTO. Artifact and variant references may only have `id`; revision references commonly have `id`, `slug`, and `version`, but missing fields are acceptable.

## Applications

### `applications.revisions.retrieved`

Route: `POST /applications/revisions/retrieve`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "application": {"id": "application-id"},
    "application_variant": {"id": "application-variant-id"},
    "application_revision": {"id": "application-revision-id", "slug": "v3", "version": 3}
  }
}
```

### `applications.revisions.fetched`

Route: `GET /applications/revisions/{application_revision_id}`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "application": {"id": "application-id"},
    "application_variant": {"id": "application-variant-id"},
    "application_revision": {"id": "application-revision-id", "slug": "v3", "version": 3}
  }
}
```

### `applications.revisions.queried`

Route: `POST /applications/revisions/query`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "application": {"id": "application-id"},
      "application_variant": {"id": "application-variant-id"},
      "application_revision": {"id": "application-revision-id-1", "slug": "v3", "version": 3}
    },
    {
      "application": {"id": "application-id"},
      "application_variant": {"id": "application-variant-id"},
      "application_revision": {"id": "application-revision-id-2", "slug": "v2", "version": 2}
    }
  ]
}
```

### `applications.revisions.logged`

Route: `POST /applications/revisions/log`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "application": {"id": "application-id"},
      "application_variant": {"id": "application-variant-id"},
      "application_revision": {"id": "application-revision-id-1", "slug": "v3", "version": 3}
    },
    {
      "application": {"id": "application-id"},
      "application_variant": {"id": "application-variant-id"},
      "application_revision": {"id": "application-revision-id-2", "slug": "v2", "version": 2}
    }
  ]
}
```

### `applications.revisions.committed`

Route: `POST /applications/revisions/commit`, or any path that reaches successful application revision commit logic.

```json
{
  "user_id": "user-id",
  "references": {
    "application": {"id": "application-id"},
    "application_variant": {"id": "application-variant-id"},
    "application_revision": {"id": "application-revision-id", "slug": "v4", "version": 4}
  },
  "message": "Commit application changes"
}
```

## Queries

### `queries.revisions.retrieved`

Route: `POST /queries/revisions/retrieve`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "query": {"id": "query-id"},
    "query_variant": {"id": "query-variant-id"},
    "query_revision": {"id": "query-revision-id", "slug": "v1", "version": 1}
  }
}
```

### `queries.revisions.fetched`

Route: `GET /queries/revisions/{query_revision_id}`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "query": {"id": "query-id"},
    "query_variant": {"id": "query-variant-id"},
    "query_revision": {"id": "query-revision-id", "slug": "v1", "version": 1}
  }
}
```

### `queries.revisions.queried`

Route: `POST /queries/revisions/query`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "query": {"id": "query-id"},
      "query_variant": {"id": "query-variant-id"},
      "query_revision": {"id": "query-revision-id-1", "slug": "v2", "version": 2}
    },
    {
      "query": {"id": "query-id"},
      "query_variant": {"id": "query-variant-id"},
      "query_revision": {"id": "query-revision-id-2", "slug": "v1", "version": 1}
    }
  ]
}
```

### `queries.revisions.logged`

Route: `POST /queries/revisions/log`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "query": {"id": "query-id"},
      "query_variant": {"id": "query-variant-id"},
      "query_revision": {"id": "query-revision-id-1", "slug": "v2", "version": 2}
    },
    {
      "query": {"id": "query-id"},
      "query_variant": {"id": "query-variant-id"},
      "query_revision": {"id": "query-revision-id-2", "slug": "v1", "version": 1}
    }
  ]
}
```

### `queries.revisions.committed`

Route: `POST /queries/revisions/commit`, or any path that reaches successful query revision commit logic.

```json
{
  "user_id": "user-id",
  "references": {
    "query": {"id": "query-id"},
    "query_variant": {"id": "query-variant-id"},
    "query_revision": {"id": "query-revision-id", "slug": "v3", "version": 3}
  },
  "message": "Commit query changes"
}
```

## Testsets

### `testsets.revisions.retrieved`

Route: `POST /testsets/revisions/retrieve`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "testset": {"id": "testset-id"},
    "testset_variant": {"id": "testset-variant-id"},
    "testset_revision": {"id": "testset-revision-id", "slug": "v1", "version": 1}
  }
}
```

### `testsets.revisions.fetched`

Route: `GET /testsets/revisions/{testset_revision_id}`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "testset": {"id": "testset-id"},
    "testset_variant": {"id": "testset-variant-id"},
    "testset_revision": {"id": "testset-revision-id", "slug": "v1", "version": 1}
  }
}
```

### `testsets.revisions.queried`

Route: `POST /testsets/revisions/query`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "testset": {"id": "testset-id"},
      "testset_variant": {"id": "testset-variant-id"},
      "testset_revision": {"id": "testset-revision-id-1", "slug": "v2", "version": 2}
    },
    {
      "testset": {"id": "testset-id"},
      "testset_variant": {"id": "testset-variant-id"},
      "testset_revision": {"id": "testset-revision-id-2", "slug": "v1", "version": 1}
    }
  ]
}
```

### `testsets.revisions.logged`

Route: `POST /testsets/revisions/log`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "testset": {"id": "testset-id"},
      "testset_variant": {"id": "testset-variant-id"},
      "testset_revision": {"id": "testset-revision-id-1", "slug": "v2", "version": 2}
    },
    {
      "testset": {"id": "testset-id"},
      "testset_variant": {"id": "testset-variant-id"},
      "testset_revision": {"id": "testset-revision-id-2", "slug": "v1", "version": 1}
    }
  ]
}
```

### `testsets.revisions.committed`

Route: `POST /testsets/revisions/commit`, or any path that reaches successful testset revision commit logic.

```json
{
  "user_id": "user-id",
  "references": {
    "testset": {"id": "testset-id"},
    "testset_variant": {"id": "testset-variant-id"},
    "testset_revision": {"id": "testset-revision-id", "slug": "v3", "version": 3}
  },
  "message": "Commit testset changes"
}
```

## Evaluators

### `evaluators.revisions.retrieved`

Route: `POST /evaluators/revisions/retrieve`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "evaluator": {"id": "evaluator-id"},
    "evaluator_variant": {"id": "evaluator-variant-id"},
    "evaluator_revision": {"id": "evaluator-revision-id", "slug": "v1", "version": 1}
  }
}
```

### `evaluators.revisions.fetched`

Route: `GET /evaluators/revisions/{evaluator_revision_id}`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "evaluator": {"id": "evaluator-id"},
    "evaluator_variant": {"id": "evaluator-variant-id"},
    "evaluator_revision": {"id": "evaluator-revision-id", "slug": "v1", "version": 1}
  }
}
```

### `evaluators.revisions.queried`

Route: `POST /evaluators/revisions/query`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "evaluator": {"id": "evaluator-id"},
      "evaluator_variant": {"id": "evaluator-variant-id"},
      "evaluator_revision": {"id": "evaluator-revision-id-1", "slug": "v2", "version": 2}
    },
    {
      "evaluator": {"id": "evaluator-id"},
      "evaluator_variant": {"id": "evaluator-variant-id"},
      "evaluator_revision": {"id": "evaluator-revision-id-2", "slug": "v1", "version": 1}
    }
  ]
}
```

### `evaluators.revisions.logged`

Route: `POST /evaluators/revisions/log`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "evaluator": {"id": "evaluator-id"},
      "evaluator_variant": {"id": "evaluator-variant-id"},
      "evaluator_revision": {"id": "evaluator-revision-id-1", "slug": "v2", "version": 2}
    },
    {
      "evaluator": {"id": "evaluator-id"},
      "evaluator_variant": {"id": "evaluator-variant-id"},
      "evaluator_revision": {"id": "evaluator-revision-id-2", "slug": "v1", "version": 1}
    }
  ]
}
```

### `evaluators.revisions.committed`

Route: `POST /evaluators/revisions/commit`, or any path that reaches successful evaluator revision commit logic.

```json
{
  "user_id": "user-id",
  "references": {
    "evaluator": {"id": "evaluator-id"},
    "evaluator_variant": {"id": "evaluator-variant-id"},
    "evaluator_revision": {"id": "evaluator-revision-id", "slug": "v3", "version": 3}
  },
  "message": "Commit evaluator changes"
}
```

## Environments

### `environments.revisions.retrieved`

Route: `POST /environments/revisions/retrieve`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "environment": {"id": "environment-id"},
    "environment_variant": {"id": "environment-variant-id"},
    "environment_revision": {"id": "environment-revision-id", "slug": "v1", "version": 1}
  }
}
```

### `environments.revisions.fetched`

Route: `GET /environments/revisions/{environment_revision_id}`

```json
{
  "user_id": "user-id",
  "count": 1,
  "references": {
    "environment": {"id": "environment-id"},
    "environment_variant": {"id": "environment-variant-id"},
    "environment_revision": {"id": "environment-revision-id", "slug": "v1", "version": 1}
  }
}
```

### `environments.revisions.queried`

Route: `POST /environments/revisions/query`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "environment": {"id": "environment-id"},
      "environment_variant": {"id": "environment-variant-id"},
      "environment_revision": {"id": "environment-revision-id-1", "slug": "v2", "version": 2}
    },
    {
      "environment": {"id": "environment-id"},
      "environment_variant": {"id": "environment-variant-id"},
      "environment_revision": {"id": "environment-revision-id-2", "slug": "v1", "version": 1}
    }
  ]
}
```

### `environments.revisions.logged`

Route: `POST /environments/revisions/log`

```json
{
  "user_id": "user-id",
  "count": 2,
  "references": [
    {
      "environment": {"id": "environment-id"},
      "environment_variant": {"id": "environment-variant-id"},
      "environment_revision": {"id": "environment-revision-id-1", "slug": "v2", "version": 2}
    },
    {
      "environment": {"id": "environment-id"},
      "environment_variant": {"id": "environment-variant-id"},
      "environment_revision": {"id": "environment-revision-id-2", "slug": "v1", "version": 1}
    }
  ]
}
```

### `environments.revisions.committed`

Route: `POST /environments/revisions/commit`, or any path that reaches successful environment revision commit logic.

Delta commits emit exactly one `environments.revisions.committed` event, after the delta is resolved into the resulting committed state.

```json
{
  "user_id": "user-id",
  "references": {
    "environment": {"id": "environment-id"},
    "environment_variant": {"id": "environment-variant-id"},
    "environment_revision": {"id": "environment-revision-id", "slug": "v3", "version": 3}
  },
  "message": "Commit environment changes",
  "state": {
    "references": {
      "app-id": {
        "application_revision": {"id": "application-revision-id"}
      }
    }
  },
  "diff": {
    "created": {
      "app-id": {
        "new": {
          "application_revision": {"id": "application-revision-id"}
        }
      }
    },
    "updated": {},
    "deleted": {}
  }
}
```

## Testcases

### `testcases.fetched`

Routes: `GET /testcases/`, `GET /testcases/{testcase_id}`

```json
{
  "user_id": "user-id",
  "count": 1,
  "testcase_id": "testcase-id"
}
```

### `testcases.queried`

Route: `POST /testcases/query`

```json
{
  "user_id": "user-id",
  "count": 2,
  "testcase_ids": ["testcase-id-1", "testcase-id-2"]
}
```

## Traces

### `traces.fetched`

Route: stable trace fetch endpoint.

```json
{
  "user_id": "user-id",
  "count": 1,
  "trace_id": "trace-id"
}
```

### `traces.queried`

Route: stable trace query endpoint.

```json
{
  "user_id": "user-id",
  "count": 2,
  "trace_ids": ["trace-id-1", "trace-id-2"]
}
```

## Limits

- Cap reference lists at 1000.
- Keep `count` as the uncapped returned count.
- Do not store raw filter/query expressions by default.
- Do not emit read events when `count == 0`.
