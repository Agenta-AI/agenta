# Web Acceptance RTM

> **Source of truth**: This RTM file is the authoritative record for all web acceptance tests.
> If there is a discrepancy between what is stated here and any `.feature` or `.spec` file,
> **this RTM takes priority**. Discrepancies must be corrected by updating the `.feature` or
> `.spec` file to match. If the correct resolution is not obvious, an agent must ask a human
> before modifying any file.

## Scope

This RTM covers the **existing OSS and EE web acceptance tests**. It is the left side of the
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

### WEB-ACC-PROMPTS-001 - Navigate to the Prompts page

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/prompts.feature`
- Test file: `web/oss/tests/playwright/acceptance/prompts/index.ts`
- Playwright title: `OSS Prompts Flow > navigates to the Prompts page and displays it`

#### Markers

- Scope: `apps`
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
- When the user navigates to the Prompts page
- Then the Prompts page is displayed with the Create new button

### WEB-ACC-PROMPTS-002 - Create a new prompt via the Create new dropdown

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/prompts.feature`
- Test file: `web/oss/tests/playwright/acceptance/prompts/index.ts`
- Playwright title: `OSS Prompts Flow > creates a new prompt via the Create new dropdown`

#### Markers

- Scope: `apps`
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
- When the user clicks Create new, selects New prompt, and fills in the form
- Then the new prompt modal was opened and submitted successfully

### WEB-ACC-PROMPTS-003 - Create a new folder via the Create new dropdown

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/prompts.feature`
- Test file: `web/oss/tests/playwright/acceptance/prompts/index.ts`
- Playwright title: `OSS Prompts Flow > creates a new folder via the Create new dropdown`

#### Markers

- Scope: `apps`
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
- When the user clicks Create new, selects New folder, and enters a folder name
- Then the new folder is created and visible in the prompts table

### WEB-ACC-EVALUATORS-001 - Navigate to the Evaluators page and verify both tabs

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/evaluators.feature` (not yet created)
- Test file: `web/oss/tests/playwright/acceptance/evaluators/index.ts`
- Playwright title: `Evaluators > should navigate to the evaluators page and display both automatic and human evaluator tabs`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: not set
- Status: active

#### Scenarios

- Given the user is authenticated
- When the user navigates to the Evaluators page
- Then the Automatic Evaluators tab is visible and selected by default
- And the Human Evaluators tab is visible but not selected
- And the Create new button is visible on both tabs
- When the user switches between tabs
- Then the active tab and URL parameter update correctly

### WEB-ACC-EVALUATORS-002 - Create an Exact Match evaluator from the template dropdown

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/evaluators.feature` (not yet created)
- Test file: `web/oss/tests/playwright/acceptance/evaluators/index.ts`
- Playwright title: `Evaluators > should create an Exact Match evaluator from the template dropdown`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: not set
- Status: active

#### Scenarios

- Given the user is authenticated
- And the user is on the Evaluators page
- When the user opens the template dropdown and selects Exact Match
- Then the New Evaluator drawer opens
- When the user clicks Create, enters a name, and submits the commit modal
- Then the evaluator creation succeeds and the new evaluator appears in the table

### WEB-ACC-EVALUATORS-003 - Open evaluator playground, select a completion app, and run

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/evaluators.feature` (not yet created)
- Test file: `web/oss/tests/playwright/acceptance/evaluators/index.ts`
- Playwright title: `Evaluators > should open the evaluator playground, select a completion app, and run the evaluator`

#### Markers

- Scope: `evaluations`
- Coverage: `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: not set
- Status: active with conditional skip when no apps or no completion app exists

#### Scenarios

- Given the user is authenticated
- And the user is on the Evaluators page
- When the user creates a fresh Exact Match evaluator
- And the user opens the evaluator view drawer and expands it to playground mode
- And the user selects a completion-type app and its first revision
- And the user fills in the testcase fields
- When the user clicks Run
- Then the evaluator result card appears

### WEB-ACC-EVALUATORS-004 - Create a human evaluator with a boolean feedback metric

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/evaluators.feature` (not yet created)
- Test file: `web/oss/tests/playwright/acceptance/evaluators/index.ts`
- Playwright title: `Evaluators > should create a human evaluator with a boolean feedback metric`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: not set
- Status: active

#### Scenarios

- Given the user is authenticated
- And the user is on the Evaluators page on the Human Evaluators tab
- When the user clicks Create new, fills in the evaluator name, feedback name, and selects Boolean type
- Then the evaluator creation succeeds and the new human evaluator appears in the table

### WEB-ACC-AUTOEVAL-001 - Run a single auto evaluation

#### Source

- Feature file: not yet created
- Test file: `web/ee/tests/playwright/acceptance/auto-evaluation/index.ts`
- Playwright title: `Auto Evaluation: Run evaluation > should run a single evaluation`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: `ee`
- Status: active

#### Scenarios

- Given the user is authenticated
- And a completion app and at least one variant exist
- And the user navigates to the auto evaluations page for that app
- When the user creates a testset and runs an auto evaluation with Exact Match
- Then the modal closes and the user is navigated to the evaluation results page
- And the URL contains the auto evaluation results path

### WEB-ACC-AUTOEVAL-002 - Show error when creating auto evaluation with mismatched testset

#### Source

- Feature file: not yet created
- Test file: `web/ee/tests/playwright/acceptance/auto-evaluation/index.ts`
- Playwright title: `Auto Evaluation: Run evaluation > should show an error when attempting to create an evaluation with a mismatched testset`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: `ee`
- Status: active

#### Scenarios

- Given the user is authenticated
- And a chat app with at least one variant exists
- And the user navigates to the auto evaluations page for that app
- When the user opens the New Auto Evaluation modal and selects a testset with mismatched columns
- Then the expected input variables note is shown and does not contain the mismatched column name
- And the modal allows proceeding with the mismatched testset selected

### WEB-ACC-HUMAN-001 - Human evaluation entry point on the human tab

#### Source

- Feature file: not yet created
- Test file: `web/ee/tests/playwright/acceptance/human-annotation/index.ts`
- Playwright title: `Human Annotation > should show the human evaluation entry point on the human tab`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: `ee`
- Status: active

#### Scenarios

- Given the user is authenticated
- And a completion app exists
- When the user navigates to the human evaluations tab for that app
- Then the human evaluation entry point is displayed

### WEB-ACC-HUMAN-002 - Mismatched testset when configuring a human evaluation

#### Source

- Feature file: not yet created
- Test file: `web/ee/tests/playwright/acceptance/human-annotation/index.ts`
- Playwright title: `Human Annotation > should use a deliberately mismatched testset when configuring a human evaluation`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: `ee`
- Status: active

#### Scenarios

- Given the user is authenticated
- And a chat app with at least one variant exists
- When the user opens the New Human Evaluation modal and selects a testset with mismatched columns
- Then the expected input variables note is shown and does not contain the mismatched column name
- And the modal allows proceeding with the mismatched testset selected

### WEB-ACC-HUMAN-003 - Create a human evaluation and land on the results page

#### Source

- Feature file: not yet created
- Test file: `web/ee/tests/playwright/acceptance/human-annotation/index.ts`
- Playwright title: `Human Annotation > should create a human evaluation and land on the results page`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: `ee`
- Status: active

#### Scenarios

- Given the user is authenticated
- And a completion app with at least one variant exists
- When the user creates a testset and runs a human evaluation
- Then the modal closes and the user is navigated to the human evaluation results page
- And the Annotate tab is selected with the inputs, outputs, and annotations sections visible

### WEB-ACC-HUMAN-004 - Create evaluator inline and annotate a scenario from the Annotate tab

#### Source

- Feature file: not yet created
- Test file: `web/ee/tests/playwright/acceptance/human-annotation/index.ts`
- Playwright title: `Human Annotation > should create a new evaluator inline and annotate a scenario from the annotate tab`

#### Markers

- Scope: `evaluations`
- Coverage: `light`, `full`
- Path: `happy`
- Case: not set
- Lens: not set
- Speed: not set
- Cost: not set
- Role: not set
- Plan: environment-defined
- License: `ee`
- Status: active

#### Scenarios

- Given the user is authenticated
- And a completion app with at least one variant exists
- When the user creates a human evaluation run with an inline evaluator metric
- Then the user is navigated to the human evaluation results page
- And the user annotates the current scenario with a boolean metric value
- Then the annotation is submitted successfully
