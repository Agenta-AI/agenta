# Limit Railway preview lifetime and restart from PR comments

Status: Behavior specifications approved by Mahmoud on 2026-09-22. Implementation and validation are tracked in tasks.md and validation.md.

## Why

Railway previews currently stay alive after continuous integration (CI) tests finish. Mahmoud reports that Railway is expensive and wants automatic shutdown, with a pull request (PR) comment to bring a preview back for one hour.

## What Changes

- Delete an automatic preview after all tests using that environment finish, whether they pass or fail. Preserve diagnostics before deletion and keep independent cleanup for cancelled or interrupted runs.
- Accept `/preview` as a standalone PR comment from an authorized maintainer. Recreate the preview for that PR's resolved head commit, not the default branch.
- Give a manual preview 60 minutes from readiness, with a separate bounded startup period. Show the URL, deployed commit and UTC expiry in the existing preview status comment.
- Treat repeated commands while a preview is starting or available as status requests. They do not extend its expiry. A new comment after expiry can create another one-hour preview.
- Keep a running CI preview until its dependent tests finish, subject to a separate maximum CI lifetime. A manual request must not invalidate active tests, and test completion must not delete an unexpired manual preview.
- Reconcile expired and abandoned previews on a five-minute schedule. Describe this as an expiry target, not an exact shutdown guarantee.
- Delete only the PR preview environment. Protect production, the shared template and unrelated environments. Verify deletion and inspect retained storage rather than assuming compute deletion removes every charge.
- **BREAKING:** Automatic preview links no longer remain usable after tests. The bot comment explains how to request a new preview. Preview data is disposable and may be lost on recreation.

## Capabilities

### New Capabilities

- `railway-preview-lifecycle`: Bound automatic and manual preview use, handle failures and concurrent runs, and verify cleanup.
- `railway-preview-comments`: Authorize a PR comment, resolve the correct revision, and show the preview's current status and expiry.

### Modified Capabilities

None. The repository has no archived OpenSpec capability covering Railway previews.

## Impact

The implementation affects the PR preview workflow, reusable image build, cleanup and PR-comment workflows, and a shared lifecycle controller. It replaces the separate setup/deploy comment writers, reuses the clone script, and adds offline tests plus an opt-in provider acceptance workflow.

Existing automatic eligibility stays in scope as-is: non-draft PRs with relevant changed paths. Builds finish before Railway setup. Documentation-only changes remain excluded. Additional test-selection optimization, a strict dollar cap and a concurrency quota are separate work.

## Confirmed direction and proposed defaults

Confirmed by Mahmoud: shutdown after CI; restart from a comment on the PR; automatic shutdown after about one hour for a manual restart; draft this in the repository's OpenSpec workspace.

Approved defaults: `/preview` spelling; write/maintain/admin access; manual previews only on open, non-draft, same-repository PRs; one hour from readiness; no renewal while active; 30-minute startup limit; 120-minute automatic lifetime from creation; five-minute cleanup schedule. Durations are configurable by maintainers, not by arbitrary comment arguments.
