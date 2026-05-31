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
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"

import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const scenarios = createScenarios(test)

const lightFastTags = buildAcceptanceTags({
    scope: [TestScope.DEPLOYMENT],
    coverage: [TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const lightSlowTags = buildAcceptanceTags({
    scope: [TestScope.DEPLOYMENT],
    coverage: [TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
})

/**
 * Deploys the first available variant to the development environment.
 * Based on the pattern in acceptance/deployment/index.ts.
 * Returns when the deploy modal closes (API confirmed 200).
 */
const deployFirstVariantToDevelopment = async (
    page: any,
    apiHelpers: any,
    uiHelpers: any,
    appId: string,
): Promise<void> => {
    const basePath = apiHelpers.getProjectScopedBasePath()

    await page.goto(
        `${basePath}/apps/${appId}/variants?tab=deployments&selectedEnvName=development`,
        {waitUntil: "domcontentloaded"},
    )
    await uiHelpers.expectPath(`/apps/${appId}/variants`)

    const deployButton = page.getByRole("button", {name: "Deploy"}).first()
    await expect(deployButton).toBeVisible({timeout: 15000})
    await deployButton.click()

    const modal = page.getByRole("dialog", {name: /Deploy Development/i}).last()
    await expect(modal).toBeVisible({timeout: 10000})

    const deployBtn = modal.getByRole("button", {name: "Deploy"})
    const realRow = modal.locator('[data-row-key]:not([data-row-key*="skeleton"])').first()
    await expect(realRow).toBeVisible({timeout: 30000})

    const radioSelector = '.ant-radio-wrapper, .ant-radio, [role="radio"], input[type="radio"]'
    await expect
        .poll(
            async () => {
                const radioControl = realRow.locator(radioSelector).first()
                if (await radioControl.isVisible().catch(() => false)) {
                    await radioControl.click({force: true}).catch(() => null)
                } else {
                    await realRow.click({force: true}).catch(() => null)
                }
                return await deployBtn.isEnabled().catch(() => false)
            },
            {timeout: 30000},
        )
        .toBe(true)

    const deployResponsePromise = page.waitForResponse(
        (response: any) =>
            response.url().includes("/environments/revisions/commit") &&
            response.request().method() === "POST",
    )
    await deployBtn.click()
    const deployResponse = await deployResponsePromise
    expect(deployResponse.ok()).toBe(true)

    await expect(page.getByRole("dialog", {name: /Deploy Development/i})).toHaveCount(0, {
        timeout: 45000,
    })
}

/**
 * Opens the "How to use API" drawer from the Variants tab.
 * Uses the data-tour attribute so we target exactly this button even if other
 * "Use API" buttons exist elsewhere in the page.
 * Waits for networkidle first so Jotai atoms are settled before the click.
 */
const openVariantUseApiDrawer = async (page: any) => {
    await page.waitForLoadState("networkidle")
    const useApiButton = page.locator('[data-tour="api-code-button"]')
    await expect(useApiButton).toBeVisible({timeout: 15000})
    await expect(useApiButton).toBeEnabled({timeout: 5000})
    await useApiButton.click()

    const drawer = page.locator(".ant-drawer-content-wrapper").filter({
        hasText: "How to use API",
    })
    await expect(drawer).toBeVisible({timeout: 20000})
    return drawer
}

/**
 * Opens the "How to use API" drawer from the Deployments tab.
 * Uses the generic primary "Use API" button (no data-tour on the deployments one).
 * Waits for networkidle first — DeploymentsDashboard is a dynamic() import whose
 * onClick setter may not be wired yet if clicked too early.
 */
const openDeploymentUseApiDrawer = async (page: any) => {
    await page.waitForLoadState("networkidle")
    const useApiButton = page.getByRole("button", {name: "Use API"}).first()
    await expect(useApiButton).toBeVisible({timeout: 15000})
    await expect(useApiButton).toBeEnabled({timeout: 5000})
    await useApiButton.click()

    const drawer = page.locator(".ant-drawer-content-wrapper").filter({
        hasText: "How to use API",
    })
    await expect(drawer).toBeVisible({timeout: 20000})
    return drawer
}

/**
 * Clicks the TypeScript tab inside the "How to use API" drawer and waits for
 * the tab to become active (aria-selected="true").
 */
const switchToTypescriptTab = async (drawer: any) => {
    const typescriptTab = drawer.getByRole("tab", {name: "TypeScript"})
    await expect(typescriptTab).toBeVisible({timeout: 10000})
    await typescriptTab.click()
    await expect(typescriptTab).toHaveAttribute("aria-selected", "true", {timeout: 5000})
}

const useApiTests = () => {
    // WEB-ACC-USEAPI-001
    test(
        "should show variant TypeScript snippet for Fetch Prompt/Config and Invoke LLM",
        {tag: lightFastTags},
        async ({page, apiHelpers, uiHelpers}) => {
            test.setTimeout(60000)
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("a completion app with at least one variant exists", async () => {
                const app = await apiHelpers.getApp("completion")
                appId = app.id
            })

            await scenarios.and("the user is on the Variants registry page", async () => {
                const basePath = apiHelpers.getProjectScopedBasePath()
                await page.goto(`${basePath}/apps/${appId}/variants`, {
                    waitUntil: "domcontentloaded",
                })
                await uiHelpers.expectPath(`/apps/${appId}/variants`)
                // Wait for the variants table radio controls to confirm the page has rendered
                await expect(
                    page.locator(".ant-radio-button-wrapper").filter({hasText: "Variants"}).first(),
                ).toBeVisible({timeout: 15000})
            })

            let useApiDrawer: any

            await scenarios.when("the user opens the Use API drawer", async () => {
                // data-tour="api-code-button" uniquely identifies the variants-tab "Use API"
                // button. networkidle ensures Jotai atoms are settled before the click.
                useApiDrawer = await openVariantUseApiDrawer(page)
            })

            await scenarios.and("the user selects the TypeScript tab", async () => {
                await switchToTypescriptTab(useApiDrawer)
            })

            await scenarios.then(
                "the Fetch Prompt/Config section displays the variant TypeScript snippet",
                async () => {
                    // Section heading
                    await expect(useApiDrawer.getByText("Fetch Prompt/Config")).toBeVisible({
                        timeout: 10000,
                    })
                    // Variant snippets use application_variant_ref (not environment_ref)
                    await expect(useApiDrawer).toContainText("application_variant_ref", {
                        timeout: 10000,
                    })
                },
            )

            await scenarios.and(
                "the Invoke LLM section displays a TypeScript axios snippet",
                async () => {
                    await expect(useApiDrawer.getByText("Invoke LLM")).toBeVisible({
                        timeout: 10000,
                    })
                    await expect(useApiDrawer).toContainText("axios.post", {timeout: 10000})
                },
            )
        },
    )

    // WEB-ACC-USEAPI-002
    test(
        "should show deployment TypeScript snippet for Fetch Prompt/Config and Invoke LLM",
        {tag: lightSlowTags},
        async ({page, apiHelpers, uiHelpers}) => {
            // Includes app creation + variant deployment + drawer interaction
            test.setTimeout(180000)
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and(
                "a fresh completion app exists with a variant deployed to Development",
                async () => {
                    const app = await apiHelpers.createApp("completion")
                    appId = app.id
                    await deployFirstVariantToDevelopment(page, apiHelpers, uiHelpers, appId)
                },
            )

            await scenarios.and(
                "the user is on the Deployments registry page for the Development environment",
                async () => {
                    const basePath = apiHelpers.getProjectScopedBasePath()
                    await page.goto(
                        `${basePath}/apps/${appId}/variants?tab=deployments&selectedEnvName=development`,
                        {waitUntil: "domcontentloaded"},
                    )
                    await uiHelpers.expectPath(`/apps/${appId}/variants`)
                    // Wait for the primary "Use API" button in the deployments tab header
                    await expect(page.getByRole("button", {name: "Use API"}).first()).toBeVisible({
                        timeout: 15000,
                    })
                },
            )

            let useApiDrawer: any

            await scenarios.when("the user opens the Use API drawer", async () => {
                useApiDrawer = await openDeploymentUseApiDrawer(page)
            })

            await scenarios.and("the user selects the TypeScript tab", async () => {
                await switchToTypescriptTab(useApiDrawer)
            })

            await scenarios.then(
                "the Fetch Prompt/Config section displays the deployment TypeScript snippet",
                async () => {
                    // Section heading
                    await expect(useApiDrawer.getByText("Fetch Prompt/Config")).toBeVisible({
                        timeout: 10000,
                    })
                    // Deployment snippets use environment_ref (not application_variant_ref)
                    await expect(useApiDrawer).toContainText("environment_ref", {timeout: 10000})
                },
            )

            await scenarios.and(
                "the Invoke LLM section displays a TypeScript axios snippet",
                async () => {
                    await expect(useApiDrawer.getByText("Invoke LLM")).toBeVisible({
                        timeout: 10000,
                    })
                    await expect(useApiDrawer).toContainText("axios.post", {timeout: 10000})
                },
            )
        },
    )
}

export default useApiTests
