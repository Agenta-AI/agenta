# Railway Preview Bootstrap Recovery Plan

## Expected Behavior

Bootstrap creates the Railway services required by an OSS pull request preview.
It must print `Bootstrap completed` only when Railway lists all 13 required
services. If any service is absent, bootstrap must fail and identify it.

If configure later receives a missing-service error, it must explain that the
user needs to re-run all jobs. That starts bootstrap again. Re-running only
failed deploy jobs does not.

## Bootstrap Service Reconciliation

1. Define the 13 required service names in `bootstrap.sh`.
2. Read the linked environment through `railway status --json`.
3. Before creating a service, skip it when Railway already lists it.
4. For a missing service, call the existing `railway add` command.
5. Keep an add failure in the job log. Do not retry it automatically.
6. After all create attempts, poll Railway status for a bounded number of
   checks.
7. Continue only when every required service appears. Otherwise exit nonzero
   and list the missing services.
8. Create persistent volumes only after that verification succeeds.

The final status check handles two outcomes of a failed add command. Railway
may have rejected the request, or it may have created the service before the
client timed out. The service list distinguishes those outcomes without a
duplicate creation request.

## Configure Recovery Message

When a Railway CLI variable update reports that a service is not found,
`configure.sh` keeps its nonzero exit status and prints a recovery message.
The message tells users to re-run all jobs, not only the failed deploy job.

## Code Changes

| File | Change |
| --- | --- |
| `hosting/railway/oss/scripts/bootstrap.sh` | Add service-list helpers, create only missing services, and verify all services before volume setup and success output. |
| `hosting/railway/oss/scripts/configure.sh` | Add missing-service recovery guidance and permit test code to source the script without invoking `main`. |
| `hosting/railway/oss/scripts/tests/test_preview_bootstrap.sh` | Mock the Railway CLI and test the service reconciliation behavior. |
| `.github/workflows/39-railway-script-tests.yml` | Run the focused script test on pull requests that change Railway scripts. |

## Validation Plan

- Run the mock test with all services already present. It must not issue an add
  command.
- Run the mock test with `cron` absent and its add command failing. Bootstrap
  must fail without printing success.
- Run the mock test with `cron` absent and a failed add command that still
  creates `cron`. Bootstrap must succeed after final verification.
- Run a configure test that returns `Service 'cron' not found`. The output must
  tell the user to re-run all jobs.
- Run Bash syntax checks and `git diff --check`.
- Run the repository's Railway preview workflow after a maintainer or the CI
  environment supplies its Railway credentials.
