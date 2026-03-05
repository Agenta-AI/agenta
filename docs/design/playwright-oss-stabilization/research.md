# Research

## Current Architecture

- Runner: `web/tests/playwright/scripts/run-tests.ts`
- Config: `web/tests/playwright.config.ts`
- Global auth setup: `web/tests/playwright/global-setup.ts`
- Global teardown: `web/tests/playwright/global-teardown.ts`
- Shared fixtures: `web/tests/tests/fixtures/*`
- OSS acceptance specs: `web/oss/tests/playwright/acceptance/*`
- EE acceptance specs: `web/ee/tests/playwright/acceptance/*`

## How Targeting Works

`playwright.config.ts` sets `testDir` dynamically using `AGENTA_LICENSE`:

- `AGENTA_LICENSE=oss` -> `web/oss/tests/playwright/acceptance`
- `AGENTA_LICENSE=ee` -> `web/ee/tests/playwright/acceptance`

## Suite Inventory (Frontend)

OSS acceptance domains:

- smoke
- app
- playground
- prompt-registry
- deployment
- observability
- settings (model-hub, api-keys)
- testset (folder currently named `testsset`)

EE acceptance domains:

- app, playground, prompt-registry, deployment, observability, settings, testset
- EE-native: auto-evaluation, human-annotation

## Key Findings

1. EE wrappers import OSS references via `@agenta/oss/tests/playwright/...` paths that appear brittle and need normalization.
2. Runner documentation includes options that do not match current runner parsing behavior.
3. Auth setup depends on UI branch detection and can flake under overlay/pointer interception.
4. Some tests use random values and first-entity assumptions, increasing nondeterminism.
5. Teardown can attempt destructive cleanup in OSS contexts and should be explicitly gated.
6. Tag usage is inconsistent across suites, limiting reliable filtered runs.

## Baseline Verified

Against deployed OSS URL, smoke auth test can pass with:

`AGENTA_LICENSE=oss AGENTA_WEB_URL=<deployment-url> corepack pnpm -C web/tests test:acceptance -- --grep "smoke: auth works and can navigate to apps" --max-failures=1`
