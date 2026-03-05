# QA Profile

## OSS-against-Deployment Smoke Subset

Primary goal: fast signal that auth/session/app navigation works on deployed OSS.

### Tier A (Required Gate)

- Test: `web/oss/tests/playwright/acceptance/smoke.spec.ts`
- Grep: `smoke: auth works and can navigate to apps`

Command:

```bash
AGENTA_LICENSE=oss \
AGENTA_WEB_URL="http://<deployment-url>" \
corepack pnpm -C web/tests test:acceptance -- \
  --grep "smoke: auth works and can navigate to apps" \
  --max-failures=1 --workers=1 --retries=1
```

### Tier B (Canary, optional initially)

- File: `web/oss/tests/playwright/acceptance/app/create.spec.ts`
- Grep: `creates new completion prompt app`

Command:

```bash
AGENTA_LICENSE=oss \
AGENTA_WEB_URL="http://<deployment-url>" \
corepack pnpm -C web/tests test:acceptance -- \
  web/oss/tests/playwright/acceptance/app/create.spec.ts \
  --grep "creates new completion prompt app" \
  --max-failures=1 --workers=1 --retries=1
```

## Environment Contract

- Required:
  - `AGENTA_LICENSE=oss`
  - `AGENTA_WEB_URL=<deployed-oss-url>`
- Auth flow depends on deployment mode:
  - Password flow: provide OSS owner email/password env vars.
  - OTP flow: provide Testmail namespace/key env vars.

## Acceptance Criteria

1. Tier A passes consistently in deployment pipeline.
2. Failures are actionable (clear setup/test error source).
3. Runtime is short enough for gating use.
