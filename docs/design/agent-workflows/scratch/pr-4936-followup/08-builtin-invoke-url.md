# Thread 08 — The builtin app invoke URL (the hack you flagged)

## Context

The playground invokes an app by having the browser POST to the app's `/invoke` URL, so
that URL must be reachable from the browser. PR #4936 added a frontend change here that you
flagged as a hack for a problem we never had. You were right.

## Explanations

- The frontend change (`runnableSetup.ts`) rebuilt the builtin invoke URL from the URI
  instead of trusting the stored `data.url`. It landed in #4936 on 2026-06-30.
- The invoke path had actually run fine on the plain stored-URL path for about three months
  before that. Arda removed this same helper from the invoke path back in March.
- The real cause: on 2026-06-29 an agent `commit_revision` self-update wrote the agent
  service's INTERNAL address (`http://agenta-agent:8000/v0/invoke`) into the stored
  `data.url` for the agent app (revisions v7-v9). The backend only recomputed the URL when
  `data.url` was empty, and commit never stripped an incoming value, so the bad URL stuck and
  the browser could not reach it.
- The #4936 frontend hack only handled `completion` and `chat`, never `agent`, so it did not
  even fix the broken app, and it was unnecessary for the others.
- So a recent agent both caused the bad URL (through `commit_revision`) and then added the
  workaround that masked it.

## History

- 2026-03: Arda removed this helper from the invoke path (it ran fine without it for months).
- 2026-06-29: an agent `commit_revision` self-update poisoned the stored `data.url` (v7-v9).
- 2026-06-30: #4936 re-added the frontend hack, incompletely.
- 2026-06-30: PR #4982 first did backend recompute/strip + FE revert (live-verified HTTP 200).
- 2026-06-30 (your review of #4982): **REVERT the backend change.** The agent making a bad call
  is the issue, not the backend; do not change core business logic to mask it. So #4982 becomes
  FE-revert-only (remove the #4936 hack). The root cause is prevented in the `commit_revision`
  tool (thread 01): it edits only `parameters.agent` and never writes `data.url`, so it cannot
  poison the URL. The #4982 amendment is QUEUED behind the in-flight cleanup PR (one git-writer
  at a time). CodeRabbit's 2 comments are mooted (they were about the backend code being removed).
- 2026-06-30 17:49: **#4982 MERGED** into big-agents as FE-revert-only (merge commit
  `19e0f2d9`; lane diff = `runnableSetup.ts` only; `service.py` back to base; the test removed).
  Done. The poisoned dev rows are ignored per your call.

## Open decision threads

**D1. Migrate the 3 poisoned rows, or rely on correct-on-read?**
Three stored revisions still hold the bad internal URL. The read path now masks them and no
new ones can be written, so a migration is optional.
- (a) Rely on correct-on-read, ship no migration.
- (b) Ship a one-off migration to null those 3 `data.url` values.

My recommendation: (a). The read path already masks them and the write path is fixed.

Your decision: **don't care about the poisoned rows.** Dev/QA app, no production impact, so no
migration and no re-commit. Just SHIP #4982 as FE-revert-only (revert the #4936 hack; the backend
business-logic change is reverted per your review). Shipping now.
