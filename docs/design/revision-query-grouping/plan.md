# Execution plan

The whole feature ships in one release. We do not land the request field before the
behavior works, and the reason is specific. See "Why we do not ship the field early".

## Why we do not ship the field early

An earlier draft planned to add the field first, accepted and ignored, so the shape could
be reviewed on its own. That plan is unsafe here.

The workflows and environments routers do not take a declared body model. They read
`await request.json()` and expand it into a parser function with an explicit keyword
signature, inside a bare `except Exception: pass`. Checked on the running API:

```
parse_workflow_revision_query_request_from_body(**{"workflow_refs": [...], "grouping": {...}})
  -> TypeError: got an unexpected keyword argument 'grouping'
```

The router swallows that error and leaves the parsed body as `None`. The parent references
go with it, so the query stops being scoped and returns every revision in the project. A
client that adopted the field early would make the exact incident worse.

So the parsers change in the same step as the models, and a malformed `grouping` returns a
client error rather than a silently broader query.

## Step 1: settle eligibility, then write it down

Before any code, answer these per endpoint and record the answers in `api-design.md`:

- Which revision counts as the newest one, given that version 0 can be either an empty
  placeholder or a real configured revision.
- Whether `grouping` means "the newest revision that matches the filter" or "the newest
  revision, returned only if it matches".
- Which combinations return a client error. The current list is a revision cursor, a time
  range, the environments `references` filter, and post-SQL flag matching.

This step exists because folding first changes which parents appear at all, not just how
many rows come back.

## Step 2: API, end to end, in one change

- Add `RevisionGrouping` next to `RevisionQuery` in the git core DTOs.
- Add `grouping` to all six request models: workflows, testsets, evaluators, environments,
  applications, and queries.
- Update the body and parameter parsers and the merge helpers in the `utils.py` of each
  router that has them. Workflows and environments both parse by keyword expansion.
- Make a malformed or unsupported `grouping` return a client error. Do not let it fall
  through the bare `except` into an unscoped query.
- Extend `GitDAOInterface.query_revisions`, the concrete `GitDAO`, and the six service
  signatures. Applications and evaluators reach this through `WorkflowsService`.
- Apply the fold in SQL with `DISTINCT ON`. Its expressions must lead the `ORDER BY`, so
  the response order needs an outer ordering stage on top of the fold.

## Step 3: clients and documentation

- Check the OpenAPI schema actually describes the request body. The workflows handler reads
  `Request.json()` rather than declaring a body model, and the generated Python client
  exposes query parameters instead of the body. Regeneration alone will not fix that.
- Regenerate both clients with `clients/scripts/generate.sh`: Python under
  `clients/python/agenta_client`, TypeScript under `web/packages/agenta-api-client`.
- Rebuild `@agentaai/api-client` so consumers see the new types.
- Update the query and versioning guides with what "latest" means and which combinations
  are rejected.

## Step 4: move the three callers

- `fetchWorkflowsBatch` in `web/packages/agenta-entities/src/workflow/api/api.ts` passes
  `grouping` and drops the comment about the global limit.
- `fetchLatestRevisionsBatch` in `web/packages/agenta-entities/src/testset/api/api.ts`
  passes `grouping` and drops the client-side fold. Its immediate correctness fix already
  landed. See `status.md`.
- `fetchLatestRevisionsBatch` in `web/oss/src/state/entities/testset/revisionEntity.ts`
  passes `grouping`. It uses `windowing: {limit: ids.length * 5}` today, so one testset
  with many revisions can consume the whole allowance and starve the others. Its selection
  rule is highest version with a fallback to version 0, and moving it needs the eligibility
  decision from Step 1.

Leave alone the queries that page revision history on purpose, such as the evaluator table
in `web/oss/src/components/Evaluators/store/evaluatorsPaginatedStore.ts`. Grouping is not
right for every batched query.

## Tests

Unit tests on the DAO are not enough. The dangerous failures are in parsing and in SQL.

- Run the SQL against real PostgreSQL, not a mock.
- Cover all six HTTP paths, using the existing acceptance tests in
  `api/oss/tests/pytest/acceptance/workflows/test_workflow_revisions_queries.py` as the
  starting point.
- Cover a malformed `grouping`, and assert it returns a client error rather than a broader
  result. This is the regression that would repeat the incident.
- Cover project scope, archived revisions, several variants under one artifact, an empty
  placeholder next to a configured version 0, and each rejected combination.
- Cover the three batch callers.

## How we check it worked

Measure the same batch before and after on a project with many revisions, and record the
response bytes rather than only the row count. Then run heavy revision queries and session
record log requests together against the deployed stack, and measure event loop delay. The
per-minute scheduler request is a usable probe: it sat at 0.01 s normally and reached
4.90 s during the incident.

Shrinking this payload removes one large source of blocking. It does not by itself keep one
request from blocking others. The gzip work tracked in `status.md` is what addresses that.
