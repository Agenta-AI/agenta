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
                createTagString("lens", TestLensType.FUNCTIONAL),
                createTagString("cost", TestCostType.Free),
                createTagString("license", TestLicenseType.OSS),
            ],
        },
        async ({page, apiHelpers, uiHelpers}) => {
            // 1. Navigate to testsets page via sidebar
            await page.goto("/apps", {waitUntil: "domcontentloaded"})

            // Set up API interception before clicking
            const testsetsResponsePromise = page.waitForResponse(
                (response) =>
                    response.url().includes("/api/preview/testsets/query") &&
                    response.request().method() === "POST",
            )

            const testSetsLink = page.locator('a:has-text("Test sets")').first()
            await expect(testSetsLink).toBeVisible({timeout: 10000})
            await testSetsLink.click()
            await uiHelpers.waitForPath("/testsets")

            const testsetsResponse = await testsetsResponsePromise
            const testsetsData = await testsetsResponse.json()
            const testsets = testsetsData.testsets

            // Verify navigation and page title
            await expect(
                page.getByRole("heading", {name: /testsets|test sets/i}).first(),
            ).toBeVisible({timeout: 10000})

            // Skip if no testsets exist on this deployment
            test.skip(!testsets || testsets.length === 0, "No testsets found on deployment")

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
                route: `/api/simple/testsets/${testsetId}`,
                method: "GET",
            })

            // 4. Click on testset row
            await uiHelpers.clickTableRow(testsetName)

            // 6. Verify testset page
            await uiHelpers.waitForPath(`/testsets/${testsetId}`)
            await expect(
                page.getByRole("heading", {name: /testset|test set/i}).first(),
            ).toBeVisible()

            const response = await testsetResponsePromise
            const testset = response.testset
            expect(testset.name).toBe(testsetName)
            // Preview endpoint returns data.testcases instead of csvdata
            expect(testset.data?.testcases?.length).toBeGreaterThan(0)
        },
    )
}

export default testsetTests
