# Web Acceptance RTM

## Scope

This RTM covers the **existing OSS web acceptance tests only**. It is the left side of the
acceptance matrix discussed in the testing meeting:

- The RTM entry is the intent.
- The `.feature` file is the readable scenario description.
- The Playwright test implementation is the executable automation.
- The Playwright HTML report is the evidence side for each test title.

This phase does **not** add new acceptance scenarios. It only restructures the current suite so
that existing coverage is easier to read, maintain, and reuse.

## Refactor Workflow

1. Start from an existing Playwright test that already exists in the suite.
2. Write or update the RTM entry for that exact scenario.
3. Align the corresponding `.feature` file so the scenario text matches the implemented coverage.
4. Refactor the Playwright test into explicit `Given` / `When` / `Then` steps.
5. Make each step call a reusable helper or a clearly isolated action/assertion block.
6. Use the Playwright HTML report for run evidence, keyed by the exact test title below.

## Evidence Rule

For every RTM entry below:

- `Feature file` is the human-readable scenario source.
- `Test file` is the implementation source.
- `Playwright title` is the evidence key used in the HTML report.

## Test Cases

### WEB-ACC-AUTH-001 - Authenticate and navigate to apps

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/smoke.feature`
- Test file: `web/oss/tests/playwright/acceptance/smoke.spec.ts`
- Playwright title: `smoke: auth works and can navigate to apps`

#### Markers

- Scope: `auth`
- Coverage: `smoke`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

#### Scenarios

- Given the user has valid credentials for the OSS deployment
- When the user navigates to the apps page
- Then the user is redirected to the workspace-scoped apps page
- And the page URL contains `/apps`

### WEB-ACC-APP-001 - Create a completion prompt app

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/app-creation.feature`
- Test file: `web/oss/tests/playwright/acceptance/app/index.ts`
- Playwright title: `creates new completion prompt app`

#### Markers

- Scope: `apps`, `playground`, `evaluations`, `deployment`, `observability`
- Coverage: `smoke`, `light`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

#### Scenarios

- Given the user is authenticated
- And the user is on the Prompts page
- When the user creates a `Completion Prompt` app with a unique name
- Then the new completion prompt app is visible after creation

### WEB-ACC-APP-002 - Create a chat prompt app

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/app-creation.feature`
- Test file: `web/oss/tests/playwright/acceptance/app/index.ts`
- Playwright title: `creates new chat prompt app`

#### Markers

- Scope: `apps`, `playground`, `evaluations`, `deployment`, `observability`
- Coverage: `smoke`, `light`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

#### Scenarios

- Given the user is authenticated
- And the user is on the Prompts page
- When the user creates a `Chat Prompt` app with a unique name
- Then the new chat prompt app is visible after creation

### WEB-ACC-PLAYGROUND-001 - Run a completion variant in Playground

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/playground.feature`
- Test file: `web/oss/tests/playwright/acceptance/playground/index.ts`
- Playwright title: `Should run single view variant for completion`

#### Markers

- Scope: `playground`, `observability`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

#### Scenarios

- Given the user is authenticated
- And the active project has a configured test provider
- And the user is on the playground for a completion app
- When the user runs the completion variant with test inputs
- Then the completion variant run succeeds without UI errors

### WEB-ACC-PLAYGROUND-002 - Run a chat variant in Playground

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/playground.feature`
- Test file: `web/oss/tests/playwright/acceptance/playground/index.ts`
- Playwright title: `Should run single view variant for chat`

#### Markers

- Scope: `playground`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

#### Scenarios

- Given the user is authenticated
- And the active project has a configured test provider
- And the user is on the playground for a chat app
- When the user runs the chat variant with test inputs
- Then the chat variant run succeeds without UI errors

### WEB-ACC-PLAYGROUND-003 - Update a prompt and save a new version

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/playground.feature`
- Test file: `web/oss/tests/playwright/acceptance/playground/index.ts`
- Playwright title: `Should update the prompt and save the changes`

#### Markers

- Scope: `playground`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

#### Scenarios

- Given the user is authenticated
- And the user is on the playground for a completion app
- When the user adds new prompt messages
- And the user changes the template variable keys
- And the user commits the changes `As a new version`
- Then the prompt changes are saved successfully

### WEB-ACC-REGISTRY-001 - Open Playground from the workflow revision registry

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/prompt-registry.feature`
- Test file: `web/oss/tests/playwright/acceptance/prompt-registry/index.ts`
- Playwright title: `should open prompt details from prompt registry`

#### Markers

- Scope: `playground`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

#### Scenarios

- Given the user is authenticated
- And at least one completion app exists
- And the user is on the workflow revisions page for that app
- When the user opens the first published workflow revision
- And the workflow revision drawer is visible
- And the user opens Playground from that drawer
- Then the Playground opens for the selected revision

### WEB-ACC-SETTINGS-001 - Ensure the mock custom provider exists

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/settings.feature`
- Test file: `web/oss/tests/playwright/acceptance/settings/model-hub.ts`
- Playwright title: `should allow full add provider`

#### Markers

- Scope: `settings`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

#### Scenarios

- Given the user is authenticated
- When the project scoped mock test provider is configured
- Then the `Custom providers` table lists `mock`

### WEB-ACC-SETTINGS-002 - Create and delete an API key

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/settings.feature`
- Test file: `web/oss/tests/playwright/acceptance/settings/api-keys.ts`
- Playwright title: `should allow full API key flow`

#### Markers

- Scope: `settings`
- Coverage: `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: implemented, currently wrapped by a skipped spec

#### Scenarios

- Given the user is authenticated
- And the user is on the Settings page
- When the user creates a new API key
- Then the fresh API keys list contains the created key
- When the user deletes the first API key from the list
- Then the delete confirmation closes and the user remains on Settings

### WEB-ACC-DATASETS-001 - View the default testset and its details

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/testsets.feature`
- Test file: `web/oss/tests/playwright/acceptance/testsset/index.ts`
- Playwright title: `should view the default testset`

#### Markers

- Scope: `datasets`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active with conditional skip when no testsets exist

#### Scenarios

- Given the user is authenticated
- And the user navigates to the Test Sets page via the sidebar
- When the page loads the default testset list
- Then the test is skipped if no testsets exist
- And the default testset detail page is visible with test cases

### WEB-ACC-DEPLOYMENT-001 - Deploy a variant to the Development environment

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/deployment.feature`
- Test file: `web/oss/tests/playwright/acceptance/deployment/index.ts`
- Playwright title: `deploy a variant`

#### Markers

- Scope: `deployment`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: implemented, currently skipped pending deterministic bootstrap data

#### Scenarios

- Given the user is authenticated
- And a completion app with at least one variant exists
- And the user is on the app overview page
- When the user opens the Development deployment flow
- Then the environment cards for `Development`, `Staging`, and `Production` are visible
- And the deployment flow completes without leaving the overview context

### WEB-ACC-OBS-001 - Open a trace detail drawer from Observability

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/observability.feature`
- Test file: `web/oss/tests/playwright/acceptance/observability/index.ts`
- Playwright title: `view traces`

#### Markers

- Scope: `observability`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: implemented, currently skipped pending deterministic trace generation

#### Scenarios

- Given the user is authenticated
- And the user is on the Observability page
- When the user opens the traces table
- Then the trace detail drawer opens
