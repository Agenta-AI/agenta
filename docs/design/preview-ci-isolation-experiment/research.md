# Research

## Current Wiring

- `.github/workflows/14-check-pr-preview.yml` builds, sets up, deploys, and then invokes `.github/workflows/44-railway-tests.yml`.
- `.github/workflows/44-railway-tests.yml` runs `wait-for-readiness`, auth bootstrap, and API/SDK/services/web integration and acceptance tests against the deployed preview.

## Relevant Observations

- The preview workflow is the only new CI path in `#4016` that touches the live Railway preview after deployment.
- Unit and lint coverage live in separate workflows and do not depend on the deployed preview.
- An experiment that stops invoking `44-railway-tests.yml` from the PR preview workflow isolates the deployment from post-deploy CI traffic while preserving build/deploy visibility.

## Chosen Experiment

Keep the original post-deploy test invocation in `.github/workflows/14-check-pr-preview.yml`, but disable it with `if: false` and add a separate informational job that explains preview tests are temporarily disabled for isolation. This makes the experiment easy to revert by removing the leading `false &&` from the original `tests` job.
