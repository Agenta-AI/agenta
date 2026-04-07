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
    _id?: string
}

interface TestsetsQueryResponse {
    testsets: SimpleTestset[]
}

interface TestsetRevision {
    id: string
    version: number | string
    testset_id: string
}

interface TestsetRevisionsResponse {
    testset_revisions: TestsetRevision[]
}

interface TestcasesQueryResponse {
    count?: number
    testcases?: Array<{id: string; data?: Record<string, unknown>}>
}

interface TestsetRevisionDetailResponse {
    testset_revision: {
        id: string
        testset_id: string
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
            await page.goto("/apps", {waitUntil: "domcontentloaded"})

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
            const testsetsData = (await testsetsResponse.json()) as TestsetsQueryResponse
            const testsets = testsetsData.testsets

            await expect(page.getByRole("heading", {name: "Testsets"})).toBeVisible({
                timeout: 10000,
            })

            test.skip(!testsets || testsets.length === 0, "No testsets found on deployment")

            const testsetId = testsets[0].id || testsets[0]._id
            const testsetName = testsets[0].name

            if (!testsetId) {
                console.error("[Testset E2E]: Testset ID not found")
                throw new Error("Testset ID not found")
            }

            const testsetRow = page.locator("[data-row-key]").filter({hasText: testsetName}).first()
            await expect(testsetRow).toBeVisible()

            const revisionsResponsePromise =
                apiHelpers.waitForApiResponse<TestsetRevisionsResponse>({
                    route: "/api/preview/testsets/revisions/query",
                    method: "POST",
                })
            const revisionDetailResponsePromise =
                apiHelpers.waitForApiResponse<TestsetRevisionDetailResponse>({
                    route: "/api/preview/testsets/revisions/",
                    method: "GET",
                })
            const testcasesResponsePromise = apiHelpers.waitForApiResponse<TestcasesQueryResponse>({
                route: "/api/preview/testcases/query",
                method: "POST",
            })

            await testsetRow.click()

            const revisionsResponse = await revisionsResponsePromise
            const revisions = revisionsResponse.testset_revisions.filter(
                (revision) => Number(revision.version) !== 0,
            )

            expect(revisions.length).toBeGreaterThan(0)

            const latestRevision = revisions[0]
            expect(latestRevision.testset_id).toBe(testsetId)

            await uiHelpers.waitForPath(`/testsets/${latestRevision.id}`)

            const revisionDetailResponse = await revisionDetailResponsePromise
            expect(revisionDetailResponse.testset_revision.id).toBe(latestRevision.id)
            expect(revisionDetailResponse.testset_revision.testset_id).toBe(testsetId)

            const testcasesResponse = await testcasesResponsePromise
            expect(
                testcasesResponse.count ?? testcasesResponse.testcases?.length ?? 0,
            ).toBeGreaterThan(0)

            await expect(page.getByRole("heading", {name: testsetName}).first()).toBeVisible()
        },
    )
}

export default testsetTests
