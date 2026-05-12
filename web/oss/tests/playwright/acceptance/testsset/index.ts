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

const scenarios = createScenarios(test)

const tags = buildAcceptanceTags({
    scope: [TestScope.DATASETS],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const testsetTests = () => {
    test("should view the default testset", {tag: tags}, async ({page, apiHelpers, uiHelpers}) => {
        let testsets: SimpleTestset[] = []
        let testsetId = ""
        let testsetName = ""

        await scenarios.given("the user is authenticated", async () => {
            await expectAuthenticatedSession(page)
        })

        await scenarios.and(
            "the user navigates to the Test Sets page via the sidebar",
            async () => {
                await page.goto("/apps", {waitUntil: "domcontentloaded"})

                const testsetsResponsePromise = page.waitForResponse(
                    (response) =>
                        response.url().includes("/api/testsets/query") &&
                        response.request().method() === "POST",
                )

                const testSetsLink = page.locator('a:has-text("Test sets")').first()
                await expect(testSetsLink).toBeVisible({timeout: 10000})
                await testSetsLink.click()
                await uiHelpers.waitForPath("/testsets")

                const testsetsResponse = await testsetsResponsePromise
                const testsetsData = (await testsetsResponse.json()) as TestsetsQueryResponse
                testsets = testsetsData.testsets

                await expect(page.getByRole("heading", {name: "Testsets"})).toBeVisible({
                    timeout: 10000,
                })
            },
        )

        await scenarios.when("the page loads the default testset list", async () => {
            test.skip(!testsets || testsets.length === 0, "No testsets found on deployment")

            testsetId = testsets[0].id || testsets[0]._id || ""
            testsetName = testsets[0].name

            if (!testsetId) {
                throw new Error("Testset ID not found")
            }

            const testsetRow = page.locator("[data-row-key]").filter({hasText: testsetName}).first()
            await expect(testsetRow).toBeVisible()

            const revisionsResponsePromise =
                apiHelpers.waitForApiResponse<TestsetRevisionsResponse>({
                    route: "/api/testsets/revisions/query",
                    method: "POST",
                })
            const revisionDetailResponsePromise =
                apiHelpers.waitForApiResponse<TestsetRevisionDetailResponse>({
                    route: "/api/testsets/revisions/",
                    method: "GET",
                })
            const testcasesResponsePromise = apiHelpers.waitForApiResponse<TestcasesQueryResponse>({
                route: "/api/testcases/query",
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
        })

        await scenarios.then(
            "the default testset detail page is visible with test cases",
            async () => {
                await expect(page.getByRole("heading", {name: testsetName}).first()).toBeVisible()
            },
        )
    })
}

export default testsetTests
