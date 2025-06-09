import type {Page} from "@playwright/test"

import type {ApiHelpers} from "./apiHelpers/types"
import type {UIHelpers} from "./uiHelpers/types"

export interface BaseFixture {
    page: Page
    uiHelpers: UIHelpers
    apiHelpers: ApiHelpers
}

export interface FixtureContext {
    page: Page
}
