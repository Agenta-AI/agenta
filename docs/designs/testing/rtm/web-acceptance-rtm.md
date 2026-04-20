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

### WEB-ACC-APP-003 - Delete an app

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/app-management.feature`
- Test file: `web/oss/tests/playwright/acceptance/app/app-management.spec.ts`
- Playwright title: `App Management > should delete an app`

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

### WEB-ACC-APP-004 - Rename an app

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/app-management.feature`
- Test file: `web/oss/tests/playwright/acceptance/app/app-management.spec.ts`
- Playwright title: `App Management > should rename an app`

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

### WEB-ACC-APP-005 - App overview page renders correctly

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/app-management.feature`
- Test file: `web/oss/tests/playwright/acceptance/app/app-management.spec.ts`
- Playwright title: `App Management > should render the app overview page with environment cards and variant list`

#### Markers

- Scope: `apps`
- Coverage: `light`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

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

### WEB-ACC-DATASETS-002 - Create a testset from scratch

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/testsets.feature`
- Test file: `web/oss/tests/playwright/acceptance/testsset/testset-management.spec.ts`
- Playwright title: `Test Sets > should create a new testset from scratch`

#### Markers

- Scope: `datasets`
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

### WEB-ACC-DATASETS-003 - Upload a testset from CSV

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/testsets.feature`
- Test file: `web/oss/tests/playwright/acceptance/testsset/testset-management.spec.ts`
- Playwright title: `Test Sets > should upload a testset from CSV`

#### Markers

- Scope: `datasets`
- Coverage: `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

### WEB-ACC-DATASETS-004 - Edit a testcase inline and verify the change persists

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/testsets.feature`
- Test file: `web/oss/tests/playwright/acceptance/testsset/testset-management.spec.ts`
- Playwright title: `Test Sets > should edit a testcase inline and persist the change`

#### Markers

- Scope: `datasets`
- Coverage: `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

### WEB-ACC-DATASETS-005 - Add and delete rows and columns in a testset

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/testsets.feature`
- Test file: `web/oss/tests/playwright/acceptance/testsset/testset-management.spec.ts`
- Playwright title: `Test Sets > should add and delete rows and columns`

#### Markers

- Scope: `datasets`
- Coverage: `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active

### WEB-ACC-DATASETS-006 - Delete a testset

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/testsets.feature`
- Test file: `web/oss/tests/playwright/acceptance/testsset/testset-management.spec.ts`
- Playwright title: `Test Sets > should delete a testset`

#### Markers

- Scope: `datasets`
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

### WEB-ACC-EVALUATORS-001 - Navigate to the Evaluators page and verify both tabs

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/evaluators.feature`
- Test file: `web/oss/tests/playwright/acceptance/evaluators/index.ts`
- Playwright title: `Evaluators > should navigate to the evaluators page and display both automatic and human evaluator tabs`

#### Markers

- Scope: `evaluations`
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

### WEB-ACC-EVALUATORS-002 - Create an Exact Match evaluator from the template dropdown

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/evaluators.feature`
- Test file: `web/oss/tests/playwright/acceptance/evaluators/index.ts`
- Playwright title: `Evaluators > should create an Exact Match evaluator from the template dropdown`

#### Markers

- Scope: `evaluations`
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

### WEB-ACC-EVALUATORS-003 - Open evaluator playground, select a completion app, and run

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/evaluators.feature`
- Test file: `web/oss/tests/playwright/acceptance/evaluators/index.ts`
- Playwright title: `Evaluators > should open the evaluator playground, select a completion app, and run the evaluator`

#### Markers

- Scope: `evaluations`
- Coverage: `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `oss`
- Status: active with conditional skip when no apps or no completion app exists

### WEB-ACC-EVALUATORS-004 - Create a human evaluator with a boolean feedback metric

#### Source

- Feature file: `web/oss/tests/playwright/acceptance/features/evaluators.feature`
- Test file: `web/oss/tests/playwright/acceptance/evaluators/index.ts`
- Playwright title: `Evaluators > should create a human evaluator with a boolean feedback metric`

#### Markers

- Scope: `evaluations`
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

### WEB-ACC-AUTOEVAL-001 - Run a single auto evaluation

#### Source

- Feature file: `web/ee/tests/playwright/acceptance/auto-evaluation/auto-evaluation.feature`
- Test file: `web/ee/tests/playwright/acceptance/auto-evaluation/index.ts`
- Playwright title: `Auto Evaluation: Run evaluation > should run a single evaluation`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `ee`
- Status: active

### WEB-ACC-AUTOEVAL-002 - Show error when creating auto evaluation with mismatched testset

#### Source

- Feature file: `web/ee/tests/playwright/acceptance/auto-evaluation/auto-evaluation.feature`
- Test file: `web/ee/tests/playwright/acceptance/auto-evaluation/index.ts`
- Playwright title: `Auto Evaluation: Run evaluation > should show an error when attempting to create an evaluation with a mismatched testset`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `ee`
- Status: active

### WEB-ACC-HUMAN-001 - Human evaluation entry point on the human tab

#### Source

- Feature file: `web/ee/tests/playwright/acceptance/human-annotation/human-annotation.feature`
- Test file: `web/ee/tests/playwright/acceptance/human-annotation/index.ts`
- Playwright title: `Human Annotation > should show the human evaluation entry point on the human tab`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `ee`
- Status: active

### WEB-ACC-HUMAN-002 - Mismatched testset when configuring a human evaluation

#### Source

- Feature file: `web/ee/tests/playwright/acceptance/human-annotation/human-annotation.feature`
- Test file: `web/ee/tests/playwright/acceptance/human-annotation/index.ts`
- Playwright title: `Human Annotation > should use a deliberately mismatched testset when configuring a human evaluation`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `fast`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `ee`
- Status: active

### WEB-ACC-HUMAN-003 - Create a human evaluation and land on the results page

#### Source

- Feature file: `web/ee/tests/playwright/acceptance/human-annotation/human-annotation.feature`
- Test file: `web/ee/tests/playwright/acceptance/human-annotation/index.ts`
- Playwright title: `Human Annotation > should create a human evaluation and land on the results page`

#### Markers

- Scope: `evaluations`
- Coverage: `smoke`, `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `ee`
- Status: active

### WEB-ACC-HUMAN-004 - Create evaluator inline and annotate a scenario from the Annotate tab

#### Source

- Feature file: `web/ee/tests/playwright/acceptance/human-annotation/human-annotation.feature`
- Test file: `web/ee/tests/playwright/acceptance/human-annotation/index.ts`
- Playwright title: `Human Annotation > should create a new evaluator inline and annotate a scenario from the annotate tab`

#### Markers

- Scope: `evaluations`
- Coverage: `light`, `full`
- Path: `happy`
- Case: `typical`
- Lens: `functional`
- Speed: `slow`
- Cost: `free`
- Role: `owner`
- Plan: environment-defined
- License: `ee`
- Status: active

