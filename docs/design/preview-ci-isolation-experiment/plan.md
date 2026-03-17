# Plan

1. Update `.github/workflows/14-check-pr-preview.yml` so the PR preview workflow still builds, sets up, and deploys the Railway preview.
2. Remove the call to `.github/workflows/44-railway-tests.yml` from that workflow.
3. Replace it with a lightweight summary job noting that post-deploy preview tests are temporarily disabled for isolation.
4. Open a PR and use the resulting preview to verify whether the environment remains stable without CI traffic against it.
