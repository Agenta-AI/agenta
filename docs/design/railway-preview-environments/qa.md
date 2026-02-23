# QA Plan: Railway OSS and Preview Environments

## Objectives

1. Verify scripted OSS deployment works from zero state.
2. Verify repeatability (safe re-runs).
3. Verify preview environment lifecycle automation.

## Phase 1 QA (OSS Baseline)

### Provisioning Checks

- [ ] Project/environment/services created successfully.
- [ ] Gateway domain is generated and reachable.
- [ ] Required variables exist per service.

### Functional Checks

- [ ] `GET /` returns web app response.
- [ ] `GET /api/health` returns 200.
- [ ] `GET /services/health` returns 200.
- [ ] API, services, workers, cron show healthy deployments.

### Data Checks

- [ ] Required DBs are created (core/tracing/supertokens).
- [ ] Migrations complete without errors.
- [ ] Re-running migration step is idempotent.

### Re-run Checks

- [ ] Running bootstrap twice does not create inconsistent state.
- [ ] Configuration script updates drifted values predictably.

## Phase 2 QA (Hardening)

- [ ] CI workflow can deploy/update baseline without interactive prompts.
- [ ] Failures produce actionable logs and non-zero exit codes.
- [ ] Rollback helper restores service health.

## Phase 3 QA (Preview Environments)

### Lifecycle

- [ ] PR open creates preview environment.
- [ ] PR sync updates preview deployment.
- [ ] PR close deletes preview environment.

### Isolation

- [ ] Preview URL resolves correctly and is unique per PR.
- [ ] Preview env changes do not affect staging/production.

### Cleanup and Cost Control

- [ ] TTL cleanup removes stale preview environments.
- [ ] Failed cleanup jobs are visible in CI alerts.

## Exit Criteria

1. OSS deployment success rate >= 95% across repeated dry-run tests.
2. Preview lifecycle automation succeeds on representative PR test runs.
3. No manual Railway dashboard edits are required during normal operation.
