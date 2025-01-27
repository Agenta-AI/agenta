import { test } from "./helpers/test";
import {
  TestScope,
  TestCoverage,
  TestPath,
  TestFeatureScope,
  createTagString,
} from "../../../playwright/config/testTags";
import { AppType } from "./types";

const tags = [
  createTagString("scope", TestScope.APPS),
  createTagString("coverage", TestCoverage.SMOKE),
  createTagString("path", TestPath.HAPPY),
  createTagString("feature-scope", TestFeatureScope.COMMON),
].join(" ");

// Tags can now be added directly to the describe block title
test.describeWithAuth(`App Creation Flow ${tags} @requiresAuth`, () => {
  test("creates new completion prompt app", async ({
    navigateToApps,
    createNewApp,
    verifyAppCreation,
  }) => {
    await navigateToApps();

    const appName = `test-app-${Date.now()}`;
    await createNewApp(appName, AppType.COMPLETION_PROMPT);

    // Verify creation
    await verifyAppCreation(appName);
  });

  test("creates new chat prompt app", async ({
    navigateToApps,
    createNewApp,
    verifyAppCreation,
  }) => {
    await navigateToApps();

    const appName = `test-app-${Date.now()}`;
    await createNewApp(appName, AppType.CHAT_PROMPT);

    // Verify creation
    await verifyAppCreation(appName);
  });
});
