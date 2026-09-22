# Railway lifecycle validation

Status: Implementation under test. Do not treat this document as a runtime acceptance claim until the provider evidence is recorded.

## Local checks

- 59 offline tests cover lifecycle policy, command parsing, permissions, exact revision tags, configuration, overlapping CI/manual use, cancellation, cleanup failure, generation/identity checks, pagination, provider write verification, and create retry over a releasing environment name.
- Python Ruff lint and formatting passed for the controller and tests.
- Actionlint 1.7.12 passed for the affected workflows.
- No application test suite was removed from workflow 14. The redundant three full clone cycles on every script PR are now opt-in through workflow 48. Workflow 50 runs the focused regression tests on every relevant PR.

## Provider acceptance: first run and fix (2026-09-22)

The first acceptance run created a real environment, passed the readiness smoke, stored the one-hour deadline, ran the duplicate and stale-finalizer checks, then deleted the environment at expiry and verified its absence. The automatic-mode second cycle then failed: it recreated the same environment name immediately, and Railway rejected it with "an environment with that name already exists".

Root cause is a real Railway property, not a controller logic error. `environmentDelete` is asynchronous: Railway delists an environment (so a listing-based absence check passes) before it frees the environment's globally unique name. A create for the same PR that lands inside that release window fails, and the create script's appearance-poll times out because the name is releasing, not being created. This is reachable in production when an expiry or post-test delete is quickly followed by a new push or `/preview` for the same PR.

Fix: `Railway.create` now retries provisioning while nothing is live for the PR (`RAILWAY_CREATE_ATTEMPTS`, `RAILWAY_CREATE_RETRY_SECONDS`). It is duplicate-safe because the create script's own name-poll already adopts any in-flight background create before returning failure, and the retry is skipped when a live environment indicates a mid-deploy failure rather than a contested name. Three offline tests cover the retry, the no-retry-over-live-env case, and the attempt budget. The acceptance run is being repeated against the fixed revision.

## Provider acceptance

Run workflow 48 on this branch with `lifecycle_pr`, `comment_id`, and the full `patch_tag` produced by workflow 14. It replays a real, unedited, authorized `/preview` comment through the production handler, uses a separate `pr-clone-lifecycle-<run>` environment, and writes an evidence artifact and job summary.

The acceptance script verifies real GitHub permission/state writes, real Railway setup/readiness, duplicate delivery, a stale finalizer, accelerated expiry and immediate automatic-mode finalization. An injected clock tests the one-hour deadline without paying for an idle hour. Source image jobs must have passed; this does not wait for web tests or claim they passed.

The native `issue_comment`, `workflow_run` and scheduled event registrations come from the default branch. Pre-merge acceptance tests the handler and provider effects, not activation of an unmerged workflow. One native command must be checked after merge.

## Limits

Environment absence is verified through Railway. This does not prove that Railway deleted all retained-volume billing records. The status comment explicitly warns about this limitation. Actual bill reduction requires a later billing comparison.
