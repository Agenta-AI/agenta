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
 * The environment facts this suite depends on, and the steps it shares with the agent
 * configuration suite, live in ../utils/mcpConnections.
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
import {
    createMcpConnectionViaApi,
    fillJourneyUrlAndName,
    finishJourney,
    journeyDialog,
    mcpOauthPath,
    mockMcpBase,
    mockNeedsHostMapping,
    navigate,
    PROBE_MS,
    requireMockMcpUpstream,
    ROUTE_WARMUP_MS,
    uniqueName,
} from "../utils/mcpConnections"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const scenarios = createScenarios(test)

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

/** Whether this worker has already paid for the settings route to compile. */
let settingsWarmed = false

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

/** Open the journey from the settings header and drive it to the name step. */
const startJourney = async (page: Page, url: string, name: string) => {
    await page.getByRole("button", {name: "Connect MCP"}).first().click()
    return fillJourneyUrlAndName(page, url, name)
}

export const mcpConnectAcceptanceTests = (license: TestLicenseType) => () => {
    const tags = createTags(license)

    // One reachability check for the whole suite, so a stack without the mock upstream fails
    // in one place with a sentence naming what to start, rather than seven times with a
    // sixty-second timeout apiece.
    test.beforeAll(requireMockMcpUpstream)

    test.beforeEach(async ({page}) => {
        // Every case here waits on the API dialing a third party, and the OAuth one waits on
        // discovery and a consent page besides. The suite-wide minute is meant for a page of
        // clicks and is the wrong budget for that: it was cutting the OAuth case off mid-probe.
        test.setTimeout(180_000)
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
                const dialog = await startJourney(page, `${mockMcpBase()}/`, name)
                // The probe reached the server and read what it needs, so the journey says
                // so before asking for anything else.
                await expect(dialog.getByText("needs no authentication")).toBeVisible()
                await dialog.getByRole("button", {name: "Continue"}).click()
                await finishJourney(page)
            })

            await scenarios.then("the connection is listed as ready", async () => {
                const row = connectionRow(page, name)
                await expect(row).toBeVisible({timeout: 30000})
                await expect(row.getByText("Connected", {exact: true})).toBeVisible({
                    timeout: 30000,
                })
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
                    await dialog.getByLabel("MCP server URL").fill(`${mockMcpBase()}/`)
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

            await scenarios.given("the page is open before the name is taken", async () => {
                await openSettings(page, basePath)
            })

            await scenarios.and("another connection takes it", async () => {
                // Out of band on purpose: a page that already knows about the collision
                // refuses the name from its own list and never asks the server.
                await createMcpConnectionViaApi(page, basePath, name)
            })

            await scenarios.when("the user submits that name", async () => {
                const dialog = await startJourney(page, `${mockMcpBase()}/`, name)
                await dialog.getByRole("button", {name: "Continue"}).click()

                // The SERVER's refusal, which is the one this case exists to exercise. The
                // client refuses a collision it can see in its own list, and both sentences
                // open the same way, so matching on the opening proves only that something
                // refused: the case passed identically whether or not the request was ever
                // made (D51). The next step is the server's alone.
                const refusal = dialog.getByText(
                    "Give this connection a name no other one in the project uses.",
                )
                await expect(refusal).toBeVisible({timeout: PROBE_MS})
                // Said once rather than twice: the field error and a generic paragraph both
                // rendering it is what D39 was about.
                await expect(dialog.getByText("already uses this name")).toHaveCount(1)
            })

            await scenarios.then("the journey stays on the name step", async () => {
                const dialog = journeyDialog(page)
                await expect(dialog.getByLabel("Connection name")).toBeVisible()
                await expect(dialog.getByLabel("Connection name")).toHaveValue(name)
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
                const dialog = await startJourney(page, `${mockMcpBase()}/`, name)
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

    test("disconnects a connection, identity and all", {tag: tags}, async ({page, apiHelpers}) => {
        const name = uniqueName("Disconnect MCP")
        const basePath = apiHelpers.getProjectScopedBasePath()

        await scenarios.given("a connected server", async () => {
            await openSettings(page, basePath)
            const dialog = await startJourney(page, `${mockMcpBase()}/`, name)
            await dialog.getByRole("button", {name: "Continue"}).click()
            await finishJourney(page)
            await expect(
                connectionRow(page, name).getByText("Connected", {exact: true}),
            ).toBeVisible({
                timeout: 30000,
            })
        })

        await scenarios.when("the user disconnects it", async () => {
            const row = connectionRow(page, name)
            await row.getByRole("button").last().click()
            await page.getByRole("menuitem", {name: "Disconnect"}).click()
            // The button names the act rather than answering "Yes", because the dialog has
            // covered the menu the verb was chosen from.
            await page.getByRole("button", {name: "Disconnect"}).last().click()
        })

        await scenarios.then("the connection is gone from the list", async () => {
            await expect(connectionRow(page, name)).toHaveCount(0, {timeout: 30000})
        })

        await scenarios.and(
            "a server needing no authentication can be disconnected too",
            async () => {
                // This row holds no grant to revoke. Disconnect used to be hidden on it for that
                // reason; it ends the connection now rather than revoking a token, so every row
                // offers it and a no-auth server is no longer a dead end.
                const other = uniqueName("No auth MCP")
                const dialog = await startJourney(page, `${mockMcpBase()}/`, other)
                await dialog.getByRole("button", {name: "Continue"}).click()
                await finishJourney(page)
                const row = connectionRow(page, other)
                await expect(row.getByText("Connected", {exact: true})).toBeVisible({
                    timeout: 30000,
                })
                await row.getByRole("button").last().click()
                await page.getByRole("menuitem", {name: "Disconnect"}).click()
                await page.getByRole("button", {name: "Disconnect"}).last().click()
                await expect(connectionRow(page, other)).toHaveCount(0, {timeout: 30000})
            },
        )

        await scenarios.and("the row menu offers no second destructive verb", async () => {
            // One way to end a connection, not two. "Remove" was the other one and its
            // difference from Disconnect was never legible on the row.
            const third = uniqueName("One verb MCP")
            const dialog = await startJourney(page, `${mockMcpBase()}/`, third)
            await dialog.getByRole("button", {name: "Continue"}).click()
            await finishJourney(page)
            const row = connectionRow(page, third)
            await expect(row.getByText("Connected", {exact: true})).toBeVisible({timeout: 30000})
            await row.getByRole("button").last().click()
            await expect(page.getByRole("menuitem", {name: "Remove"})).toHaveCount(0)
            await expect(page.getByRole("menuitem", {name: "Disconnect"})).toHaveCount(1)
            await page.keyboard.press("Escape")
            // Left connected on purpose: the suite's own cleanup removes it, and a row that
            // survives this case proves Escape dismissed the menu without acting.
        })
    })

    test("opens a connection to see its tools", {tag: tags}, async ({page, apiHelpers}) => {
        const name = uniqueName("Tools MCP")
        const basePath = apiHelpers.getProjectScopedBasePath()

        await scenarios.given("a connected server", async () => {
            await openSettings(page, basePath)
            const dialog = await startJourney(page, `${mockMcpBase()}/`, name)
            await dialog.getByRole("button", {name: "Continue"}).click()
            await finishJourney(page)
            await expect(
                connectionRow(page, name).getByText("Connected", {exact: true}),
            ).toBeVisible({
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
            // A tool name the server advertised, not a sentence this page would render
            // whatever the server said (D39). The mock advertises echo, fail and slow.
            await expect(detail.getByText("echo", {exact: true})).toBeVisible({timeout: PROBE_MS})
            await expect(detail.getByText("fail", {exact: true})).toBeVisible()
        })
    })

    test("authorizes a server that uses OAuth", {tag: tags}, async ({page, apiHelpers}) => {
        // Not a skip: the consent page is the half of this flow only a browser can prove, and
        // a run that quietly drops it is the failure mode D25 is about.
        //
        // The mapping is asked for only when the mock is reachable by a compose name alone. A
        // stack that publishes it on a public address needs nothing, and demanding the mapping
        // there refused a run that was going to work (D53).
        if (mockNeedsHostMapping() && !process.env.PLAYWRIGHT_HOST_RESOLVER_RULES) {
            throw new Error(
                "The authorization server publishes itself under the address the API dials, so " +
                    "the browser has to resolve that name too. Either publish the mock on an " +
                    "address a browser can reach, or re-run with " +
                    `PLAYWRIGHT_HOST_RESOLVER_RULES="MAP ${new URL(mockMcpBase()).hostname} 127.0.0.1".`,
            )
        }
        const name = uniqueName("OAuth MCP")
        const basePath = apiHelpers.getProjectScopedBasePath()

        await scenarios.given("the user is on MCP settings", async () => {
            await openSettings(page, basePath)
        })

        await scenarios.when("the user connects the protected surface", async () => {
            const dialog = await startJourney(page, `${mockMcpBase()}${mcpOauthPath}`, name)
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
            await expect(
                connectionRow(page, name).getByText("Connected", {exact: true}),
            ).toBeVisible({
                timeout: 30000,
            })
        })

        await scenarios.when("the user disconnects it", async () => {
            const row = connectionRow(page, name)
            await row.getByRole("button").last().click()
            await page.getByRole("menuitem", {name: "Disconnect"}).click()
            await page.getByRole("button", {name: "Disconnect"}).last().click()
        })

        await scenarios.then("the connection is gone from the project", async () => {
            // Disconnect ends the connection; it does not strip the credential and keep the
            // row. The revoke route still exists on the API and no surface calls it, which is
            // recorded against the redesign rather than asserted here.
            await expect(connectionRow(page, name)).toHaveCount(0, {timeout: 30000})
        })
    })
}
