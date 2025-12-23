---
description: Multi-step, robust E2E test generation for Agenta Cloud
---

# Agenta Multi-step E2E Test Generation Workflow

This workflow guides you through generating maintainable, robust E2E tests for Agenta Cloud, leveraging codegen output, component analysis, and best practices for fixtures and utilities.

**Reference:**
- [E2E Test Generation Guide](../web/tests/guides/E2E_TEST_GENERATION_GUIDE.md)
- [Utilities & Fixtures Guide](../web/tests/guides/UTILITIES_AND_FIXTURES_GUIDE.md)
- [E2E Test Organization Guide](../web/tests/guides/E2E_TEST_ORGANIZATION_GUIDE.md)

---

## Step 1. Start with an analysis of a playwright codegen output.

- ask user for input as text or a file path.
- refer to the E2E Test Generation guide on what Cascase should be doing in this analysis.
---

## Step 2: Map to Actual Components
- Cascade will:
  - Map each URL and action to the corresponding React components (and their children) in the codebase.
  - Analyze how these components are constructed, what data they use, and any server mutations (API calls, forms, etc.).
  - Note component behavior, what they render, and how they might behave differently under various conditions.
- This step builds a reference list of relevant components and their data flows.
- create an intermediate reference document which can be used by Cascade itself in the next steps. This document can also be structured to be a useful tool for developers to improve documentation of each tested flow.


> Cascade will now analyze the codebase to find all components and server interactions related to your flow. It will summarize its findings for your review.

---

## Step 3: Propose Name / Description / Purpose
- Cascade proposes a name, description, and purpose for the new E2E test, based on the previous analysis.
- User can edit/correct these before proceeding.
- The final name/description will be used for folder/file names and documentation.
- once you got the information you need, you need to check if the folder exists, and create one if needed, in order to prevent failing file creation attempts.
- **Folder/file naming and structure must follow the [E2E Test Organization Guide](../web/tests/guides/E2E_TEST_ORGANIZATION_GUIDE.md).**
- **All new E2E tests must be placed in the appropriate product/package feature folder (e.g., `web/ee/tests/app/`, `web/oss/tests/app/`).**
- **Organize by feature or flow using subfolders (e.g., `app/`, `prompt-registry/`).**
- **Share test logic via imports when possible (e.g., EE tests can import from OSS).**
- **Never place feature/product test specs in `web/tests/`—that folder is for shared fixtures, utilities, and guides only.**


> Proposed test name, description, and purpose:
> - Name: `<suggested>`
> - Description: `<suggested>`
> - Purpose: `<suggested>`
>
> Edit or approve these before continuing. If the proposed folder/file structure introduces a new pattern, update the Organization Guide.

---

## Step 4: Scaffolding
- Cascade creates the folder and files for the new E2E test using the agreed naming, and following the guidance found in "E2E_TEST_ORGANIZATION_GUIDE".
- when scaffolding, cascade should start using our base fixtures found in "Utilities & Fixtures Guide" and remove and unnecessary steps from testing, such as authentication, however Cascade should make sure all user action after the authentication must be preserved in the refactored tests.
- Cascade should make sure the file and test syntax is correct after the implementation of the initial new setup before proceeding to the next step.


> Cascade will scaffold the necessary folders and files for your new E2E test. Confirm or adjust the structure if needed. If this introduces a new organization pattern, update the Organization Guide.

---

## Step 5: Initial Implementation
- Cascade generates the initial implementation of the E2E test:
  - Cascade should preserve all user actions in its final implementation in correct order.
  - Leverages fixtures and utilities from `web/tests` ([see guide](../web/tests/guides/UTILITIES_AND_FIXTURES_GUIDE.md))
  - Uses selector approach based on dynamic content read from api calls, as described in the guides.
  - Uses it's knowledge on actual components from step 2 to find all necessary api calls.
  - Documents assumptions and code clearly
  - Ensures all import paths use the correct aliases (checked via `tsconfig.json` and `next.config.js`)
- Cascade will explain its design and any assumptions it made.
- **Before writing custom helpers, always check if a suitable fixture/utility already exists.**


> Cascade will now generate the initial E2E test implementation, following best practices and referencing the Utilities & Fixtures Guide. Review the code and documentation, and provide feedback if needed.

---

## Step 6: Refactor for Reuse & DRYness
- Cascade compares the new implementation with existing tests to identify duplication.
- If common patterns/utilities are found, Cascade extracts them into shared fixtures/utilities in `web/tests` and updates both new and existing tests.
- **Whenever a new fixture/utility is added or updated, update the [Utilities & Fixtures Guide](../web/tests/guides/UTILITIES_AND_FIXTURES_GUIDE.md) and this workflow.**
- Cascade documents new/updated utilities for team awareness.


> Cascade will now scan for duplication with existing tests, extract common fixtures/utilities, and update the codebase and documentation. Review the proposed changes and documentation.

---

## Workflow Complete
- Your E2E test is now robust, maintainable, and leverages the best practices and shared utilities of Agenta Cloud.
- For advanced troubleshooting, see [E2E Test Generation Guide](../web/tests/guides/E2E_TEST_GENERATION_GUIDE.md) and [Utilities & Fixtures Guide](../web/tests/guides/UTILITIES_AND_FIXTURES_GUIDE.md).

---

*This workflow is maintained in `.windsurf/workflows/generate-e2e-test-multistep.md` and can be improved by anyone on the team. Whenever you update or add a fixture/utility, update this workflow and the Utilities & Fixtures Guide as well.*
