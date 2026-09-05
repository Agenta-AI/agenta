# Status

Last updated 2026-09-05.

## Where the work stands

Planning, with one small fix already landed. The API change is not written yet.

The measurements in `research.md` come from the running `agenta-oss-team` stack on images
`v0.114.5`. The design was reviewed by Codex (`gpt-6-astra`, medium effort) on 2026-09-05,
and this document records what changed as a result.

## Landed

One correctness fix in `web/packages/agenta-entities/src/testset/api/api.ts`,
`fetchLatestRevisionsBatch`. It was three separate problems in one function:

1. It sent `{id, limit: 1}` inside a `Reference`, and the API drops unknown keys, so the
   limit never applied.
2. Its docstring described a `ReferenceWithLimit` feature with SQL window functions. No
   such feature exists anywhere in the repository.
3. It sent no `windowing`, and `query_revisions` applies an `ORDER BY` only when windowing
   is present. So the rows came back in unspecified order, and the loop kept whichever
   revision arrived last. A function named "latest" returned an arbitrary revision.

The fix asks for newest first, keeps the first revision seen per testset, and prefers a
configured revision over an auto-created version 0 placeholder. That last rule matches the
sibling fetcher in `web/oss/src/state/entities/testset/revisionEntity.ts`.

The fix does not stop the over-fetch. That needs the API change planned here.

## Decisions made

- The new field is a sibling of `windowing`, named `grouping`. Mahmoud chose this shape.
- The first release carries `by` only, and returns at most one revision per parent. The
  `limit` field for "newest N per parent" is dropped until a caller needs it.
- Paging over parents is rejected, not redefined. `api-design.md` gives the worked example
  where a revision cursor makes a parent appear on two pages.
- All six revision query endpoints get the field in the same change.
- Nothing ships until the behavior works end to end. The earlier plan to land the field
  first, accepted and ignored, is unsafe here, and `plan.md` explains why.

## Open questions

- What counts as the newest revision when version 0 can be either an empty placeholder or a
  real configured revision. This blocks Step 2.
- Whether `grouping` means "the newest revision that matches the filter" or "the newest
  revision, returned only if it matches". The two differ whenever a filter is present.
- Whether any caller outside this repository depends on the current unbounded behavior. The
  change is additive, so the risk is low, but the SDK is public.

## Related work found in the same investigation

Separate from this plan. The first one now looks more urgent than this change.

**gzip on the event loop.** `api/entrypoints/routers.py:503` adds
`GZipMiddleware(minimum_size=1000, compresslevel=5)`, which compresses synchronously. It
was 1293 ms of the 1916 ms we measured, so about two thirds of the cost. Shrinking payloads
reduces it, but only compression work moving off the request path removes it.

There may be a simple answer. The OSS nginx config at
`hosting/docker-compose/oss/nginx/nginx.conf` already sets `gzip on` and includes
`application/json`, so in that deployment the API duplicates work the proxy can do. Note
the stack where the incident happened runs Traefik, not nginx, so the proxies differ by
deployment and each path needs checking before the middleware is removed.

**Schema revalidation on read.** `WorkflowRevisionData._validate` in
`sdks/python/agenta/sdk/models/workflows.py` runs `jsonschema.check_schema` on every model
construction, so reads re-check schemas that were validated at write time. 2.2 ms per
revision. Moving the check to the write boundaries needs an audit of creation, commit, and
import paths first. Do not simply delete it from a shared SDK model.

**The session record log has no pagination.** `RecordsDAO.get_records` returns every record
for a session. 95 ms today, and it grows with every turn.

**A fourth batch shape with the same gap.** `GitDAO.query_variants` takes artifact
references with a global limit, so newest-variant-per-artifact has the same problem. No
caller needs it today. Recorded so nobody has to rediscover it, not scheduled.
