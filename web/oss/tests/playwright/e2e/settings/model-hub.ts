import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import type {StandardSecretDTO} from "@/oss/lib/Types"
import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

/**
 * E2E: Model Hub & API Keys Management
 *
 * Strictly follows Agenta E2E guidelines:
 *  - Uses base.fixture, type-safe API helpers, dynamic selectors
 *  - Robust assertions, URL state checks, and clear documentation
 *  - No hardcoded selectors; all are API/data-driven
 *  - Comments clarify any non-obvious logic
 *  - Assumes uiHelpers and apiHelpers are available from base fixture
 *
 * NOTE: Authentication is globally handled in Playwright config/globalSetup.
 * Info: Adding secret at the bigening of the all tests and then removing the secret in the end of all the tests
 */
const modelHubTests = () => {
    test(
        "should allow full add provider",
        {
            tag: [
                createTagString("scope", TestScope.SETTINGS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, apiHelpers, uiHelpers}) => {
            // 1. Navigate to settings and fetch provider data from API
            await page.goto("/settings")
            await uiHelpers.expectPath("/settings")

            // 2. Open Model Hub tab and assert table presence
            await page.locator(".ant-menu-item", {hasText: "Model Hub"}).click()

            // Fetch provider secrets directly from the canonical endpoint
            const secretsPromise = await apiHelpers.waitForApiResponse<StandardSecretDTO[]>({
                route: "/api/vault/v1/secrets/",
                method: "GET",
            })

            // Assert that the Model Providers table is visible, and that the 'OpenAI' row has a 'Configure now' button
            const providersTable = page.getByRole("table").filter({hasText: "OpenAI"})
            const openapiRow = providersTable.getByRole("row", {name: /OpenAI/})
            await expect(openapiRow).toBeVisible()

            const secrets = await secretsPromise

            // Find the Mistral provider secret by name (case-insensitive)
            const openaiSecret = secrets.find((s) =>
                s.header?.name?.toLowerCase().includes("openai"),
            )
            const providerName = openaiSecret?.header?.name ?? "OpenAI"
            const apiKey = (process.env.OPENAI_API_KEY as string) || "test-key"

            // 3. Configure OpenAI provider using dynamic selector
            const configurButton = await openapiRow.getByRole("button", {
                name: "Configure now",
            })

            const isConfigurButtonVisible = await configurButton.isVisible()

            if (isConfigurButtonVisible) {
                await uiHelpers.clickTableRowButton({
                    rowText: providerName,
                    buttonName: "Configure now",
                })
            } else {
                await openapiRow.getByRole("button").nth(1).click()
            }

            // The provider configuration uses an Ant Design Modal, not a Drawer
            await expect(page.locator(".ant-modal")).toBeVisible()
            const apiKeyInputFiled = await page.getByRole("textbox", {name: /Enter API key/i})
            await apiKeyInputFiled.fill("")
            await apiKeyInputFiled.fill(apiKey)

            // Fetch secrets again after configuration to verify creation
            const secretsAfterResponse = apiHelpers.waitForApiResponse<StandardSecretDTO[]>({
                route: "/api/vault/v1/secrets/",
                method: "GET",
            })
            await uiHelpers.clickButton("Confirm")
            await expect(page.locator(".ant-modal")).not.toBeVisible()

            const secretsAfter = await secretsAfterResponse
            const openapiSecretAfter = secretsAfter.find((s) =>
                s.header?.name?.toLowerCase().includes("openai"),
            )

            const secretName = openapiSecretAfter?.header?.name as string

            await expect(page.locator(".ant-table-row", {hasText: secretName})).toBeVisible()

            await uiHelpers.clickTableRowButton({
                rowText: secretName,
                buttonName: "Delete",
            })
            // expect(mistralSecretAfter).toBeDefined()
            // Assert modal is visible after clicking delete
            await expect(page.locator(".ant-modal")).toBeVisible()
            // Confirm the modal using the correct button text ("Yes" is default for AlertPopup)
            await uiHelpers.confirmModal("Delete")

            await apiHelpers.waitForApiResponse<StandardSecretDTO[]>({
                route: "/api/vault/v1/secrets/",
                method: "DELETE",
            })

            // Fetch secrets again after delete
            const secretsAfterDelete = await apiHelpers.waitForApiResponse<StandardSecretDTO[]>({
                route: "/api/vault/v1/secrets/",
                method: "GET",
            })

            const openapiSecretAfterDelete = secretsAfterDelete.find((s) =>
                s.header?.name?.toLowerCase().includes("openai"),
            )

            expect(openapiSecretAfterDelete).toBeUndefined()
        },
    )
}

export default modelHubTests
