import {test as playwright} from "@playwright/test"

import {apiHelpers} from "./apiHelpers"
import type {BaseFixture} from "./types"
import {uiHelpers} from "./uiHelpers"

const _test = playwright.extend<BaseFixture>({
    apiHelpers: apiHelpers(),
    uiHelpers: uiHelpers(),
})

export {_test as test}
