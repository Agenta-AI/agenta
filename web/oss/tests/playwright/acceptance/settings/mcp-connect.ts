/**
 * The MCP connect journey, end to end in a browser.
 *
 * The suite this replaces drove a flow that no longer exists: it registered a server through
 * a modal asking for a slug and an authentication mode, then connected it from a row menu.
 * Both steps are gone, so every selector it held is gone with them.
 *
 * Selectors here are accessible names and visible text rather than test ids wherever the UI
 * has one. That is deliberate: `getByRole("button", {name: "Connect MCP"})` fails when the
 * label regresses and a test id does not, and the label is the part a person actually reads.
 * Structure-only elements are located by their text within a row.
 *
 * Two environment facts the OAuth case depends on, both gated rather than assumed:
 *
 * - The issuer publishes itself under the address the API dials, which on a compose stack is
 *   a container name. The browser has to resolve that same name, which is what
 *   `PLAYWRIGHT_HOST_RESOLVER_RULES=MAP mock-mcp-gateway 127.0.0.1` is for.
 * - The mock upstream only exists while `AGENTA_GATEWAYS_MOCKS_ENABLED` is on.
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
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import type {Page} from "@playwright/test"

import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const scenarios = createScenarios(test)

/**
 * The unauthenticated mock MCP server, as the API dials it.
 *
 * Defaulted rather than gated. This suite used to skip whenever the variable was unset, and it
 * was set nowhere in the repository, so the only end-to-end coverage this feature has never ran
 * and every run reported green (D25). It runs by default now and says what is missing when it
 * cannot run, because a skipped suite that reads as a passing one is worse than a red one.
 */
const mockBaseUrl = (
    process.env.AGENTA_MOCK_MCP_GATEWAY_URL || "http://mock-mcp-gateway:9092"
).replace(/\/$/, "")

/** The same container as this process sees it, which is where the reachability check goes. */
const publishedMockUrl = (
    process.env.AGENTA_MOCK_MCP_GATEWAY_PUBLISHED_URL || "http://127.0.0.1:9092"
).replace(/\/$/, "")
/** Its OAuth-protected surface. `/` stays open so the no-auth case has something to use. */
const oauthPath = process.env.AGENTA_MCP_OAUTH_ACCEPTANCE_PATH || "/oauth/mcp"

const createTags = (license: TestLicenseType) =>
    buildAcceptanceTags({
        scope: [TestScope.SETTINGS],
        coverage: [TestCoverage.FULL],
        path: TestPath.HAPPY,
        lens: TestLensType.FUNCTIONAL,
        cost: TestCostType.Free,
        license,
        role: TestRoleType.Owner,
        caseType: TestcaseType.TYPICAL,
        speed: TestSpeedType.SLOW,
    })

/** A name no other run shares, so a duplicate refusal is this test's own doing. */
const uniqueName = (prefix: string) => `${prefix} ${Date.now()}${Math.floor(Math.random() * 1000)}`

/** How long the settings route may take the first time a worker asks for it. */
const ROUTE_WARMUP_MS = 90_000
/** How long a probe of a server the API has to dial may take. */
const PROBE_MS = 45_000

/** Whether this worker has already paid for the settings route to compile. */
let settingsWarmed = false

/**
 * Go to a page, tolerating the abort a browser reports when a navigation is superseded.
 *
 * A `goto` issued while an earlier one is still settling cancels that one, and Playwright
 * surfaces the cancellation as an error on the call that caused it rather than on the
 * navigation that lost. Nothing is wrong when that happens, and the assertion that follows is
 * what decides whether the page arrived (D49).
 */
const navigate = async (page: Page, url: string) => {
    try {
        await page.goto(url, {waitUntil: "domcontentloaded"})
    } catch (error) {
        if (!String(error).includes("ERR_ABORTED")) throw error
    }
}

const openSettings = async (page: Page, basePath: string) => {
    await navigate(page, `${basePath}/settings?tab=mcpEndpoints`)
    // The tab falls back when the deployment serves no MCP gateway, so assert we are on it
    // rather than discovering it three steps later.
    //
    // The first visit in a worker also pays for a development server to compile the route,
    // which is why it gets its own budget rather than borrowing the one meant for a round
    // trip to an MCP server.
    await expect(page.getByRole("button", {name: "Connect MCP"}).first()).toBeVisible({
        timeout: settingsWarmed ? 30000 : ROUTE_WARMUP_MS,
    })
    settingsWarmed = true
}

const connectionRow = (page: Page, name: string) =>
    page.locator("tr").filter({hasText: name}).first()

/**
 * Close a journey that reached its connected state.
 *
 * It stays open on purpose, reporting what was connected; the next thing a test does is
 * behind it, so every case that connects has to finish the journey first.
 */
const finishJourney = async (page: Page) => {
    const dialog = journeyDialog(page)
    await expect(dialog.getByText("is connected.")).toBeVisible({timeout: 60000})
    await dialog.getByRole("button", {name: "Done"}).click()
    await expect(dialog).toHaveCount(0, {timeout: 20000})
}

/**
 * The connect journey's own dialog.
 *
 * Addressed as the dialog CONTAINING the journey's test id, not `getByRole("dialog").last()`:
 * the settings page also mounts the connection detail drawer, which is a dialog too, so "the
 * last one" is whichever the DOM happens to order last. This is the case a test id is for —
 * the element has no accessible name that tells it apart. The id marks the journey's fields,
 * while the footer buttons are its siblings, so the handle has to be the dialog around both.
 */
const journeyDialog = (page: Page) =>
    page.locator('[role="dialog"]:has([data-testid="mcp-connect-journey"])')

/** Drive the journey as far as the name step, which every path shares. */
const startJourney = async (page: Page, url: string, name: string) => {
    await page.getByRole("button", {name: "Connect MCP"}).first().click()
    const dialog = journeyDialog(page)

    await dialog.getByLabel("MCP server URL").fill(url)
    await dialog.getByRole("button", {name: "Continue"}).click()

    // The step between these two is a probe: the API dials the server and reads what it
    // answers. That is a round trip to a third party, so it gets its own budget rather than
    // the default one meant for a render.
    const nameField = dialog.getByLabel("Connection name")
    await expect(nameField).toBeVisible({timeout: PROBE_MS})
    await nameField.fill(name)
    return dialog
}

export const mcpConnectAcceptanceTests = (license: TestLicenseType) => () => {
    const tags = createTags(license)

    // One reachability check for the whole suite, so a stack without the mock upstream fails
    // in one place with a sentence naming what to start, rather than seven times with a
    // sixty-second timeout apiece.
    test.beforeAll(async () => {
        let reachable = false
        try {
            const response = await fetch(publishedMockUrl, {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "ping", params: {}}),
                signal: AbortSignal.timeout(5000),
            })
            reachable = response.status < 500
        } catch {
            reachable = false
        }
        if (!reachable) {
            throw new Error(
                `The MCP mock upstream did not answer at ${publishedMockUrl}. This suite needs a ` +
                    "stack running the gateway mocks: bring one up with AGENTA_GATEWAYS_MOCKS_ENABLED=true, " +
                    "and set AGENTA_MOCK_MCP_GATEWAY_PUBLISHED_URL if it is published somewhere else.",
            )
        }
    })

    test.beforeEach(async ({page}) => {
        await expectAuthenticatedSession(page)
    })

    test(
        "connects a server that needs no authentication",
        {tag: tags},
        async ({page, apiHelpers}) => {
            const name = uniqueName("Open MCP")
            const basePath = apiHelpers.getProjectScopedBasePath()

            await scenarios.given("the user is on MCP settings", async () => {
                await openSettings(page, basePath)
            })

            await scenarios.when("the user connects a server by URL", async () => {
                const dialog = await startJourney(page, `${mockBaseUrl}/`, name)
                // The probe reached the server and read what it needs, so the journey says
                // so before asking for anything else.
                await expect(dialog.getByText("needs no authentication")).toBeVisible()
                await dialog.getByRole("button", {name: "Continue"}).click()
                await finishJourney(page)
            })

            await scenarios.then("the connection is listed as ready", async () => {
                const row = connectionRow(page, name)
                await expect(row).toBeVisible({timeout: 30000})
                await expect(row.getByText("Ready", {exact: true})).toBeVisible({timeout: 30000})
            })
        },
    )

    test(
        "suggests the name the server gives for itself",
        {tag: tags},
        async ({page, apiHelpers}) => {
            await scenarios.given("the user is on MCP settings", async () => {
                await openSettings(page, apiHelpers.getProjectScopedBasePath())
            })

            await scenarios.then(
                "the name step is pre-filled from the server's own metadata",
                async () => {
                    await page.getByRole("button", {name: "Connect MCP"}).first().click()
                    const dialog = journeyDialog(page)
                    await dialog.getByLabel("MCP server URL").fill(`${mockBaseUrl}/`)
                    await dialog.getByRole("button", {name: "Continue"}).click()

                    const nameField = dialog.getByLabel("Connection name")
                    await expect(nameField).toBeVisible({timeout: 30000})
                    // serverInfo.name from the handshake, not the hostname fallback.
                    await expect(nameField).toHaveValue("agenta-mock-mcp")
                },
            )
        },
    )

    test(
        "refuses a display name the project already uses",
        {tag: tags},
        async ({page, apiHelpers}) => {
            const name = uniqueName("Duplicate MCP")
            const basePath = apiHelpers.getProjectScopedBasePath()

            await scenarios.given("a connection already uses the name", async () => {
                await openSettings(page, basePath)
                const dialog = await startJourney(page, `${mockBaseUrl}/`, name)
                await dialog.getByRole("button", {name: "Continue"}).click()
                await finishJourney(page)
                await expect(connectionRow(page, name)).toBeVisible({timeout: 30000})
            })

            await scenarios.when("the user tries to reuse it", async () => {
                const dialog = await startJourney(page, `${mockBaseUrl}/`, name)
                // Refused in the field rather than on submit: the name is the one thing the
                // person can fix where they are standing.
                await expect(dialog.getByText("already uses this name")).toBeVisible({
                    timeout: 20000,
                })
            })

            await scenarios.then("the journey stays on the name step", async () => {
                const dialog = journeyDialog(page)
                await expect(dialog.getByLabel("Connection name")).toBeVisible()
                await dialog.getByRole("button", {name: "Cancel"}).click()
            })
        },
    )

    test("keeps two connections to one server apart", {tag: tags}, async ({page, apiHelpers}) => {
        const first = uniqueName("Acme A")
        const second = uniqueName("Acme B")
        const basePath = apiHelpers.getProjectScopedBasePath()

        await scenarios.given("the user is on MCP settings", async () => {
            await openSettings(page, basePath)
        })

        await scenarios.when("the user connects the same URL twice", async () => {
            for (const name of [first, second]) {
                const dialog = await startJourney(page, `${mockBaseUrl}/`, name)
                await dialog.getByRole("button", {name: "Continue"}).click()
                await finishJourney(page)
                await expect(connectionRow(page, name)).toBeVisible({timeout: 30000})
            }
        })

        await scenarios.then("both are listed, each with its own name", async () => {
            // A URL is an address, not an account. Two connections to one server are two
            // connections, and the list has to let a person tell them apart.
            await expect(connectionRow(page, first)).toBeVisible()
            await expect(connectionRow(page, second)).toBeVisible()
        })
    })

    test("removes a connection, identity and all", {tag: tags}, async ({page, apiHelpers}) => {
        const name = uniqueName("Remove MCP")
        const basePath = apiHelpers.getProjectScopedBasePath()

        await scenarios.given("a connected server", async () => {
            await openSettings(page, basePath)
            const dialog = await startJourney(page, `${mockBaseUrl}/`, name)
            await dialog.getByRole("button", {name: "Continue"}).click()
            await finishJourney(page)
            await expect(connectionRow(page, name).getByText("Ready", {exact: true})).toBeVisible({
                timeout: 30000,
            })
        })

        await scenarios.when("the user removes it", async () => {
            const row = connectionRow(page, name)
            await row.getByRole("button").last().click()
            await page.getByRole("menuitem", {name: "Remove"}).click()
            // Removing takes the identity with it, which is why it confirms.
            await page
                .getByRole("button", {name: /Yes|Remove|Confirm/})
                .last()
                .click()
        })

        await scenarios.then("the connection is gone from the list", async () => {
            await expect(connectionRow(page, name)).toHaveCount(0, {timeout: 30000})
        })

        await scenarios.and("a server needing no authentication offers no Disconnect", async () => {
            // It holds no grant, and the route refuses a non-OAuth endpoint, so offering the
            // action would produce a 400 on a row that reads as connected.
            const other = uniqueName("No auth MCP")
            const dialog = await startJourney(page, `${mockBaseUrl}/`, other)
            await dialog.getByRole("button", {name: "Continue"}).click()
            await finishJourney(page)
            const row = connectionRow(page, other)
            await expect(row.getByText("Ready", {exact: true})).toBeVisible({timeout: 30000})
            await row.getByRole("button").last().click()
            await expect(page.getByRole("menuitem", {name: "Disconnect"})).toHaveCount(0)
            await page.keyboard.press("Escape")
        })
    })

    test("opens a connection to see its tools", {tag: tags}, async ({page, apiHelpers}) => {
        const name = uniqueName("Tools MCP")
        const basePath = apiHelpers.getProjectScopedBasePath()

        await scenarios.given("a connected server", async () => {
            await openSettings(page, basePath)
            const dialog = await startJourney(page, `${mockBaseUrl}/`, name)
            await dialog.getByRole("button", {name: "Continue"}).click()
            await finishJourney(page)
            await expect(connectionRow(page, name).getByText("Ready", {exact: true})).toBeVisible({
                timeout: 30000,
            })
        })

        await scenarios.when("the user opens it", async () => {
            await connectionRow(page, name).click()
        })

        await scenarios.then("its tools are listed, read-only", async () => {
            const detail = page.getByTestId("mcp-connection-detail")
            await expect(detail.getByText("Tools", {exact: true})).toBeVisible({timeout: 30000})
            // The mock advertises `echo`; permissions are the agent's business, so this view
            // says what exists and points at the agent configuration.
            await expect(detail.getByText("echo", {exact: true})).toBeVisible({timeout: 30000})
            await expect(
                detail.getByText("Choose what this server may do in an agent's configuration."),
            ).toBeVisible()
        })
    })

    test("authorizes a server that uses OAuth", {tag: tags}, async ({page, apiHelpers}) => {
        // Not a skip: the consent page is the half of this flow only a browser can prove, and
        // a run that quietly drops it is the failure mode D25 is about.
        if (!process.env.PLAYWRIGHT_HOST_RESOLVER_RULES) {
            throw new Error(
                "The authorization server publishes itself under the address the API dials, so " +
                    "the browser has to resolve that name too. Re-run with " +
                    `PLAYWRIGHT_HOST_RESOLVER_RULES="MAP ${new URL(mockBaseUrl).hostname} 127.0.0.1".`,
            )
        }
        const name = uniqueName("OAuth MCP")
        const basePath = apiHelpers.getProjectScopedBasePath()

        await scenarios.given("the user is on MCP settings", async () => {
            await openSettings(page, basePath)
        })

        await scenarios.when("the user connects the protected surface", async () => {
            const dialog = await startJourney(page, `${mockBaseUrl}${oauthPath}`, name)
            // Discovery read the challenge, so the journey knows it is OAuth before the
            // person commits to anything.
            await expect(dialog.getByText("uses OAuth")).toBeVisible()
            await dialog.getByRole("button", {name: "Continue"}).click()
        })

        await scenarios.and("the user grants the offered scopes", async () => {
            const dialog = journeyDialog(page)
            await expect(dialog.getByText("Choose which permissions to grant.")).toBeVisible({
                timeout: 30000,
            })
            await expect(dialog.getByText("tools:call", {exact: true})).toBeVisible()

            const popupPromise = page.waitForEvent("popup")
            await dialog.getByRole("button", {name: "Authorize"}).click()
            const popup = await popupPromise
            await expect(popup.getByText("The MCP server is connected.")).toBeVisible({
                timeout: 30000,
            })
            await finishJourney(page)
        })

        await scenarios.then("the connection is listed as ready", async () => {
            await expect(connectionRow(page, name).getByText("Ready", {exact: true})).toBeVisible({
                timeout: 30000,
            })
        })

        await scenarios.when("the user disconnects it", async () => {
            const row = connectionRow(page, name)
            await row.getByRole("button").last().click()
            await page.getByRole("menuitem", {name: "Disconnect"}).click()
            await page
                .getByRole("button", {name: /Yes|Disconnect|Confirm/})
                .last()
                .click()
        })

        await scenarios.then("the connection survives, asking to be authorized again", async () => {
            // Disconnecting takes the credential and leaves the connection, so one
            // Connect brings it back rather than making a new one.
            const row = connectionRow(page, name)
            await expect(row).toBeVisible()
            await expect(row.getByText("Needs authorization")).toBeVisible({
                timeout: 30000,
            })
        })
    })
}
