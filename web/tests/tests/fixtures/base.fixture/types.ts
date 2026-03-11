import type {Page} from "@playwright/test"

import type {ApiHelpers} from "./apiHelpers/types"
import type {TestProviderHelpers} from "./providerHelpers/types"
import type {UIHelpers} from "./uiHelpers/types"

export interface BaseFixture {
    page: Page
    uiHelpers: UIHelpers
    apiHelpers: ApiHelpers
    testProviderHelpers: TestProviderHelpers
}

export interface FixtureContext {
    page: Page
}
