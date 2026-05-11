# QA Profile

## OSS Deployment Acceptance Suite

All tests run from `web/tests/` with `AGENTA_LICENSE=oss`.

### Full Suite (all 12 tests)

```bash
cd web/tests
AGENTA_LICENSE=oss \
AGENTA_WEB_URL="http://<deployment-url>" \
AGENTA_TEST_OSS_OWNER_EMAIL="<email>" \
AGENTA_TEST_OSS_OWNER_PASSWORD="<password>" \
node_modules/.bin/playwright test
```

Expected today:
- Settings mock-provider coverage should pass.
- Playground runtime tests are currently blocked by the custom-provider runtime credential issue.
- The full suite is not expected to be all green until that blocker and the remaining CI failures are fixed.

### Smoke Subset (fast gate)

```bash
node_modules/.bin/playwright test --grep "smoke"
```

Covers: auth, navigation, app creation, and one test from each domain tagged `@coverage:smoke`.

### By Domain

```bash
node_modules/.bin/playwright test --grep "Playground"
node_modules/.bin/playwright test --grep "deploy"
node_modules/.bin/playwright test --grep "observability"
node_modules/.bin/playwright test --grep "prompt"
node_modules/.bin/playwright test --grep "Model Hub"
node_modules/.bin/playwright test --grep "testset"
```

## Environment Contract

Required env vars:
- `AGENTA_LICENSE=oss`
- `AGENTA_WEB_URL=<deployed-oss-url>`
- `AGENTA_TEST_OSS_OWNER_EMAIL=<email>` (for password auth flow)
- `AGENTA_TEST_OSS_OWNER_PASSWORD=<password>` (for password auth flow)

Operational rule:
- Always use the current deployment URL from the active PR checks. Do not reuse an older preview URL. Preview deployments can expire after about one day of inactivity, and failures against an expired preview are not valid test results.

Optional:
- Auth mode is inferred from the rendered frontend flow.
- `TESTMAIL_API_KEY` + `TESTMAIL_NAMESPACE` (required for OTP auth flow)

## Test Coverage Map

| Domain | Tests | Scenarios |
|---|---|---|
| Smoke | 1 | Auth + navigate to apps |
| App creation | 2 | Create completion app, create chat app |
| Playground | 3 | Run completion, run chat, update prompt & save |
| Deployment | 1 | Deploy variant to development |
| Observability | 1 | View traces + open drawer |
| Prompt registry | 1 | Browse registry + open details |
| Settings | 1 (+1 skipped) | View model providers (API keys skipped) |
| Testsets | 1 (conditional) | View testset details (skips if none exist) |

## Acceptance Criteria

1. Full suite reporting must match reality. Do not describe the branch as "10 pass, 2 skip" while deployment, observability, and API key coverage are hard-skipped.
   - Latest observed CI run on this branch: `5 passed`, `4 skipped`, `1 failed`, `2 flaky`.
2. Failures are actionable (clear error source, not flaky).
3. Full suite runs in under 5 minutes.
4. No test depends on data from a previous test run (except observability, which needs prior playground traces).
5. Local verification is run serially. Two Playwright invocations in parallel are not a valid result while `global-setup` still shares project bookkeeping.
