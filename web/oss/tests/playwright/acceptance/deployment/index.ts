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

const smokeTags = buildAcceptanceTags({
    scope: [TestScope.DEPLOYMENT],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
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
 * Deploys the first available variant to the given environment via the UI.
 * Navigates to the deployment tab, opens the deploy dialog, selects a row,
 * confirms, and waits for the API response.
 */
const deployVariantToEnv = async (
    page: any,
    apiHelpers: any,
    uiHelpers: any,
    appId: string,
    envName: string,
): Promise<void> => {
    const basePath = apiHelpers.getProjectScopedBasePath()
    const capitalizedEnv = envName.charAt(0).toUpperCase() + envName.slice(1)

    await page.goto(
        `${basePath}/apps/${appId}/variants?tab=deployments&selectedEnvName=${envName}`,
        {waitUntil: "domcontentloaded"},
    )
    await uiHelpers.expectPath(`/apps/${appId}/variants`)

    const deployButton = page.getByRole("button", {name: "Deploy"}).first()
    await expect(deployButton).toBeVisible({timeout: 15000})
    await deployButton.click()

    const modal = page
        .getByRole("dialog", {name: new RegExp(`Deploy ${capitalizedEnv}`, "i")})
        .last()
    await expect(modal).toBeVisible({timeout: 10000})

    const rows = modal.locator("[data-row-key]")
    const deployBtn = modal.getByRole("button", {name: "Deploy"})
    const radioSelector = '.ant-radio-wrapper, .ant-radio, [role="radio"], input[type="radio"]'

    await expect(rows.first()).toBeVisible({timeout: 15000})
    await expect
        .poll(
            async () => {
                const rowCount = await rows.count()

                for (let index = 0; index < rowCount; index += 1) {
                    const row = rows.nth(index)
                    await row.scrollIntoViewIfNeeded().catch(() => null)

                    const radioControl = row.locator(radioSelector).first()
                    if (await radioControl.isVisible().catch(() => false)) {
                        await radioControl.click({force: true}).catch(() => null)
                    } else {
                        await row.click({force: true}).catch(() => null)
                    }

                    if (await deployBtn.isEnabled().catch(() => false)) {
                        return true
                    }
                }

                return false
            },
            {timeout: 30000},
        )
        .toBe(true)

    const deployResponsePromise = page.waitForResponse((response: any) => {
        return (
            response.url().includes("/environments/revisions/commit") &&
            response.request().method() === "POST"
        )
    })

    await expect(deployBtn).toBeEnabled({timeout: 30000})
    await deployBtn.click()
    const deployResponse = await deployResponsePromise
    expect(deployResponse.ok()).toBe(true)

    await expect(
        page.getByRole("dialog", {name: new RegExp(`Deploy ${capitalizedEnv}`, "i")}),
    ).toHaveCount(0, {timeout: 45000})
}

const deploymentTests = () => {
    // WEB-ACC-DEPLOYMENT-001
    test("deploy a variant", {tag: smokeTags}, async ({page, apiHelpers, uiHelpers}) => {
        test.setTimeout(120000)
        let appId = ""

        await scenarios.given("the user is authenticated", async () => {
            await expectAuthenticatedSession(page)
        })

        await scenarios.and("a fresh completion app with at least one variant exists", async () => {
            const app = await apiHelpers.createApp("completion")
            appId = app.id
        })

        await scenarios.and("the user is on the app overview page", async () => {
            await page.goto(`${apiHelpers.getProjectScopedBasePath()}/apps/${appId}/overview`, {
                waitUntil: "domcontentloaded",
            })
            await uiHelpers.expectPath(`/apps/${appId}/overview`)
            const deploymentHeading = page.getByRole("heading", {name: "Deployment"})
            await deploymentHeading.scrollIntoViewIfNeeded()
            await expect(deploymentHeading).toBeVisible({timeout: 10000})
        })

        await scenarios.then("the three environment cards are visible", async () => {
            for (const envName of ["Development", "Staging", "Production"]) {
                await expect(page.getByText(envName, {exact: true}).first()).toBeVisible()
            }
        })

        await scenarios.when("the user opens the Development deployment flow", async () => {
            await page.goto(
                `${apiHelpers.getProjectScopedBasePath()}/apps/${appId}/variants?tab=deployments&selectedEnvName=development`,
                {waitUntil: "domcontentloaded"},
            )
            await uiHelpers.expectPath(`/apps/${appId}/variants`)
        })

        await scenarios.and("the user opens the deploy dialog", async () => {
            const deployButton = page.getByRole("button", {name: "Deploy"}).first()
            await expect(deployButton).toBeVisible({timeout: 15000})
            await deployButton.click()
        })

        await scenarios.and("the user selects a variant to deploy to Development", async () => {
            const modal = page.getByRole("dialog", {name: /Deploy Development/i}).last()
            await expect(modal).toBeVisible({timeout: 10000})

            const rows = modal.locator("[data-row-key]")
            const deployBtn = modal.getByRole("button", {name: "Deploy"})
            const radioSelector =
                '.ant-radio-wrapper, .ant-radio, [role="radio"], input[type="radio"]'

            await expect(rows.first()).toBeVisible({timeout: 15000})
            await expect
                .poll(
                    async () => {
                        const rowCount = await rows.count()

                        for (let index = 0; index < rowCount; index += 1) {
                            const row = rows.nth(index)
                            await row.scrollIntoViewIfNeeded().catch(() => null)

                            const radioControl = row.locator(radioSelector).first()
                            if (await radioControl.isVisible().catch(() => false)) {
                                await radioControl.click({force: true}).catch(() => null)
                            } else {
                                await row.click({force: true}).catch(() => null)
                            }

                            if (await deployBtn.isEnabled().catch(() => false)) {
                                return true
                            }
                        }

                        return false
                    },
                    {timeout: 30000},
                )
                .toBe(true)
        })

        await scenarios.and("the user confirms the deployment", async () => {
            const modal = page.getByRole("dialog", {name: /Deploy Development/i}).last()
            const deployBtn = modal.getByRole("button", {name: "Deploy"})
            const deployResponsePromise = page.waitForResponse((response: any) => {
                return (
                    response.url().includes("/environments/revisions/commit") &&
                    response.request().method() === "POST"
                )
            })

            await expect(deployBtn).toBeEnabled({timeout: 30000})
            await deployBtn.click()
            const deployResponse = await deployResponsePromise
            expect(deployResponse.ok()).toBe(true)
        })

        await scenarios.then("the deployment to Development succeeds", async () => {
            await expect(page.getByRole("dialog", {name: /Deploy Development/i})).toHaveCount(0, {
                timeout: 45000,
            })
        })
    })

    // WEB-ACC-DEPLOYMENT-002
    test(
        "should deploy a variant to staging and production environments",
        {tag: lightSlowTags},
        async ({page, apiHelpers, uiHelpers}) => {
            test.setTimeout(180000)
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and(
                "a fresh completion app with at least one variant exists",
                async () => {
                    const app = await apiHelpers.createApp("completion")
                    appId = app.id
                },
            )

            await scenarios.when("the user deploys the variant to Staging", async () => {
                await deployVariantToEnv(page, apiHelpers, uiHelpers, appId, "staging")
            })

            await scenarios.and("the user deploys the variant to Production", async () => {
                await deployVariantToEnv(page, apiHelpers, uiHelpers, appId, "production")
            })

            await scenarios.then("both Staging and Production deployments succeed", async () => {
                // deployVariantToEnv already asserts dialog closed + API 200 for each env
            })
        },
    )

    // WEB-ACC-DEPLOYMENT-003
    test(
        "should show version badge after deploying to Development",
        {tag: lightSlowTags},
        async ({page, apiHelpers, uiHelpers}) => {
            test.setTimeout(120000)
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and(
                "a fresh completion app with at least one variant exists",
                async () => {
                    const app = await apiHelpers.createApp("completion")
                    appId = app.id
                },
            )

            await scenarios.when("the user deploys the variant to Development", async () => {
                await deployVariantToEnv(page, apiHelpers, uiHelpers, appId, "development")
            })

            await scenarios.and("the user navigates to the app overview page", async () => {
                await page.goto(`${apiHelpers.getProjectScopedBasePath()}/apps/${appId}/overview`, {
                    waitUntil: "domcontentloaded",
                })
                await uiHelpers.expectPath(`/apps/${appId}/overview`)
                const deploymentHeading = page.getByRole("heading", {name: "Deployment"})
                await deploymentHeading.scrollIntoViewIfNeeded()
                await expect(deploymentHeading).toBeVisible({timeout: 10000})
            })

            await scenarios.then(
                "the Development card shows a version badge and the other two show no deployment",
                async () => {
                    // The VersionBadge component renders <span title="Version N">vN</span>
                    await expect(page.locator('span[title^="Version"]').first()).toBeVisible({
                        timeout: 15000,
                    })
                    // Staging and Production cards still show "No deployment"
                    await expect(page.getByText("No deployment")).toHaveCount(2, {timeout: 10000})
                },
            )
        },
    )
}

export default deploymentTests
