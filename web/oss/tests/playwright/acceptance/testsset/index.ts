import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

interface SimpleTestset {
    id: string
    name: string
    data?: {
        testcases: Array<{id: string; data: Record<string, unknown>}>
    }
}

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
            await page.goto("/testsets", {waitUntil: "domcontentloaded"})
            await uiHelpers.waitForPath("/testsets")
            const testsets = await apiHelpers.getTestsets()

            await uiHelpers.expectText("Test sets", {role: "heading"})

            // 3. Verify testset is visible in table
            // Preview endpoint returns 'id' instead of '_id'
            const testsetId = testsets[0].id || testsets[0]._id
            const testsetName = testsets[0].name

            if (!testsetId) {
                console.error("[Testset E2E]: Testset ID not found")
                throw new Error("Testset ID not found")
            }

            const testsetTable = page.getByRole("table").filter({hasText: testsetName})
            const testsetRow = testsetTable.getByRole("row", {name: testsetName})
            await expect(testsetRow).toBeVisible()

            const testsetResponsePromise = apiHelpers.waitForApiResponse<{testset: SimpleTestset}>({
                route: `/api/preview/simple/testsets/${testsetId}`,
                method: "GET",
            })

            // 4. Click on testset row
            await uiHelpers.clickTableRow(testsetName)

            // 6. Verify testset page
            await uiHelpers.waitForPath(`/testsets/${testsetId}`)
            await expect(page.getByRole("heading", {name: /testset|test set/i}).first()).toBeVisible()

            const response = await testsetResponsePromise
            const testset = response.testset
            expect(testset.name).toBe(testsetName)
            // Preview endpoint returns data.testcases instead of csvdata
            expect(testset.data?.testcases?.length).toBeGreaterThan(0)
        },
    )
}

export default testsetTests
