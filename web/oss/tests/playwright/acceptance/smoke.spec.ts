import {expect, test, type Page} from "@playwright/test"

import {expectAuthenticatedSession} from "./utils/auth"
import {createScenarios} from "./utils/scenarios"
import {buildAcceptanceTags} from "./utils/tags"
import {
    TestCoverage,
    TestCostType,
    TestLensType,
    TestLicenseType,
    TestPath,
    TestRoleType,
    TestScope,
    TestSpeedType,
    TestcaseType,
} from "@agenta/web-tests/playwright/config/testTags"

const scenarios = createScenarios(test)

const tags = buildAcceptanceTags({
    scope: [TestScope.AUTH],
    coverage: [TestCoverage.SMOKE],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const goToAppsPage = async (page: Page) => {
    await page.goto("/apps")
}

const expectWorkspaceScopedAppsPage = async (page: Page) => {
    await page.waitForURL("**/apps", {timeout: 5000})
    await expect(page).toHaveURL(/apps/)
}

const expectAppsUrl = async (page: Page) => {
    await expect(page).toHaveURL(/\/apps/)
}

test("smoke: auth works and can navigate to apps", {tag: tags}, async ({page}) => {
    test.setTimeout(10000)

    await scenarios.given("the user has valid credentials for the OSS deployment", async () => {
        await expectAuthenticatedSession(page)
    })

    await scenarios.when("the user navigates to the apps page", async () => {
        await goToAppsPage(page)
    })

    await scenarios.then("the user is redirected to the workspace-scoped apps page", async () => {
        await expectWorkspaceScopedAppsPage(page)
    })

    await scenarios.and('the page URL contains "/apps"', async () => {
        await expectAppsUrl(page)
    })
})
