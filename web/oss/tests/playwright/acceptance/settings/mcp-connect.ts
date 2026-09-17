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
                await expect(dialog.getByText("Reachable · no sign-in needed")).toBeVisible()
                await dialog.getByRole("button", {name: "Connect", exact: true}).click()
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
                    await dialog.getByLabel("Server URL").fill(`${mockMcpBase()}/`)
                    await dialog.getByRole("button", {name: "Continue"}).click()

                    const nameField = dialog.getByLabel("Name", {exact: true})
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

                // The SERVER's refusal is what this case exists to exercise, and both checks
                // now say the same sentence (decision 15), so the copy alone cannot tell
                // whether the request was ever made. The response is what can: a create that
                // reaches the API and comes back 409 is the refusal, and a journey that
                // reports success afterwards has taken over somebody else's connection
                // instead of refusing it (round 6, D-R6-3).
                const refused = page.waitForResponse(
                    (response) =>
                        response.request().method() === "POST" &&
                        new URL(response.url()).pathname.endsWith("/gateways/mcps/endpoints/") &&
                        response.status() === 409,
                    {timeout: PROBE_MS},
                )
                await dialog.getByRole("button", {name: "Connect", exact: true}).click()
                await refused

                const refusal = dialog.getByText(
                    "Give this connection a name no other one in the project uses.",
                )
                await expect(refusal).toBeVisible({timeout: PROBE_MS})
                // Said once rather than twice: the field error and a generic paragraph both
                // rendering it is what D39 was about.
                await expect(dialog.getByText("already uses this name")).toHaveCount(1)
                // Nothing was connected: a success screen here is the defect this case caught.
                await expect(dialog.getByText("is connected.")).toHaveCount(0)
            })

            await scenarios.then("the journey stays on the name step", async () => {
                const dialog = journeyDialog(page)
                await expect(dialog.getByLabel("Name", {exact: true})).toBeVisible()
                await expect(dialog.getByLabel("Name", {exact: true})).toHaveValue(name)
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
                await dialog.getByRole("button", {name: "Connect", exact: true}).click()
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
            const dialog = await startJourney(page, `${mockMcpBase()}/`, name)
            await dialog.getByRole("button", {name: "Connect", exact: true}).click()
            await finishJourney(page)
            await expect(
                connectionRow(page, name).getByText("Connected", {exact: true}),
            ).toBeVisible({
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
            const dialog = await startJourney(page, `${mockMcpBase()}/`, other)
            await dialog.getByRole("button", {name: "Connect", exact: true}).click()
            await finishJourney(page)
            const row = connectionRow(page, other)
            await expect(row.getByText("Connected", {exact: true})).toBeVisible({timeout: 30000})
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
            const dialog = await startJourney(page, `${mockMcpBase()}/`, name)
            await dialog.getByRole("button", {name: "Connect", exact: true}).click()
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

        // Opened by the Connect press below and awaited two steps later, which is the point
        // of this case: the window is opened inside the tap, before the row exists and
        // before the authorization URL has been minted, because a browser refuses one
        // opened after a promise has resolved.
        let popupPromise: Promise<Page>

        await scenarios.when("the user connects the protected surface", async () => {
            const dialog = await startJourney(page, `${mockMcpBase()}${mcpOauthPath}`, name)
            // The check read the challenge, so the sheet knows it is OAuth before the person
            // commits to anything.
            await expect(dialog.getByText("Reachable · signs in with OAuth")).toBeVisible()
            popupPromise = page.waitForEvent("popup")
            await dialog.getByRole("button", {name: "Connect", exact: true}).click()
        })

        await scenarios.and("the provider's window completes the sign-in", async () => {
            // Nobody is asked which scopes to grant: everything the server offered is asked
            // for, because which of them to grant is the server's business. Pinned by the
            // wait the sheet goes to instead, because the checklist's headline was retired
            // with it and counting a string that exists nowhere passes either way.
            await expect(journeyDialog(page).getByText(`Waiting for ${name}…`)).toBeVisible({
                timeout: 30000,
            })

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
            await page
                .getByRole("button", {name: /Yes|Disconnect|Confirm/})
                .last()
                .click()
        })

        await scenarios.then("the connection survives, asking to be authorized again", async () => {
            // Disconnecting takes the credential and leaves the connection, so one
            // Connect brings it back rather than making a new one.
            //
            // "Login expired", not the record's own "Needs authorization": a list says whether
            // a connection works, and a revoked grant and a refused key are the same sentence
            // to whoever is scanning the table.
            const row = connectionRow(page, name)
            await expect(row).toBeVisible()
            await expect(row.getByText("Login expired")).toBeVisible({
                timeout: 30000,
            })
        })
    })
}
