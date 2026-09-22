# Railway lifecycle validation

Status: Implementation under test. Do not treat this document as a runtime acceptance claim until the provider evidence is recorded.

## Local checks

- 45 offline tests cover lifecycle policy, command parsing, permissions, exact revision tags, configuration, overlapping CI/manual use, cancellation, cleanup failure, generation/identity checks, pagination and provider write verification.
- Python Ruff lint and formatting passed for the controller and tests.
- Actionlint 1.7.12 passed for the affected workflows.
- No application test suite was removed from workflow 14. The redundant three full clone cycles on every script PR are now opt-in through workflow 48. Workflow 50 runs the focused regression tests on every relevant PR.

## Provider acceptance

Run workflow 48 on this branch with `lifecycle_pr`, `comment_id`, and the full `patch_tag` produced by workflow 14. It replays a real, unedited, authorized `/preview` comment through the production handler, uses a separate `pr-clone-lifecycle-<run>` environment, and writes an evidence artifact and job summary.

The acceptance script verifies real GitHub permission/state writes, real Railway setup/readiness, duplicate delivery, a stale finalizer, accelerated expiry and immediate automatic-mode finalization. An injected clock tests the one-hour deadline without paying for an idle hour. Source image jobs must have passed; this does not wait for web tests or claim they passed.

The native `issue_comment`, `workflow_run` and scheduled event registrations come from the default branch. Pre-merge acceptance tests the handler and provider effects, not activation of an unmerged workflow. One native command must be checked after merge.

## Limits

Environment absence is verified through Railway. This does not prove that Railway deleted all retained-volume billing records. The status comment explicitly warns about this limitation. Actual bill reduction requires a later billing comparison.
