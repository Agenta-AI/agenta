# Implementation tasks

Status: Draft. No runtime work is complete. Document validation does not count as implementation evidence.

## 1. Confirm policy and establish baseline

- [ ] 1.1 Review the proposed command, permissions, fork/draft restrictions, no-renewal rule and timing defaults with Mahmoud; record the approved policy in the proposal before implementation.
- [ ] 1.2 Capture recent provisioning and dependent-test durations plus a dry-run preview inventory; verify the proposed startup and CI limits against measured runs without waiting on web CI in the working session.
- [ ] 1.3 Validate this change with `openspec validate railway-preview-cost-controls --strict --no-interactive`; retain format validation separately from runtime acceptance results.

## 2. Implement lifecycle state and coordinated mutations

- [ ] 2.1 Add the versioned bot-comment state schema and validated maintainer configuration; test malformed metadata, bot-author checks, UTC deadlines, invalid settings and fixed deadlines after a configuration change.
- [ ] 2.2 Add a shared per-PR mutation controller used by setup and teardown; test overlapping setup/deletion, duplicate comment IDs, old run attempts, environment reuse and generation checks.
- [ ] 2.3 Make reconciliation recover skipped or superseded event deliveries from paginated GitHub and Railway reads; test more than 100 environments, missing state, pending-controller replacement and closure/reopen without replaying old commands.
- [ ] 2.4 Persist intent before provisioning and reconcile ambiguous create responses; test timeouts that still create an environment and prove retries do not create duplicates.

## 3. Add the PR comment command

- [ ] 3.1 Add a trusted-default-branch `issue_comment` handler for newly created standalone `/preview` comments; test ordinary issues, edited comments, bots, embedded commands and shell-injection strings.
- [ ] 3.2 Query current repository permissions and PR eligibility; test write/maintain/admin approval, reader denial, permission API failure, fork PRs, drafts and closed PRs with zero infrastructure mutations on rejection.
- [ ] 3.3 Resolve and pin the PR head and carry it through image build/reuse and deployment; test default-branch comment context, head movement before provisioning, merge-commit versus head images and mismatched image provenance.
- [ ] 3.4 Separate PR source checkout from privileged control code; verify with workflow tests that PR-controlled scripts cannot execute with Railway credentials and raw comment data never enters shell interpolation.
- [ ] 3.5 Implement manual startup and readiness-based expiry without renewal; test slow startup, failed readiness, duplicate events, repeated commands while active and new commands after expiry.
- [ ] 3.6 Route the existing preview comment through the controller; verify the displayed URL, full commit, UTC expiry, workflow link, disposable-data warning and actual cleanup outcome in rendered comment fixtures.

## 4. Integrate automatic cleanup

- [ ] 4.1 Add post-test and partial-setup cleanup without changing automatic path eligibility; test build failure, skipped deployment, mixed test results and diagnostics-upload failure while preserving the original test result.
- [ ] 4.2 Enforce bounded CI and startup use; test hanging jobs, workflow cancellation, manual use during CI, manual expiry before CI completion and CI completion before manual expiry.
- [ ] 4.3 Handle new revisions and PR closure/draft conversion; test that old tests terminate before replacement, manual holds are visibly superseded and old completion events cannot delete the new generation.
- [ ] 4.4 Run independent reconciliation every five minutes and retain the legacy-age fallback during migration; test scheduler delay, abandoned previews, malformed metadata and recovery after Railway errors.
- [ ] 4.5 Add protected-project/environment checks, exact-ID deletion and read-back verification; test production/template exclusions, unrelated environments, repeated deletion and failed or ambiguous deletion responses.

## 5. Validate and roll out

- [ ] 5.1 Run workflow validation, script linting, focused lifecycle tests and `git diff --check`; retain outputs and ensure no existing application-test coverage was silently removed.
- [ ] 5.2 With explicit approval, run the complete lifecycle on a disposable PR and Railway preview; verify authorized restart, exact revision, displayed expiry, automatic cleanup, cancellation recovery and retained-volume behavior through read-back evidence.
- [ ] 5.3 Document `/preview`, eligibility, timing limits, disposable data, failure reporting and the rollback sequence in the hosting runbook; verify examples against the tested workflow.
- [ ] 5.4 Enable creation and cleanup in the documented order, then compare observed preview-runtime and cleanup failures with the baseline; report residual storage and permanent-environment costs without promising an unmeasured bill reduction.
