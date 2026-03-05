import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
    TestLensType,
    TestCostType,
    TestLicenseType,
} from "@agenta/web-tests/playwright/config/testTags"
const observabilityTests = () => {
    test(
        "view traces",
        {
            tag: [
                createTagString("scope", TestScope.OBSERVABILITY),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("lens", TestLensType.FUNCTIONAL),
                createTagString("cost", TestCostType.Free),
                createTagString("license", TestLicenseType.OSS),
            ],
        },
        async ({page, uiHelpers}) => {
            // 1. Navigate to observability page via sidebar
            await page.goto("/apps", {waitUntil: "domcontentloaded"})

            const observabilityLink = page.locator('a:has-text("Observability")').first()
            await expect(observabilityLink).toBeVisible({timeout: 10000})
            await observabilityLink.click()
            await uiHelpers.expectPath(`/observability`)

            // 2. Wait for the Traces tab to be visible and selected
            const tracesTab = page.getByRole("tab", {name: "Traces"})
            await expect(tracesTab).toBeVisible({timeout: 15000})

            // 3. Wait for traces table to load with data
            const tracesTable = page.getByRole("table").last()
            await expect(tracesTable).toBeVisible({timeout: 15000})

            // Wait for at least one data row to appear
            const firstDataRow = tracesTable.getByRole("row").nth(1)
            await expect(firstDataRow).toBeVisible({timeout: 15000})

            // 4. Click on the first trace row to open drawer
            const firstCell = firstDataRow.getByRole("cell").nth(2)
            await expect(firstCell).toBeVisible()
            await firstCell.click()

            // 5. Assert drawer opens
            const drawer = page.locator(".ant-drawer-content-wrapper")
            await expect(drawer).toBeVisible({timeout: 10000})
        },
    )
}

export default observabilityTests
