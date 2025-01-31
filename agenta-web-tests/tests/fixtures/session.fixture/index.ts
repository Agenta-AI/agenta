import { test as baseTest } from "../base.fixture";
import { chromium, type BrowserContext, TestType } from "@playwright/test";
import type {
  SessionState,
  SessionFixtures,
  SessionWorkerFixtures,
} from "./types";

// State management at worker level
const workerState: SessionState = {
  isAuthenticated: false,
};

export interface SessionTestType<T = {}>
  extends TestType<SessionFixtures & T, SessionWorkerFixtures> {
  describeWithSession: (title: string, callback: () => void) => void;
}

export function createSessionTest<T = {}>(
  test: TestType<any, any>
): SessionTestType<T> {
  const sessionTest = test.extend<SessionFixtures, SessionWorkerFixtures>({
    sessionState: [
      async ({}, use) => {
        await use(workerState);
      },
      { scope: "worker" },
    ],

    useSharedContext: [false, { option: true }],

    session: async ({ sessionState, useSharedContext }, use, testInfo) => {
      let context: BrowserContext;
      const browser = await chromium.launch();

      if (useSharedContext && sessionState.context) {
        // Create new context with stored state
        context = await browser.newContext({
          storageState: await sessionState.context.storageState(),
        });
      } else {
        // Create fresh context
        context = await browser.newContext();
      }

      const newSession = { ...sessionState, context };
      await use(newSession);

      if (useSharedContext) {
        // Store state for next test
        sessionState.context = context;
        sessionState.isAuthenticated = newSession.isAuthenticated;
      }

      await context.close();
      await browser.close();
    },
  });

  (sessionTest as SessionTestType<T>).describeWithSession = (
    title: string,
    callback: () => void
  ) => {
    return sessionTest.describe(title, () => {
      sessionTest.use({ useSharedContext: true });

      sessionTest.beforeAll(async ({ session }) => {
        console.log(`Starting session for: ${title}`);
      });

      sessionTest.afterAll(async () => {
        console.log(`Ending session for: ${title}`);
      });

      callback();
    });
  };

  return sessionTest as SessionTestType<T>;
}

export const test = createSessionTest(baseTest);
