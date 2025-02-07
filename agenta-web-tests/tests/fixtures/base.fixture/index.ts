import { test as playwright, expect } from "@playwright/test";
import { uiHelpers } from "./uiHelpers";
import { apiHelpers } from "./apiHelpers";
import type { BaseFixture } from "./types";

const test = playwright.extend<BaseFixture>({
  uiHelpers: uiHelpers(),
  apiHelpers: apiHelpers(),
});

export { test, expect };
