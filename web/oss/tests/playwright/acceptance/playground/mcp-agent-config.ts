/**
 * Choosing an MCP connection for one agent, in a browser.
 *
 * The settings suite covers the connection itself: making one, authorizing it, taking it away.
 * This one covers the other half of the split, which is the part that decides what actually runs.
 * A connection is project-wide; what an agent may do with it is not. So every case here ends at
 * the SAVED configuration read back from the API, because the editor showing the right thing and
 * the commit writing the right thing are two different claims, and only the second one runs.
 *
 * Selectors are accessible names wherever the UI has one, for the reason the settings suite gives:
 * a name that regresses fails the test, and a test id that survives a rename does not.
 */
import {
    TestCostType,
    TestCoverage,
    TestLensType,
    TestLicenseType,
    TestPath,
    TestRoleType,
    TestScope,
    TestSpeedType,
    TestcaseType,
} from "@agenta/web-tests/playwright/config/testTags"
import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import type {Page} from "@playwright/test"

import {AGENT_APPS_UNAVAILABLE_REASON, queryWorkflowAgentState} from "../utils/agentApps"
import {expectAuthenticatedSession} from "../utils/auth"
import {
    apiBaseUrl,
    createMcpConnectionViaApi,
    fillJourneyUrlAndName,
    journeyDialog,
    mockMcpBase,
    navigate,
    PROBE_MS,
    projectIdFrom,
    requireMockMcpUpstream,
    ROUTE_WARMUP_MS,
    uniqueName,
} from "../utils/mcpConnections"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const test = baseTest.extend<{registerAgentAppForCleanup: (appId: string) => void}>({
    registerAgentAppForCleanup: async ({apiHelpers}, use) => {
        let appId: string | undefined
        await use((createdAppId) => {
            appId = createdAppId
        })
        if (appId) await apiHelpers.archiveApp(appId)
    },
})

const scenarios = createScenarios(test)

const createTags = (license: TestLicenseType) =>
    buildAcceptanceTags({
        scope: [TestScope.PLAYGROUND],
        coverage: [TestCoverage.FULL],
        path: TestPath.HAPPY,
        lens: TestLensType.FUNCTIONAL,
        cost: TestCostType.Free,
        license,
        role: TestRoleType.Owner,
        caseType: TestcaseType.TYPICAL,
        speed: TestSpeedType.SLOW,
    })

interface SavedMcpItem {
    name?: string
    connection?: {type?: string; namespace?: string; slug?: string}
    policy?: {
        tool_permissions?: Record<string, string>
        new_tool_permission?: string | null
    }
}

interface RevisionLike {
    created_at?: string
    data?: {parameters?: {agent?: {mcps?: SavedMcpItem[]}}} | null
}

/**
 * Create an agent app and land on its playground.
 *
 * The recipe is the skills suite's, which is the only other place an agent app is made from the
 * UI. It is done through the UI rather than the API on purpose: the create path decides whether
 * the app is agent-type at all, and an app made any other way could pass this suite while the
 * real one does not exist.
 */
const createAgentApp = async (page: Page, basePath: string, appName: string): Promise<string> => {
    await navigate(page, `${basePath}/prompts`)
    await expect(page.getByRole("heading", {name: "Prompts"}).first()).toBeVisible({
        timeout: ROUTE_WARMUP_MS,
    })

    // "Create new" → hover "New prompt" (the submenu opens on hover) → "Agent".
    await page.getByTestId("prompts-create-new-trigger").first().click()
    const newPromptMenuItem = page.getByTestId("prompts-new-prompt-menu-item").first()
    await expect(newPromptMenuItem).toBeVisible({timeout: 15000})
    // Forced because the menu is still animating in: Playwright's stability check waits for the
    // element to stop moving, and this one is moving for as long as the test is willing to wait.
    await newPromptMenuItem.hover({force: true})
    const agentItem = page.getByRole("menuitem", {name: "Agent", exact: true})
    await expect(agentItem).toBeVisible({timeout: 15000})
    await agentItem.click()

    const createDrawer = page
        .getByRole("dialog")
        .filter({has: page.getByTestId("app-create-name-input")})
        .last()
    const nameInput = page.getByTestId("app-create-name-input").first()
    await expect(nameInput).toBeVisible({timeout: 30000})
    await nameInput.fill(appName)
    await nameInput.blur()

    const created = page.waitForResponse(
        (response) =>
            response.url().includes("/workflows") &&
            response.request().method() === "POST" &&
            (response.request().postData() ?? "").includes(appName),
        {timeout: 90000},
    )
    await createDrawer.getByRole("button", {name: "Create", exact: true}).first().click()

    // The drawer and the modal it opens BOTH carry a Create, and both are dialogs, so "the last
    // dialog with a Create button" resolves to whichever the DOM happens to order last — which is
    // the drawer often enough, and then the click lands under the modal's own overlay and the app
    // is never made. The modal's heading is the thing only it has.
    const confirmModal = page.getByRole("dialog").filter({hasText: "Create changes"}).last()
    await expect(confirmModal).toBeVisible({timeout: 30000})
    await confirmModal.getByRole("button", {name: "Create", exact: true}).click()

    const response = await created
    expect(response.ok(), await response.text()).toBe(true)
    const body = (await response.json()) as {workflow: {id: string}}

    // The create path is what decides whether this is an agent at all, and when it is not, every
    // later step fails on a missing section instead of on the thing that went wrong. Said here,
    // once, in the words of the cause: the app exists, it is simply not an agent.
    const state = await queryWorkflowAgentState(
        page,
        apiBaseUrl(),
        projectIdFrom(basePath),
        body.workflow.id,
    )
    expect(state, AGENT_APPS_UNAVAILABLE_REASON).not.toBe("not-agent")

    await navigate(page, `${basePath}/apps/${body.workflow.id}/playground`)
    return body.workflow.id
}

/** Whether this worker has already paid for the agent playground to compile. */
let playgroundWarmed = false

/**
 * Pay for the playground route to compile, once per worker, before any case depends on it.
 *
 * A development server builds a route the first time it is asked for, and this is the heaviest
 * one in the app: a reviewer's run of this suite had all three cases fail in the same place,
 * waiting ninety seconds for a page that was still compiling. The connect suite solves the same
 * problem the same way, on a lighter route (D49).
 *
 * Failures here are swallowed. This is a warm-up, not a check: whatever is wrong will be said
 * properly by the case that follows, against the assertion that actually means something.
 */
const warmPlayground = async (page: Page, basePath: string): Promise<void> => {
    if (playgroundWarmed) return
    try {
        await navigate(page, `${basePath}/playground`)
        await page
            .getByRole("button", {name: /^MCP servers\b|^Model$|^Instructions$/})
            .first()
            .waitFor({timeout: PLAYGROUND_WARMUP_MS})
    } catch {
        // Nothing to report: the first case waits on the same page with its own budget.
    }
    playgroundWarmed = true
}

/**
 * How long the agent playground may take the first time a worker asks for it.
 *
 * Four times the ordinary route budget: this page compiles the schema form, the drill-in view
 * and the whole chat surface, and then opens a session before it paints anything.
 */
const PLAYGROUND_WARMUP_MS = 4 * ROUTE_WARMUP_MS

/**
 * Open the MCP servers section's create drawer.
 *
 * The section itself is conditional: it appears only while the agent's harness says it can reach
 * user MCP servers. Asserting it rather than skipping past it is deliberate — a deployment whose
 * default agent cannot use MCP servers is a fact this suite should report, not step around.
 */
const openNewMcpItem = async (page: Page) => {
    const addLink = page.getByRole("button", {name: "add a server", exact: true})
    const sectionHeader = page.getByRole("button", {name: /^MCP servers\b/})
    // The section appearing is also this page's sign of life: an agent's playground opens a
    // session first, so there is nothing to assert on until the configuration panel is up.
    // On a development server it sometimes never comes, because the client asked for a chunk id
    // the last rebuild replaced; one reload fetches the current one. The allowance is one — a
    // second empty page is the page being broken, which is this suite's to report.
    // The setup warms this route, so the ordinary budget is usually right. It is kept generous
    // anyway: the lazily loaded configuration pane still renders for the first time here, and
    // the agent's own session is opened before the page paints at all.
    try {
        await expect(sectionHeader.or(addLink).first()).toBeVisible({timeout: PLAYGROUND_WARMUP_MS})
    } catch {
        await page.reload({waitUntil: "domcontentloaded"})
        await expect(sectionHeader.or(addLink).first()).toBeVisible({timeout: PLAYGROUND_WARMUP_MS})
    }
    if (!(await addLink.isVisible())) {
        await sectionHeader.first().click()
    }
    await expect(addLink).toBeVisible({timeout: 15000})

    // INVARIANT: a drawer may only be opened once the session route has landed.
    //
    // An agent's playground opens a session for its conversation and navigates to it, and that
    // navigation remounts the configuration panel — so a drawer opened before it arrives is torn
    // down under the interaction, taking its draft with it (D94).
    //
    // This wait is a workaround, not a convenience: it stands in for the mobile case that would
    // assert the product holds that invariant itself, which does not exist yet (#6897). Keep it
    // until that case does.
    //
    // Tolerated rather than required: a session that is already open never navigates again, and
    // the assertions that follow are what decide whether the drawer is there.
    await page.waitForURL(/session_id=/, {timeout: PLAYGROUND_WARMUP_MS}).catch(() => undefined)

    await addLink.click()
    const drawer = itemDrawer(page)
    await expect(drawer).toBeVisible({timeout: 15000})
    return drawer
}

/** The config item's own drawer, identified by the connection field only it has. */
const itemDrawer = (page: Page) =>
    page.locator('[role="dialog"]:has([aria-label="Connection"])').last()

/** Pick a connection by the name it is listed under. */
const chooseConnection = async (page: Page, name: string) => {
    await itemDrawer(page).getByRole("combobox", {name: "Connection"}).click()
    await page.getByRole("option", {name, exact: true}).click()
}

/** Set one permission select to one of its options. */
const setPermission = async (page: Page, label: string, option: string) => {
    await itemDrawer(page).getByRole("combobox", {name: label}).click()
    // The option's accessible name is its title plus its help line, so match the title only.
    await page.getByRole("option", {name: new RegExp(`^${option}\\b`)}).click()
}

/** Save the drawer's draft into the agent's configuration. */
const createItem = async (page: Page) => {
    const drawer = itemDrawer(page)
    const create = drawer.getByRole("button", {name: "Create", exact: true})
    await expect(create).toBeEnabled({timeout: 15000})
    await create.click()
    await expect(drawer).toHaveCount(0, {timeout: 20000})
}

/**
 * The MCP items of the agent's newest revision.
 *
 * Polled rather than read once. An agent's configuration commits itself as it is edited, so
 * there is no button to press and no response to await: the test asks the server until the
 * item it just made shows up, which is the only claim it cares about anyway.
 */
const savedMcpItems = async (
    page: Page,
    basePath: string,
    workflowId: string,
): Promise<SavedMcpItem[]> => {
    const read = async (): Promise<SavedMcpItem[]> => {
        const response = await page.request
            .post(
                `${apiBaseUrl()}/workflows/revisions/query?project_id=${projectIdFrom(basePath)}`,
                {data: {workflow_refs: [{id: workflowId}]}},
            )
            .catch(() => null)
        if (!response?.ok()) return []
        const body = (await response.json().catch(() => null)) as {
            workflow_revisions?: RevisionLike[]
        } | null
        const revisions = [...(body?.workflow_revisions ?? [])].sort((a, b) =>
            String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
        )
        for (const revision of revisions) {
            const mcps = revision.data?.parameters?.agent?.mcps
            if (mcps?.length) return mcps
        }
        return []
    }

    await expect
        .poll(async () => (await read()).length, {timeout: 60000, intervals: [1000]})
        .toBeGreaterThan(0)
    return read()
}

export const mcpAgentConfigAcceptanceTests = (license: TestLicenseType) => () => {
    const tags = createTags(license)

    test.beforeAll(requireMockMcpUpstream)

    test.beforeEach(async ({page, apiHelpers}) => {
        // Each case makes an agent app through the UI and then waits on a round trip to an MCP
        // server, which together do not fit the suite-wide minute meant for a page of clicks.
        test.setTimeout(600_000)
        await expectAuthenticatedSession(page)
        await warmPlayground(page, apiHelpers.getProjectScopedBasePath())
    })

    test(
        "an agent points at a connection and freezes its tool prefix",
        {tag: tags},
        async ({page, apiHelpers, registerAgentAppForCleanup}) => {
            const basePath = apiHelpers.getProjectScopedBasePath()
            const connectionName = uniqueName("Picked MCP")
            let workflowId = ""
            let slug = ""

            await scenarios.given("a connection the project already has", async () => {
                const endpoint = await createMcpConnectionViaApi(page, basePath, connectionName)
                slug = endpoint.slug
            })

            await scenarios.and("a new agent", async () => {
                workflowId = await createAgentApp(page, basePath, `e2e-mcp-pick-${Date.now()}`)
                registerAgentAppForCleanup(workflowId)
            })

            await scenarios.when("the user adds an MCP server and picks it", async () => {
                await openNewMcpItem(page)
                await chooseConnection(page, connectionName)
            })

            await scenarios.then("the form shows what the agent will use", async () => {
                const drawer = itemDrawer(page)
                // Where it points, and whether it can be used right now. A connection needing
                // authorization is a different answer from one that is ready, and the form says
                // which rather than leaving it to run time.
                await expect(drawer.getByText("Connected", {exact: true})).toBeVisible({
                    timeout: 30000,
                })
                await expect(drawer.getByText(`${mockMcpBase()}/`)).toBeVisible()
                // The prefix the model will see, taken from the display name once and kept.
                await expect(drawer.getByText("Tool prefix", {exact: true})).toBeVisible()
                await expect(
                    drawer.getByText(connectionName.replace(/[^A-Za-z0-9_]/g, "_")).first(),
                ).toBeVisible()
            })

            await scenarios.and("the saved configuration names that connection", async () => {
                await createItem(page)

                const items = await savedMcpItems(page, basePath, workflowId)
                expect(items).toHaveLength(1)
                // The slug, not the display name: renaming the connection later must not
                // repoint or break an agent that is already saved.
                expect(items[0].connection).toMatchObject({
                    type: "gateway",
                    namespace: "custom",
                    slug,
                })
                // The prefix is the display name normalized to what a tool name may hold, and
                // it is frozen at this moment rather than recomputed on read.
                expect(items[0].name).toBe(connectionName.replace(/[^A-Za-z0-9_]/g, "_"))
            })
        },
    )

    test(
        "connecting from an agent selects the new connection for that agent",
        {tag: tags},
        async ({page, apiHelpers, registerAgentAppForCleanup}) => {
            const basePath = apiHelpers.getProjectScopedBasePath()
            const connectionName = uniqueName("Inline MCP")
            let workflowId = ""

            await scenarios.given("a new agent with no MCP server", async () => {
                workflowId = await createAgentApp(page, basePath, `e2e-mcp-inline-${Date.now()}`)
                registerAgentAppForCleanup(workflowId)
            })

            await scenarios.when(
                "the user connects a server without leaving the form",
                async () => {
                    await openNewMcpItem(page)
                    await itemDrawer(page).getByRole("combobox", {name: "Connection"}).click()
                    // The same journey settings opens, reached from the picker rather than from a
                    // page of its own — which is the point: nobody should have to leave the agent
                    // they are configuring to give it a server.
                    await page.getByRole("button", {name: "Connect MCP"}).click()
                    const dialog = await fillJourneyUrlAndName(
                        page,
                        `${mockMcpBase()}/`,
                        connectionName,
                    )
                    await dialog.getByRole("button", {name: "Connect", exact: true}).click()

                    // Opened from an agent, the journey closes the moment the connection
                    // exists: the item takes it and the person carries on configuring.
                    // Settings keeps the same dialog open instead, to report the tools it
                    // found, which is why only that suite has a Done to press.
                    await expect(journeyDialog(page)).toHaveCount(0, {timeout: 90000})
                },
            )

            await scenarios.then("the new connection is the one this agent uses", async () => {
                // The picker's list reopens behind the journey and is still open. While it is,
                // everything outside it is aria-hidden, so neither the select nor the drawer
                // around it can be found by role, and Create sits behind the list.
                await page.keyboard.press("Escape")

                const drawer = itemDrawer(page)
                await expect(drawer.getByRole("combobox", {name: "Connection"})).toContainText(
                    connectionName,
                    {timeout: 30000},
                )
                await createItem(page)

                const items = await savedMcpItems(page, basePath, workflowId)
                expect(items).toHaveLength(1)
                expect(items[0].connection?.slug).toBeTruthy()
                expect(items[0].name).toBe(connectionName.replace(/[^A-Za-z0-9_]/g, "_"))
            })

            await scenarios.and(
                "the project now holds exactly that one new connection",
                async () => {
                    // Connecting from an agent is still a project-wide act: the connection is
                    // created once and shared, and the agent only points at it.
                    const response = await page.request.post(
                        `${apiBaseUrl()}/gateways/mcps/endpoints/query?project_id=${projectIdFrom(basePath)}`,
                        {data: {}},
                    )
                    expect(response.ok(), await response.text()).toBe(true)
                    const body = (await response.json()) as {endpoints: {name?: string}[]}
                    expect(
                        body.endpoints.filter((row) => row.name === connectionName),
                    ).toHaveLength(1)
                },
            )
        },
    )

    test(
        "per-tool permissions reach the saved configuration",
        {tag: tags},
        async ({page, apiHelpers, registerAgentAppForCleanup}) => {
            const basePath = apiHelpers.getProjectScopedBasePath()
            const connectionName = uniqueName("Policy MCP")
            let workflowId = ""

            await scenarios.given("an agent pointed at a connected server", async () => {
                await createMcpConnectionViaApi(page, basePath, connectionName)
                workflowId = await createAgentApp(page, basePath, `e2e-mcp-policy-${Date.now()}`)
                registerAgentAppForCleanup(workflowId)
                await openNewMcpItem(page)
                await chooseConnection(page, connectionName)
            })

            await scenarios.when("the user decides per tool", async () => {
                const drawer = itemDrawer(page)
                // Until this is clicked nothing per-tool is written, so an agent configured
                // before per-tool policy existed keeps behaving exactly as it did.
                await drawer.getByRole("button", {name: "Set permissions per tool"}).click()

                // The list comes from the server itself, so it is a round trip.
                await expect(drawer.getByText("echo", {exact: true})).toBeVisible({
                    timeout: PROBE_MS,
                })
                await setPermission(page, "Permission for a tool with no rule", "Allow")
                await setPermission(page, "Permission for echo", "Deny")
            })

            await scenarios.then("both decisions are in the saved configuration", async () => {
                await createItem(page)

                const items = await savedMcpItems(page, basePath, workflowId)
                expect(items).toHaveLength(1)
                // The name the SERVER advertises, not the prefixed one a harness renders:
                // the upstream spelling is the only one every harness agrees on.
                expect(items[0].policy?.tool_permissions).toMatchObject({echo: "deny"})
                // The other half of the pair. Without it a tool the server adds tomorrow would
                // arrive under whatever a run default said, which is not a policy.
                expect(items[0].policy?.new_tool_permission).toBe("allow")
            })
        },
    )
}
