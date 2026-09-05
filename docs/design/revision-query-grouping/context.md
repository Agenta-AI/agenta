# Why this work exists

## What a user sees today

A user opens an agent session in the playground. The agent runs for a while. Then one turn
fails with this message:

```
session <id> record log is unreadable; cannot rebuild the conversation
```

Nothing is wrong with the session. The record log is intact. The turn failed because the
API did not answer a request within five seconds, and the runner gave up.

The API did not answer because its event loop was blocked. One ordinary request to
`POST /workflows/revisions/query` held the worker for about two seconds. Several of them
arrived together.

## How one request blocks a worker for two seconds

The playground needs the newest revision of each of several workflows. The API cannot
express that request. Its `windowing.limit` applies to the whole result, not to each
parent. A limit of 5 over 5 workflows can return 5 revisions of the first workflow and
none of the others.

The frontend has no safe option, so it drops the limit and takes everything. The comment
in `web/packages/agenta-entities/src/workflow/api/api.ts` says so:

> When fetching for a single workflow, limit to 1 (latest) to reduce payload.
> With multiple workflows the global limit would cut across all, so skip it.

On the project we measured, two workflows hold 179 of 258 revisions. A batch over those
two returns 177 revisions and a 76 MB response body. Building and compressing that
response costs about 1.9 seconds of CPU, and none of it yields to the event loop.

## Why the fix belongs in the API, not the client

The client can work around it, but badly. A scoped single-workflow request with
`windowing.limit: 1` does reach SQL as a real `LIMIT 1`, and the existing single-workflow
fetcher already does that. So a list page with twenty workflows could make twenty small
requests. That trades one slow request for twenty round trips, and it still leaves the
batch endpoint unable to answer the question it exists to answer. It is a usable emergency
mitigation, not a fix.

The database can answer this question cheaply. Postgres `DISTINCT ON` returns the newest
row per group in one pass. The repository already does exactly this in
`RecordsDAO.latest_message_per_session`, for the same reason.

## Goals

1. Let a caller ask for the newest N revisions of each parent, in one request.
2. Push the fold into SQL, so the discarded rows never reach Python.
3. Keep the six revision query endpoints consistent with each other.
4. Change nothing for callers that do not ask for the new behavior.

## Non-goals

1. We do not change how revisions are stored.
2. We do not change the runner's five-second budget. That budget is reasonable. The API
   must answer inside it.
3. We do not fix the two other costs found in the same investigation: schema revalidation
   on read, and gzip compression on the event loop. Those are tracked in `status.md`.
   Shrinking the payload reduces both, but it does not remove them.

## What success looks like

A batch over five workflows returns five revisions instead of every revision those five
workflows have. Measure the response in bytes, not only in rows: a single large revision
can still be big, and this change bounds the row count, not the size of one row.

Then check the API's per-minute latency probe under playground load. It sits at 0.01
seconds normally and reached 4.90 seconds during the incident. This change removes one
large source of blocking. It does not on its own keep one request from blocking others,
and `status.md` records the gzip work that addresses that.
