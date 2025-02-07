import { test as baseTest } from "../base.fixture";
import { TestType } from "@playwright/test";
import type { TestFixtures, WorkerFixtures, WorkerStateMap } from "./types";
import {
  createInitialUserState,
  requiresAuthentication,
} from "./authHelpers/utilities";
import { authHelpers } from "./authHelpers";

// Define base custom test type - now extending our base fixture test type
export interface CustomTestType<T = {}>
  extends TestType<TestFixtures & T, WorkerFixtures> {
  describeWithAuth: (title: string, callback: () => void) => void;
}

// Create a function to extend test with auth describe
export function createAuthTest<T>(test: TestType<any, any>): CustomTestType<T> {
  const authTest = test as CustomTestType<T>;

  // Add describeWithAuth method
  authTest.describeWithAuth = (groupTitle: string, callback: () => void) => {
    return test.describe(groupTitle, () => {
      // Track group-level email to reuse across tests
      let groupEmail: string | null = null;

      test.beforeEach(async ({ user, workerState }, testInfo) => {
        // Store email for reuse within group
        if (!groupEmail) {
          groupEmail = user.email;
        } else {
          // Reuse email but force re-authentication
          user.email = groupEmail;
          workerState.email = groupEmail;
          workerState.isAuthenticated = false;
        }

        const currentTest = testInfo.title;
        const fullTitle = `${groupTitle} › ${currentTest}`;
        const tags = extractTags(fullTitle);

        console.log(`Test starting: ${fullTitle}
          Email: ${user.email}
          Environment: ${user.environment}
          Auth Status: ${
            user.isAuthenticated ? "Authenticated" : "Not Authenticated"
          }
          Auth Required: ${requiresAuthentication(
            workerState.environment,
            tags
          )}
        `);
      });

      test.afterEach(async ({ workerState }) => {
        // Reset authentication state after each test
        workerState.isAuthenticated = false;
      });

      test.afterAll(async () => {
        console.log(`Completed test group: ${groupTitle}`);
        // Clear group email
        groupEmail = null;
      });

      callback();
    });
  };

  return authTest;
}

// State management
const workerStates: WorkerStateMap = new Map();

// Create base test with fixtures - now extending our base fixture
const baseTestWithFixtures = baseTest.extend<TestFixtures, WorkerFixtures>({
  authHelpers: authHelpers(),

  workerState: [
    async ({}, use, workerInfo) => {
      const workerId = workerInfo.workerIndex;
      if (!workerStates.has(workerId)) {
        workerStates.set(workerId, createInitialUserState(workerInfo));
      }
      await use(workerStates.get(workerId)!);
    },
    { scope: "worker" },
  ],

  user: async ({ workerState, authHelpers }, use, testInfo) => {
    // Use testInfo.titlePath which includes all titles in the test hierarchy
    const fullTitle = testInfo.titlePath.join(" ");
    const tags = extractTags(fullTitle);
    workerState.requiresAuth = requiresAuthentication(
      workerState.environment,
      tags
    );

    if (workerState.requiresAuth && !workerState.isAuthenticated) {
      await authHelpers.loginWithEmail(workerState.email);
      workerState.isAuthenticated = true;
    } else if (!workerState.requiresAuth) {
      await authHelpers.completeLLMKeysCheck();
    }
    await use(workerState);
  },
});

// Export the enhanced test object
export const test = createAuthTest(baseTestWithFixtures);

function extractTags(title: string): string[] {
  const tagMatch = title.match(/@[\w-]+:[^\s@]+/g);
  return tagMatch ? tagMatch.map((tag) => tag.substring(1)) : [];
}

export * from "./types";
export { requiresAuthentication } from "./authHelpers/utilities";
