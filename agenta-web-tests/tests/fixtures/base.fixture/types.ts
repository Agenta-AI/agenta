import type { Page } from "@playwright/test";
import type { UIHelpers } from "./uiHelpers/types";
import type { ApiHelpers } from "./apiHelpers/types";

export interface BaseFixture {
  page: Page;
  uiHelpers: UIHelpers;
  apiHelpers: ApiHelpers;
}

export type FixtureContext = { page: Page };
