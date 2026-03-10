import {test as playwright} from "@playwright/test"

import {apiHelpers} from "./apiHelpers"
import {testProviderHelpers} from "./providerHelpers"
import type {BaseFixture} from "./types"
import {uiHelpers} from "./uiHelpers"

const _test = playwright.extend<BaseFixture>({
    apiHelpers: apiHelpers(),
    uiHelpers: uiHelpers(),
    testProviderHelpers: testProviderHelpers(),
})

export {_test as test}
