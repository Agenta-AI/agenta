# Implementation tasks

Mahmoud approved the behavior specifications and simplification on 2026-09-22. Checkboxes below distinguish implemented/tested code from provider acceptance and post-merge rollout.

## 1. Approve and simplify

- [x] 1.1 Record approval of the command, eligibility and timing defaults in the proposal; verify the confirmed scope against the session request.
- [x] 1.2 Replace the proposed replay system with one controller, one bot-owned state record and a serialized mutation job; verify the simplified design preserves the behavior specifications.
- [x] 1.3 Validate the change with `openspec validate railway-preview-cost-controls --strict --no-interactive`; record format validation separately from runtime evidence.

## 2. Implement ownership and cleanup

- [x] 2.1 Add versioned state, validated duration settings and fixed deadlines; verify parsing, bot-author checks, malformed/duplicate records and configuration snapshots with offline tests.
- [x] 2.2 Share a per-PR mutation slot across setup, commands and deletion; verify stale generation and environment-ID checks, same-head reuse, manual requests during builds and finalizer-lock deadlock prevention with focused tests.
- [x] 2.3 Reconcile interrupted creation and deletion without a command replay queue; test partial creation, late creation, cancellation, failed deletion and paginated inventories. Unaccepted commands displaced by GitHub concurrency can be reposted.
- [x] 2.4 Preserve the six-hour legacy fallback without adopting an unmanaged preview during a new request; test that unknown active legacy contents are not overwritten or deleted by deployment.
- [x] 2.5 Integrate post-test cleanup and five-minute/completion-event reconciliation; inspect workflow conditions and test CI/manual overlap, deadline expiry, close/draft conversion, and protected resources.

## 3. Implement PR comments and exact revisions

- [x] 3.1 Accept only a newly created standalone human `/preview` comment; test quoted, embedded, edited, bot and ordinary-issue input.
- [x] 3.2 Check current write/maintain/admin permission before entering the mutation queue and again before mutation; verify permission failures cannot start infrastructure and unauthorized requests do not occupy the cleanup slot.
- [x] 3.3 Resolve the PR head explicitly and build unique revision/run/attempt image tags; test wrong/default/stale revisions and arbitrary tags, and inspect separation of trusted control code from the image source checkout.
- [x] 3.4 Implement readiness-based one-hour review, bounded startup and no renewal; test duplicate delivery, repeat commands, expiry/restart, late readiness and a shorter configured CI bound.
- [x] 3.5 Render URL, exact commit, UTC expiry, workflow link, disposable-data warning and honest cleanup state; verify comment fixtures and provider write read-back behavior.

## 4. Validate in the PR

- [x] 4.1 Run focused Python tests, Ruff, Actionlint and `git diff --check`; record commands and counts in validation.md. Workflow 50 runs the regression tests in the PR.
- [ ] 4.2 Run the opt-in real-provider acceptance workflow against the final code revision; verify a real authorized comment, real readiness, duplicate/stale events, accelerated expiry, immediate finalization and final environment absence. Attach the artifact and run URL.
- [x] 4.3 Update the hosting runbook with the command, timing limits, legacy behavior, failure reporting and rollback; compare instructions with the configured workflows.
- [ ] 4.4 Read back the PR's final revision and readiness state; publish exact-revision results without claiming unrelated web tests passed.

## 5. After merge

- [ ] 5.1 Verify one native `/preview` comment and the registered cleanup schedule on the default branch; record actual event delivery rather than counting pre-merge replay as event activation.
- [ ] 5.2 Compare preview runtime and cleanup failures with the pre-change baseline; inspect retained-volume billing separately and report measured savings, not an assumed percentage.
