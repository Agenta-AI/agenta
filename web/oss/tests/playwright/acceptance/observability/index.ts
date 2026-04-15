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

const scenarios = createScenarios(test)

const tags = buildAcceptanceTags({
    scope: [TestScope.OBSERVABILITY],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
})

const observabilityTests = () => {
    test("view traces", {tag: tags}, async ({page, uiHelpers, apiHelpers}) => {
        test.skip(
            true,
            "Skipped until Playground execution guarantees fresh traces in the ephemeral project.",
        )

        await scenarios.given("the user is authenticated", async () => {
            await expectAuthenticatedSession(page)
        })

        await scenarios.and("the user is on the Observability page", async () => {
            await page.goto(`${apiHelpers.getProjectScopedBasePath()}/observability`, {
                waitUntil: "domcontentloaded",
            })
            await uiHelpers.expectPath(`/observability`)
        })

        await scenarios.when("the user opens the traces table", async () => {
            const tracesTab = page.getByRole("tab", {name: "Traces"})
            await expect(tracesTab).toBeVisible({timeout: 15000})

            const emptyState = page.getByText("No traces found", {exact: true})
            if (await emptyState.isVisible().catch(() => false)) {
                throw new Error(
                    "No traces found in the ephemeral project. Observability is downstream from Playground execution and currently has no fresh traces to display.",
                )
            }

            const tracesTable = page.getByRole("table").last()
            await expect(tracesTable).toBeVisible({timeout: 15000})
            const firstDataRow = tracesTable.getByRole("row").nth(1)
            await expect(firstDataRow).toBeVisible({timeout: 15000})
            await firstDataRow.getByRole("cell").nth(2).click()
        })

        await scenarios.then("the trace detail drawer opens", async () => {
            const drawer = page.locator(".ant-drawer-content-wrapper")
            await expect(drawer).toBeVisible({timeout: 10000})
        })
    })
}

export default observabilityTests
