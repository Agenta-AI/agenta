import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {expect} from "@agenta/web-tests/utils"
import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"
import {
    TestCoverage,
    TestcaseType,
    TestPath,
    TestScope,
    TestLensType,
    TestCostType,
    TestLicenseType,
    TestRoleType,
    TestSpeedType,
} from "@agenta/web-tests/playwright/config/testTags"
import {APIKey} from "@/oss/lib/Types"

const scenarios = createScenarios(test)

const tags = buildAcceptanceTags({
    scope: [TestScope.SETTINGS],
    coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
})

const apiKeysTests = () => {
    test("should allow full API key flow", {tag: tags}, async ({page, apiHelpers, uiHelpers}) => {
        let apiKeys: APIKey[] = []

        await scenarios.given("the user is authenticated", async () => {
            await expectAuthenticatedSession(page)
        })

        await scenarios.and("the user is on the Settings page", async () => {
            await page.goto("/settings")
        })

        await scenarios.when("the user creates a new API key", async () => {
            await uiHelpers.clickTab("API Keys")
            await uiHelpers.clickButton("Create New")
            await expect(page.locator(".ant-modal")).toBeVisible()

            const apiKeysPromise = apiHelpers.waitForApiResponse<APIKey[]>({
                route: "/api/keys",
                method: "GET",
            })

            await uiHelpers.confirmModal("Done")
            await expect(page.locator(".ant-modal")).not.toBeVisible()
            apiKeys = await apiKeysPromise
        })

        await scenarios.then("the fresh API keys list contains the created key", async () => {
            expect(apiKeys.length).toBeGreaterThan(0)
        })

        await scenarios.when("the user deletes the first API key from the list", async () => {
            await uiHelpers.clickTab("Usage & Billing")
            await uiHelpers.clickTab("API Keys")
            await uiHelpers.clickTableRowIcon({rowText: apiKeys[0].prefix, icon: "delete"})
            await expect(page.locator(".ant-modal")).toBeVisible()

            const apiKeyDeletePromise = apiHelpers.waitForApiResponse<{message: string}>({
                route: /\/api\/keys$/,
                method: "DELETE",
            })

            await uiHelpers.confirmModal("Yes")
            const apiKeyDeleteResponse = await apiKeyDeletePromise
            expect(apiKeyDeleteResponse?.message).toBe("API key deleted successfully")
        })

        await scenarios.then(
            "the delete confirmation closes and the user remains on Settings",
            async () => {
                await expect(page.locator(".ant-modal")).not.toBeVisible()
                await expect(page).toHaveURL(/settings(\?tab=.*)?/)
            },
        )
    })
}

export default apiKeysTests
