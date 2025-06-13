import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"
import {APIKey} from "@/oss/lib/Types"

const apiKeysTests = () => {
    test(
        "should allow full API key flow",
        {
            tag: [
                createTagString("scope", TestScope.SETTINGS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, apiHelpers, uiHelpers}) => {
            // 1. Navigate to settings and fetch provider data from API
            await page.goto("/settings")

            // 2. API Keys tab: create new key
            await uiHelpers.clickTab("API Keys")

            await uiHelpers.clickButton("Create New")

            await expect(page.locator(".ant-modal")).toBeVisible()

            // Per UTILITIES_AND_FIXTURES_GUIDE: Initiate waitForApiResponse BEFORE the UI action triggers the API call
            const apiKeysPromise = apiHelpers.waitForApiResponse<APIKey[]>({
                route: "/api/keys",
                method: "GET",
            })

            // Assert drawer is visible after clicking Create New
            await uiHelpers.confirmModal("Done")

            await expect(page.locator(".ant-modal")).not.toBeVisible()

            const apiKeys = await apiKeysPromise
            expect(apiKeys.length).toBeGreaterThan(0)

            // 3. Usage & Billing tab
            await uiHelpers.clickTab("Usage & Billing")

            await uiHelpers.clickTab("API Keys")

            // Click the delete icon for the first API key row
            await uiHelpers.clickTableRowIcon({rowText: apiKeys[0].prefix, icon: "delete"})
            // Assert drawer is visible for edit (if implemented as a drawer)
            await expect(page.locator(".ant-modal")).toBeVisible()
            const apiKeyDeletePromise = apiHelpers.waitForApiResponse<{message: string}>({
                route: new RegExp(`/api/keys`),
                method: "DELETE",
            })
            await uiHelpers.confirmModal("Yes")
            const apiKeyDeleteResponse = await apiKeyDeletePromise

            expect(apiKeyDeleteResponse?.message).toBe("API key deleted successfully")
            await expect(page.locator(".ant-modal")).not.toBeVisible()

            await expect(page).toHaveURL(/settings(\?tab=.*)?/)
        },
    )
}

export default apiKeysTests
