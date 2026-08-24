import {
    TestCostType,
    TestCoverage,
    TestLensType,
    TestLicenseType,
    TestPath,
    TestRoleType,
    TestScope,
    TestSpeedType,
    TestcaseType,
} from "@agenta/web-tests/playwright/config/testTags"
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"

import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const scenarios = createScenarios(test)

// WP30's in-process local provider covers the client/service integration. A browser
// necessarily needs a reachable test authorization server, which the dev deployment
// advertises explicitly. The test is active whenever that capability is configured.
const oauthServerUrl = process.env.AGENTA_MCP_OAUTH_ACCEPTANCE_SERVER_URL
const stepUpScope = process.env.AGENTA_MCP_OAUTH_ACCEPTANCE_STEP_UP_SCOPE

const createTags = (license: TestLicenseType) =>
    buildAcceptanceTags({
        scope: [TestScope.SETTINGS],
        coverage: [TestCoverage.FULL],
        path: TestPath.HAPPY,
        lens: TestLensType.FUNCTIONAL,
        cost: TestCostType.Free,
        license,
        role: TestRoleType.Owner,
        caseType: TestcaseType.TYPICAL,
        speed: TestSpeedType.SLOW,
    })

export const mcpOAuthAcceptanceTests = (license: TestLicenseType) => {
    const tags = createTags(license)

    test(
        "connects, displays ready, and reconnects for MCP OAuth scope step-up",
        {tag: tags},
        async ({page, apiHelpers, uiHelpers}) => {
            test.skip(
                !oauthServerUrl || !stepUpScope,
                "requires the deployed WP30 browser OAuth provider capability",
            )

            const endpointName = `OAuth MCP ${Date.now()}`

            await scenarios.given("the user is authenticated on MCP server settings", async () => {
                await expectAuthenticatedSession(page)
                await page.goto(
                    `${apiHelpers.getProjectScopedBasePath()}/settings?tab=mcpEndpoints`,
                    {
                        waitUntil: "domcontentloaded",
                    },
                )
                await uiHelpers.expectPath("/settings")
                await expect(page.getByText("MCP Servers", {exact: true})).toBeVisible()
            })

            await scenarios.when("the user registers an OAuth MCP endpoint", async () => {
                await page.getByRole("button", {name: "Register server"}).click()
                const drawer = page.getByRole("dialog").last()
                await drawer.getByPlaceholder("e.g. Acme Notion").fill(endpointName)
                await drawer.getByPlaceholder("e.g. acme-notion").fill(`oauth-mcp-${Date.now()}`)
                await drawer.getByPlaceholder("https://mcp.example.com").fill(oauthServerUrl!)
                await drawer.getByRole("combobox").click()
                await page.getByText("OAuth", {exact: true}).last().click()
                await drawer.getByRole("button", {name: "Register"}).click()
                await expect(drawer).not.toBeVisible()
            })

            const row = page.locator("[data-row-key]").filter({hasText: endpointName}).first()
            await expect(row).toBeVisible({timeout: 15000})

            await scenarios.when("the user completes initial MCP OAuth consent", async () => {
                await row.locator("button").last().click()
                await page.getByRole("menuitem", {name: "Connect / reconnect"}).click()
                const consent = page.getByRole("dialog").last()
                await expect(consent.getByText("Choose which permissions to grant.")).toBeVisible()

                const popupPromise = page.waitForEvent("popup")
                await consent.getByRole("button", {name: "Connect"}).click()
                const popup = await popupPromise
                await expect(popup.getByText("The MCP server is connected.")).toBeVisible({
                    timeout: 15000,
                })
                await expect(popup).toHaveURL(/\/gateways\/mcps\/connect\/callback/)
            })

            await scenarios.then("the callback refreshes the row into ready state", async () => {
                await expect(row.getByText("Ready", {exact: true})).toBeVisible({timeout: 15000})
            })

            await scenarios.when(
                "the user reconnects to request the advertised step-up scope",
                async () => {
                    await row.locator("button").last().click()
                    await page.getByRole("menuitem", {name: "Connect / reconnect"}).click()
                    const consent = page.getByRole("dialog").last()
                    await expect(consent.getByText(stepUpScope!, {exact: true})).toBeVisible()
                    const popupPromise = page.waitForEvent("popup")
                    await consent.getByRole("button", {name: "Connect"}).click()
                    const popup = await popupPromise
                    await expect(popup.getByText("The MCP server is connected.")).toBeVisible({
                        timeout: 15000,
                    })
                },
            )

            await scenarios.then("the endpoint remains ready after scope step-up", async () => {
                await expect(row.getByText("Ready", {exact: true})).toBeVisible({timeout: 15000})
            })
        },
    )
}
