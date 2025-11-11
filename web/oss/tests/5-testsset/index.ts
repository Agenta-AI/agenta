import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import type {TestSet} from "@/oss/lib/Types"
import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

const testsetTests = () => {
    test(
        "should view the default testset",
        {
            tag: [
                createTagString("scope", TestScope.DATASETS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, apiHelpers, uiHelpers}) => {
            // 1. Navigate to testsets page
            await page.goto("/testsets")
            await uiHelpers.waitForPath("/testsets")
            const testsets = await apiHelpers.getTestsets()

            await uiHelpers.expectText("Test Sets", {role: "heading"})

            // 3. Verify testset is visible in table
            const testsetId = testsets[0]._id
            const testsetName = testsets[0].name

            if (!testsetId) {
                console.error("[Testset E2E]: Testset ID not found")
                throw new Error("Testset ID not found")
            }

            const testsetTable = page.getByRole("table").filter({hasText: testsetName})
            const testsetRow = testsetTable.getByRole("row", {name: testsetName})
            await expect(testsetRow).toBeVisible()

            // 4. Click on testset row
            await uiHelpers.clickTableRow(testsetName)

            // 5. Fetch testset from API
            const testsetResponse = await apiHelpers.waitForApiResponse<TestSet>({
                route: `/api/testsets/${testsetId}`,
                method: "GET",
            })

            // 6. Verify testset page
            await uiHelpers.waitForPath(`/testsets/${testsetId}`)
            await uiHelpers.expectText("Create a new Test Set", {role: "heading"})

            const testset = await testsetResponse
            expect(testset.name).toBe(testsetName)
            expect(testset.csvdata.length).toBeGreaterThan(0)
        },
    )
}

export default testsetTests
