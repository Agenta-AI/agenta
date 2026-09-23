# Bounded Railway preview lifecycle

## Purpose

Reduce unnecessary Railway runtime by retaining PR preview environments only while bounded CI work or an explicit manual preview needs them.

## ADDED Requirements

### Requirement: Create infrastructure only for eligible deployment work

Automatic previews SHALL retain the existing relevant-path and non-draft PR eligibility rules. Railway infrastructure MUST NOT be created before the required images are available. A build failure or a change that needs no preview MUST NOT create an environment.

#### Scenario: Images fail to build

- **WHEN** a required image build fails
- **THEN** no Railway preview is created for that request.

#### Scenario: Documentation-only change

- **WHEN** a PR changes only files outside the configured preview paths
- **THEN** automatic preview infrastructure is not created.

### Requirement: Release automatic previews after dependent work terminates

The system SHALL attempt cleanup after every test job that uses the preview terminates, regardless of pass, failure or skip. Setup and deployment failures SHALL also trigger cleanup of any partial environment. Diagnostics collection SHALL be bounded so its own failure cannot retain infrastructure indefinitely. Cleanup SHALL not change a failed test result into success. An independent reconciliation process SHALL cover interrupted or cancelled workflows whose final cleanup did not execute.

#### Scenario: Tests pass

- **WHEN** all dependent tests complete successfully and no manual preview hold remains
- **THEN** the system preserves available test artifacts, deletes the preview and verifies deletion.

#### Scenario: One test fails while another is running

- **WHEN** one dependent test fails and another still uses the preview within its allowed runtime
- **THEN** cleanup waits for the remaining dependent test rather than deleting infrastructure underneath it.

#### Scenario: Setup partially fails

- **WHEN** setup creates an environment but readiness never succeeds
- **THEN** the partial environment is subject to immediate failure cleanup and independent bounded reconciliation.

#### Scenario: Workflow is cancelled

- **WHEN** the workflow is cancelled before its final cleanup completes
- **THEN** independent reconciliation identifies and cleans up the abandoned preview unless another valid use still owns it.

### Requirement: Bound manual startup and review time separately

A manual preview SHALL receive 60 minutes of review time from successful readiness by default. Startup SHALL have a separate 30-minute limit measured from the start of infrastructure provisioning. A repeated command MUST NOT reset either deadline. Maintainers SHALL configure these defaults outside PR comment content. A failed startup SHALL not receive review time.

#### Scenario: Normal manual preview

- **WHEN** infrastructure provisioning starts at 12:00 UTC and readiness succeeds at 12:10 UTC
- **THEN** the manual expiry is 13:10 UTC, and the published expiry does not include build time before provisioning.

#### Scenario: Startup stalls

- **WHEN** provisioning begins at 12:00 UTC and readiness has not succeeded by the default 12:30 UTC deadline
- **THEN** the request is failed and cleanup becomes due without granting another hour.

### Requirement: Bound automatic runtime independently of test success

An automatic preview SHALL have a configurable maximum lifetime, defaulting to 120 minutes from infrastructure creation. Active tests MUST NOT extend that deadline indefinitely. When the limit is reached, the system SHALL terminate dependent work and report a timeout before cleanup. This limit is a failure bound, not a promise to keep successful previews alive until it expires.

#### Scenario: Hung test

- **WHEN** a dependent test remains active at the automatic lifetime deadline
- **THEN** the run is reported as timed out and its automatic use of the preview ends.

#### Scenario: Fast tests

- **WHEN** dependent tests finish well before the maximum lifetime
- **THEN** automatic use ends immediately rather than waiting for the maximum lifetime.

### Requirement: Keep automatic and manual ownership distinct

The system SHALL distinguish a CI run's use from a manual review hold. A matching ready preview can satisfy both. Completing CI MUST NOT delete an unexpired manual preview. Manual expiry MUST NOT delete an environment still needed by a valid bounded CI run. Manual access after expiry SHALL not be promised merely because CI still needs the environment. No two different revisions SHALL be tested as if they owned the same deployed contents.

#### Scenario: Request while CI is using the same revision

- **WHEN** an authorized request targets the same revision as an active CI preview
- **THEN** the system reuses the environment, starts manual review time when readiness is established and preserves it through that manual deadline even if CI finishes earlier.

#### Scenario: Manual time ends before tests

- **WHEN** manual review time expires while the same environment has active bounded CI work
- **THEN** the manual hold ends and the environment remains only until the CI use ends or reaches its own deadline.

#### Scenario: A different revision needs the shared preview

- **WHEN** a new CI run targets a newer revision while an older run or manual review owns the preview
- **THEN** the old CI work is cancelled and any old manual hold is explicitly marked superseded before replacing the deployed contents; the new revision receives no automatic manual renewal.

### Requirement: Make cleanup safe against replacement and overlapping events

Every lifecycle operation SHALL identify the exact environment and owning request generation, meaning one particular creation or deployment cycle. Before deletion, the system MUST re-read current ownership and deadlines. A delayed completion event from an old run MUST NOT delete or alter a newer generation. Setup, renewal checks and deletion SHALL coordinate per PR so their mutations cannot race.

#### Scenario: Old run completes late

- **WHEN** run A reports completion after run B has replaced its preview
- **THEN** cleanup for A cannot delete B's environment or overwrite B's displayed status.

#### Scenario: Expiry races with a new request

- **WHEN** a cleanup operation and a restart arrive together
- **THEN** one ordered transition completes and the other re-evaluates the current generation before mutating it.

### Requirement: Reconcile expiry without promising an exact timer

An independent cleanup sweep SHALL be scheduled every five minutes by default. It SHALL process due expiries, terminal runs with missed cleanup, startup failures and abandoned legacy previews. Expired resources SHALL be deleted on the next successful reconciliation. GitHub scheduling or Railway outages can delay deletion; the system MUST report that limit and expose overdue cleanup instead of claiming an exact one-hour or monetary cap.

#### Scenario: Sweep arrives after expiry

- **WHEN** a manual deadline is 13:10 UTC and the next successful sweep starts at 13:14 UTC
- **THEN** the environment is eligible for deletion at 13:14 UTC and the recorded stop time reflects actual verified deletion.

#### Scenario: Cleanup service is unavailable

- **WHEN** a scheduled run is delayed or Railway rejects the deletion
- **THEN** the expiry remains unchanged, the failure is visible in workflow status, and the next sweep retries safely.

### Requirement: Protect permanent resources and verify deletion

Cleanup MUST target only positively identified PR preview environments in the configured preview project. Production, the template and unrelated environments MUST remain protected. Deletion SHALL cover the complete preview environment rather than only its web service. The system SHALL verify absence, account for provider-retained preview storage, and report residual charges or resources without automatically deleting unrelated data. PR closure or conversion to draft SHALL end both automatic and manual use and initiate cleanup.

#### Scenario: PR closes during manual review

- **WHEN** a PR closes with manual time remaining
- **THEN** remaining work is cancelled, the manual hold ends and the preview is deleted without waiting for its expiry.

#### Scenario: Repeated cleanup

- **WHEN** the exact preview environment is already absent
- **THEN** cleanup succeeds idempotently without deleting another environment.

#### Scenario: Protected or ambiguous environment

- **WHEN** an operation resolves production, the shared template or an environment whose ownership cannot be established
- **THEN** deletion is refused and the operation reports the unresolved condition.

#### Scenario: Storage remains after deletion

- **WHEN** Railway reports retained preview storage after environment deletion
- **THEN** the cleanup report identifies it and does not claim that all associated billing has ended.
