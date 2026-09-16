/**
 * What every browser test of the MCP connect journey needs, in one place.
 *
 * Two suites drive this journey: settings, where a connection is managed, and the agent
 * configuration, where one is chosen. They open it from different buttons and then do the same
 * things to it, so the steps live here and only the entry points differ.
 *
 * Two environment facts these suites depend on, both gated rather than assumed:
 *
 * - The issuer publishes itself under the address the API dials, which on a compose stack is a
 *   container name. The browser has to resolve that same name, which is what
 *   `PLAYWRIGHT_HOST_RESOLVER_RULES=MAP mock-mcp-gateway 127.0.0.1` is for.
 * - The mock upstream only exists while `AGENTA_GATEWAYS_MOCKS_ENABLED` is on.
 */
import {expect} from "@agenta/web-tests/utils"
import type {Page} from "@playwright/test"

/**
 * The mock as it is reachable inside the compose network, which is the last resort.
 *
 * Defaulted rather than gated. These suites used to skip whenever the variable was unset, and it
 * was set nowhere in the repository, so the only end-to-end coverage this feature has never ran
 * and every run reported green (D25). They run by default now and say what is missing when they
 * cannot run, because a skipped suite that reads as a passing one is worse than a red one.
 */
const composeMockBase = "http://mock-mcp-gateway:9092"

/** Discovered once per worker by `requireMockMcpUpstream`. */
let publishedBase: string | null = null

/**
 * The address to register connections at, and the one a browser has to reach.
 *
 * A stack that means to be driven by a browser publishes the mock under an address a browser can
 * resolve, and the issuer then advertises itself there. Discovery refuses a server whose origin
 * differs from the resource its own metadata names, so a connection registered at the container
 * name is refused on exactly the stack that can run the consent flow (D53). Asking the mock which
 * address it publishes keeps the two in step without this process being told anything, and is the
 * same question `api/oss/tests/pytest/acceptance/gateways` asks.
 */
export const mockMcpBase = (): string =>
    (process.env.AGENTA_MOCK_MCP_GATEWAY_URL || publishedBase || composeMockBase).replace(/\/$/, "")

/**
 * Whether the browser needs a host mapping to reach the mock.
 *
 * A compose service name is a single label with no dot in it, and nothing outside that network
 * resolves it. Anything else — a public domain, an address — the browser reaches on its own, and
 * asking for a mapping there would refuse a run that was going to work.
 */
export const mockNeedsHostMapping = (): boolean => {
    const {hostname} = new URL(mockMcpBase())
    return !hostname.includes(".") && hostname !== "localhost"
}

/** The same container as the test process sees it, which is where the reachability check goes. */
export const publishedMockMcpUrl = (
    process.env.AGENTA_MOCK_MCP_GATEWAY_PUBLISHED_URL || "http://127.0.0.1:9092"
).replace(/\/$/, "")

/** Its OAuth-protected surface. `/` stays open so the no-auth cases have something to use. */
export const mcpOauthPath = process.env.AGENTA_MCP_OAUTH_ACCEPTANCE_PATH || "/oauth/mcp"

/** How long a probe of a server the API has to dial may take. */
export const PROBE_MS = 45_000

/** How long a route may take the first time a worker asks for it. */
export const ROUTE_WARMUP_MS = 90_000

/** A name no other run shares, so a duplicate refusal is the test's own doing. */
export const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}${Math.floor(Math.random() * 1000)}`

/**
 * Fail once, with a sentence naming what to start, if the mock upstream is not there.
 *
 * Called from `beforeAll` so a stack without it reports one actionable failure rather than a
 * sixty-second timeout per case.
 */
export const requireMockMcpUpstream = async (): Promise<void> => {
    let reachable = false
    try {
        const response = await fetch(publishedMockMcpUrl, {
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
            `The MCP mock upstream did not answer at ${publishedMockMcpUrl}. This suite needs a ` +
                "stack running the gateway mocks: bring one up with AGENTA_GATEWAYS_MOCKS_ENABLED=true, " +
                "and set AGENTA_MOCK_MCP_GATEWAY_PUBLISHED_URL if it is published somewhere else.",
        )
    }
    publishedBase = await readPublishedBase()
}

/**
 * The address the mock publishes ITSELF under, asked of the mock.
 *
 * Its protected-resource document names the resource in full, so the base is that minus the
 * protected path. Null whenever the document cannot be read or does not name what was asked for,
 * which leaves the compose address in place: a stack with no published address can still run
 * every case that does not need a browser to reach the server.
 */
const readPublishedBase = async (): Promise<string | null> => {
    try {
        const response = await fetch(
            `${publishedMockMcpUrl}/.well-known/oauth-protected-resource${mcpOauthPath}`,
            {signal: AbortSignal.timeout(10000)},
        )
        if (!response.ok) return null
        const document = (await response.json()) as {resource?: unknown}
        const resource = typeof document.resource === "string" ? document.resource : ""
        if (!resource.endsWith(mcpOauthPath)) return null
        return resource.slice(0, -mcpOauthPath.length)
    } catch {
        return null
    }
}

/**
 * Go to a page, tolerating the two ways a navigation fails for reasons that are not the page.
 *
 * A `goto` issued while an earlier one is still settling cancels that one, and Playwright
 * surfaces the cancellation as an error on the call that caused it rather than on the navigation
 * that lost. Nothing is wrong when that happens, and the assertion that follows is what decides
 * whether the page arrived (D49).
 *
 * The other is the transport. A tunnelled stack drops connections whenever the tunnel
 * re-establishes, and the browser reports that as the network having changed under it, or lands
 * on its own error page. None of these suites is about the tunnel, so the address is asked for a
 * few times before the failure is believed.
 */
const TRANSPORT_FAILURES = [
    "ERR_NETWORK_CHANGED",
    "ERR_CONNECTION_CLOSED",
    "ERR_CONNECTION_RESET",
    "ERR_EMPTY_RESPONSE",
    "chrome-error://chromewebdata",
]

export const navigate = async (page: Page, url: string): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
        try {
            await page.goto(url, {waitUntil: "domcontentloaded"})
            await hideDevOverlay(page)
            return
        } catch (error) {
            const text = String(error)
            if (text.includes("ERR_ABORTED")) return
            const transport = TRANSPORT_FAILURES.some((failure) => text.includes(failure))
            if (!transport || attempt >= 3) throw error
            await page.waitForTimeout(2000)
        }
    }
}

/**
 * Take the development server's error overlay out of the way of the pointer.
 *
 * `nextjs-portal` is a full-viewport element the dev server mounts for its own warnings, and it
 * swallows clicks meant for the dialog underneath: a run failed on a Continue button that was
 * visible, enabled and stable, with the overlay named as the thing that intercepted it. It does
 * not exist in a production build, so this is a no-op everywhere else. Anything it was reporting
 * is still in the console log the run captures.
 */
const hideDevOverlay = async (page: Page): Promise<void> => {
    await page
        .addStyleTag({content: "nextjs-portal{display:none!important}"})
        .catch(() => undefined)
}

export const apiBaseUrl = (): string =>
    process.env.AGENTA_API_URL || `${process.env.AGENTA_WEB_URL}/api`

export const projectIdFrom = (basePath: string): string => basePath.match(/\/p\/([^/]+)/)?.[1] ?? ""

/**
 * Create a connection through the API, without the open page hearing about it.
 *
 * Settings uses it to take a name behind the page's back, which is the only way the API's own
 * duplicate refusal is ever exercised (D39). The agent-configuration suite uses it as a fixture:
 * the connection it picks is not the subject of that test, so making one through the journey
 * would only add a way for it to fail.
 */
export const createMcpConnectionViaApi = async (
    page: Page,
    basePath: string,
    name: string,
): Promise<{id: string; slug: string}> => {
    const response = await page.request.post(
        `${apiBaseUrl()}/gateways/mcps/endpoints/?project_id=${projectIdFrom(basePath)}`,
        {
            data: {
                endpoint: {
                    name,
                    auth_mode: "none",
                    data: {route: {base_url: `${mockMcpBase()}/`}},
                },
            },
        },
    )
    expect(response.ok(), await response.text()).toBe(true)
    const body = (await response.json()) as {endpoint: {id: string; slug: string}}
    return body.endpoint
}

/**
 * The connect journey's own dialog.
 *
 * Addressed as the dialog CONTAINING the journey's test id, not `getByRole("dialog").last()`:
 * the surfaces that open it also mount drawers, which are dialogs too, so "the last one" is
 * whichever the DOM happens to order last. This is the case a test id is for — the element has no
 * accessible name that tells it apart. The id marks the journey's fields, while the footer
 * buttons are its siblings, so the handle has to be the dialog around both.
 */
export const journeyDialog = (page: Page) =>
    page.locator('[role="dialog"]:has([data-testid="mcp-connect-journey"])')

/**
 * Drive an already-open journey as far as the name step, which every path shares.
 *
 * The step between the two Continues is a probe: the API dials the server and reads what it
 * answers. That is a round trip to a third party, so it gets its own budget rather than the
 * default one meant for a render.
 */
export const fillJourneyUrlAndName = async (page: Page, url: string, name: string) => {
    const dialog = journeyDialog(page)
    await dialog.getByLabel("MCP server URL").fill(url)
    await dialog.getByRole("button", {name: "Continue"}).click()

    const nameField = dialog.getByLabel("Connection name")
    await expect(nameField).toBeVisible({timeout: PROBE_MS})
    await nameField.fill(name)
    return dialog
}

/**
 * Close a journey that reached its connected state.
 *
 * It stays open on purpose, reporting what was connected; whatever the test does next is behind
 * it, so every case that connects has to finish the journey first.
 */
export const finishJourney = async (page: Page): Promise<void> => {
    const dialog = journeyDialog(page)
    await expect(dialog.getByText("is connected.")).toBeVisible({timeout: 60000})
    await dialog.getByRole("button", {name: "Done"}).click()
    await expect(dialog).toHaveCount(0, {timeout: 20000})
}
