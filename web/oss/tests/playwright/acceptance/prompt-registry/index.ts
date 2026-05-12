import type {Locator, Page} from "@playwright/test"
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
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

interface WorkflowRevision {
    id: string
    workflow_id?: string | null
    version?: number | null
}

interface WorkflowRevisionsResponse {
    workflow_revisions: WorkflowRevision[]
    count?: number
}

type PromptRegistryApiHelpers = {
    getApp: (slug: string) => Promise<{id: string}>
    waitForApiResponse: <T>(options: {route: string; method: string}) => Promise<T>
}

type PromptRegistryUiHelpers = {
    expectPath: (path: string) => Promise<void>
}

const scenarios = createScenarios(test)

const tags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const getCompletionAppId = async (apiHelpers: {
    getApp: (slug: string) => Promise<{id: string}>
}) => {
    const app = await apiHelpers.getApp("completion")
    return app.id
}

const openWorkflowRevisionsPage = async (
    page: Page,
    uiHelpers: PromptRegistryUiHelpers,
    apiHelpers: PromptRegistryApiHelpers,
    appId: string,
) => {
    const basePath = getProjectScopedBasePath(page)
    const revisionsResponsePromise = apiHelpers.waitForApiResponse<WorkflowRevisionsResponse>({
        route: "/api/workflows/revisions/query",
        method: "POST",
    })

    await page.goto(`${basePath}/apps/${appId}/variants`, {
        waitUntil: "domcontentloaded",
    })
    await uiHelpers.expectPath(`/apps/${appId}/variants`)

    return await revisionsResponsePromise
}

const openFirstPublishedWorkflowRevision = async (
    page: Page,
    revisionsResponse: WorkflowRevisionsResponse,
) => {
    const revisions = revisionsResponse.workflow_revisions.filter(
        (revision) => (revision.version ?? 0) > 0,
    )

    test.skip(revisions.length === 0, "No workflow revisions found in registry")

    const selectedRevision = revisions[0]
    const revisionId = selectedRevision.id
    const row = page.locator(`[data-row-key="${revisionId}"]`).first()
    await expect(row).toBeVisible({timeout: 30000})
    await row.click()

    return revisionId
}

const expectWorkflowRevisionDrawer = async (page: Page, appId: string, revisionId: string) => {
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

    return drawer
}

const openPlaygroundFromWorkflowRevisionDrawer = async (drawer: Locator) => {
    const playgroundButton = drawer.getByRole("button", {name: "Playground"})
    await expect(playgroundButton).toBeVisible({timeout: 15000})
    await playgroundButton.click()
}

const expectPlaygroundForSelectedRevision = async (
    page: Page,
    uiHelpers: PromptRegistryUiHelpers,
    appId: string,
    revisionId: string,
) => {
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
}

const promptRegistryTests = () => {
    test(
        "should open prompt details from prompt registry",
        {tag: tags},
        async ({page, uiHelpers, apiHelpers}) => {
            let appId = ""
            let revisionId = ""
            let revisionsResponse: WorkflowRevisionsResponse | null = null
            let workflowRevisionDrawer: ReturnType<typeof page.locator> | null = null

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("at least one completion app exists", async () => {
                appId = await getCompletionAppId(apiHelpers)
            })

            await scenarios.and(
                "the user is on the workflow revisions page for that app",
                async () => {
                    revisionsResponse = await openWorkflowRevisionsPage(
                        page,
                        uiHelpers,
                        apiHelpers,
                        appId,
                    )
                },
            )

            await scenarios.when(
                "the user opens the first published workflow revision",
                async () => {
                    revisionId = await openFirstPublishedWorkflowRevision(page, revisionsResponse!)
                },
            )

            await scenarios.and("the workflow revision drawer is visible", async () => {
                workflowRevisionDrawer = await expectWorkflowRevisionDrawer(page, appId, revisionId)
            })

            await scenarios.and("the user opens Playground from that drawer", async () => {
                await openPlaygroundFromWorkflowRevisionDrawer(workflowRevisionDrawer!)
            })

            await scenarios.then("the Playground opens for the selected revision", async () => {
                await expectPlaygroundForSelectedRevision(page, uiHelpers, appId, revisionId)
            })
        },
    )
}

export default promptRegistryTests
