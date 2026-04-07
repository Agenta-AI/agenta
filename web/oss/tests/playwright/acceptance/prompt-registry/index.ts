import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
    TestLensType,
    TestCostType,
    TestLicenseType,
} from "@agenta/web-tests/playwright/config/testTags"

interface WorkflowRevision {
    id: string
    workflow_id?: string | null
    version?: number | null
}

interface WorkflowRevisionsResponse {
    workflow_revisions: WorkflowRevision[]
    count?: number
}

const promptRegistryTests = () => {
    test(
        "should open prompt details from prompt registry",
        {
            tag: [
                createTagString("scope", TestScope.PLAYGROUND),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("lens", TestLensType.FUNCTIONAL),
                createTagString("cost", TestCostType.Free),
                createTagString("license", TestLicenseType.OSS),
            ],
        },
        async ({page, uiHelpers, apiHelpers}) => {
            const app = await apiHelpers.getApp("completion")
            const appId = app.id

            const basePath = getProjectScopedBasePath(page)
            const revisionsResponsePromise =
                apiHelpers.waitForApiResponse<WorkflowRevisionsResponse>({
                    route: "/api/preview/workflows/revisions/query",
                    method: "POST",
                })

            await page.goto(`${basePath}/apps/${appId}/variants`, {
                waitUntil: "domcontentloaded",
            })
            await uiHelpers.expectPath(`/apps/${appId}/variants`)

            const revisionsResponse = await revisionsResponsePromise
            const revisions = revisionsResponse.workflow_revisions.filter(
                (revision) => (revision.version ?? 0) > 0,
            )

            test.skip(revisions.length === 0, "No workflow revisions found in registry")

            const selectedRevision = revisions[0]
            const revisionId = selectedRevision.id

            const row = page.locator(`[data-row-key="${revisionId}"]`).first()
            await expect(row).toBeVisible({timeout: 30000})
            await row.click()

            await page.waitForURL((url) => {
                return (
                    url.pathname.endsWith(`/apps/${appId}/variants`) &&
                    url.searchParams.get("revisionId") === revisionId
                )
            })

            const drawer = page.locator(".ant-drawer-content-wrapper").filter({
                hasText: "Workflow Revision",
            })
            await expect(drawer).toBeVisible({timeout: 15000})
            await expect(drawer.getByText("Workflow Revision").first()).toBeVisible({
                timeout: 15000,
            })

            const playgroundButton = drawer.getByRole("button", {name: "Playground"})
            await expect(playgroundButton).toBeVisible({timeout: 15000})
            await playgroundButton.click()

            await page.waitForURL(
                (url) => {
                    const revisionsParam = url.searchParams.get("revisions") ?? ""
                    return (
                        url.pathname.endsWith(`/apps/${appId}/playground`) &&
                        revisionsParam.split(",").includes(revisionId)
                    )
                },
                {timeout: 15000},
            )
            await uiHelpers.expectPath(`/apps/${appId}/playground`)
        },
    )
}

export default promptRegistryTests
