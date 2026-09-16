/**
 * The connect sheet's seven states, held one at a time, read for what they say.
 *
 * The copy IS the specification here. Every sentence below is the design's, and a reviewer
 * diffs the rendered text against it, so these assert whole sentences rather than the word
 * or two that happens to be unique: a half-rewritten line still says something plausible,
 * and that is exactly the failure this catches.
 *
 * The journey hook is stubbed, as in the seal suite: what is under test is what a state
 * looks like, not how it is reached. The dialog renders through a portal, so every query
 * goes to the document rather than to the host node.
 */
import {act, createElement} from "react"

import type {McpJourneyState, McpJourneyStatus} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {useMcpConnectJourney} = vi.hoisted(() => ({useMcpConnectJourney: vi.fn()}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    useMcpConnectJourney,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

const SECRETS = [{id: "sec-1", slug: "axiom_token", name: "axiom_token"}]

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => SECRETS,
    useSetAtom: () => async () => undefined,
}))

import McpConnectJourney, {
    type McpConnectJourneyProps,
} from "../../src/mcpEndpoint/McpConnectJourney"

/** jsdom has none, and the Radix select trigger measures itself on mount. */
class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const OAUTH_PROBE = {
    reachable: true,
    server_name: "Linear",
    auth: {mode: "oauth" as const, scopes_offered: ["read", "write"]},
}

const KEY_PROBE = {
    reachable: true,
    server_name: "Axiom",
    auth: {mode: "unknown" as const, scopes_offered: []},
}

const NO_AUTH_PROBE = {
    reachable: true,
    server_name: "Acme",
    auth: {mode: "none" as const, scopes_offered: []},
}

const state = (over: Partial<McpJourneyState> & {status: McpJourneyStatus}): McpJourneyState => ({
    url: "",
    name: "",
    nameTouched: false,
    probe: null,
    scopesOffered: [],
    scopesSelected: [],
    endpointId: null,
    slug: null,
    createdHere: true,
    tools: [],
    error: null,
    ...over,
})

/** The stub the last `open` handed the sheet, for the cases that assert what it was asked. */
let asked: Record<string, ReturnType<typeof vi.fn>>

const open = async (current: McpJourneyState, props: Partial<McpConnectJourneyProps> = {}) => {
    asked = {
        setUrl: vi.fn(),
        cancelConsent: vi.fn(),
        onClose: vi.fn(),
    }
    useMcpConnectJourney.mockReturnValue({
        state: current,
        popupName: "mcp_consent",
        expectsConsent: current.probe?.auth.mode === "oauth",
        setUrl: asked.setUrl,
        submitUrl: vi.fn(),
        loadTools: vi.fn(),
        setName: vi.fn(),
        submitName: vi.fn(),
        toggleScope: vi.fn(),
        submitScopes: vi.fn(),
        startScopeDiscovery: vi.fn(),
        submitManualCredential: vi.fn(),
        skipAuthentication: vi.fn(),
        finish: vi.fn(() => new Promise(() => undefined)),
        cancel: vi.fn(),
        cancelConsent: asked.cancelConsent,
        retry: vi.fn(),
        retryTools: vi.fn(),
        abandonAttempt: vi.fn(),
    })
    await act(async () => {
        root.render(createElement(McpConnectJourney, {open: true, onClose: vi.fn(), ...props}))
    })
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

/** Everything the dialog says, with the whitespace JSX leaves behind normalized away. */
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ").trim()

const control = (label: string) =>
    document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label)

const press = async (element: Element | undefined) => {
    await act(async () => {
        element?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    useMcpConnectJourney.mockReset()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
})

describe("C1, the address", () => {
    it("asks for one URL and says what will be done with it", async () => {
        await open(state({status: "url_entry", url: ""}))

        expect(text()).toContain("Connect MCP server")
        expect(text()).toContain(
            "The server's HTTP endpoint. Agenta checks it and detects whether it needs OAuth, an API key, or nothing.",
        )
        expect(control("Server URL")?.getAttribute("placeholder")).toBe(
            "https://mcp.example.com/mcp",
        )
        expect(button("Cancel")).toBeDefined()
        expect(button("Continue")).toBeDefined()
    })

    it("holds Continue until the address is one a check can be pointed at", async () => {
        await open(state({status: "url_entry", url: "mcp.example.com"}))
        expect(button("Continue")?.disabled).toBe(true)

        await open(state({status: "url_entry", url: " https://mcp.example.com/mcp "}))
        expect(button("Continue")?.disabled).toBe(false)
    })
})

describe("C2, the address refused", () => {
    const failed = (cause: string, message: string) =>
        state({
            status: "check_failed",
            url: "https://mcp.internal.acme.dev/sse",
            error: message,
            probe: {
                reachable: false,
                auth: {mode: "unknown", scopes_offered: []},
                problem: {cause, message},
            },
        })

    it("keeps what was typed, flags the field, and explains what to check", async () => {
        await open(failed("unreachable", "No MCP response from mcp.internal.acme.dev."))

        expect((control("Server URL") as HTMLInputElement).value).toBe(
            "https://mcp.internal.acme.dev/sse",
        )
        expect(control("Server URL")?.getAttribute("aria-invalid")).toBe("true")
        expect(text()).toContain(
            "Couldn't reach this server. No MCP response from mcp.internal.acme.dev. Check the address and that the server speaks HTTP transport. Private-network servers must be reachable from Agenta.",
        )
        expect(button("Try again")).toBeDefined()
        // The line explaining what the field is for has had its turn. What to read now is
        // the box saying why this address did not work.
        expect(text()).not.toContain("Agenta checks it and detects")
    })

    it("offers the raw answer only when the check carried one", async () => {
        // The probe returns a cause and a sentence and no body, so the control is absent
        // everywhere in the product today. It appears the moment a response is carried,
        // which is the seam the data layer left for it.
        await open(failed("unreachable", "No MCP response from mcp.internal.acme.dev."))
        expect(button("Show response")).toBeUndefined()

        const carried = failed("unreachable", "No MCP response.")
        await open(
            state({
                ...carried,
                probe: {
                    ...carried.probe!,
                    problem: {
                        cause: "unreachable",
                        message: "No MCP response.",
                        response: {status: "502 Bad Gateway", body: "upstream refused"},
                    } as NonNullable<NonNullable<McpJourneyState["probe"]>["problem"]>,
                },
            }),
        )
        expect(button("Show response")).toBeDefined()
    })

    it("says something else when the address answered and was not a server", async () => {
        // Advice about reachability is wrong here: the address was reached. Both causes
        // wearing one headline is how a person is sent to check a firewall that is fine.
        await open(
            failed(
                "not_an_mcp_server",
                "The address answered, but not with an MCP handshake (HTTP 200).",
            ),
        )

        expect(text()).toContain(
            "Reached the address, but it isn't an MCP server. The address answered, but not with an MCP handshake (HTTP 200).",
        )
        expect(text()).not.toContain("Private-network servers must be reachable")
    })
})

describe("C3, the server signs in with OAuth", () => {
    const naming = state({
        status: "naming",
        url: "https://mcp.linear.app/mcp",
        name: "Linear",
        probe: OAUTH_PROBE,
    })

    it("shows what was found, what it will be called, and what Connect will do", async () => {
        await open(naming)

        expect(text()).toContain("https://mcp.linear.app/mcp")
        expect(text()).toContain("Reachable · signs in with OAuth")
        expect(text()).toContain("Change")
        expect(text()).toContain("Shown across this project. Tools are prefixed Linear_")
        expect(text()).toContain(
            "Connect opens Linear's authorization page in a new window; Linear asks which permissions to grant (usually read and write). The login is stored for this project only.",
        )
        expect(button("Connect")).toBeDefined()
    })

    it("sends Change back to the address with it kept", async () => {
        // Retyping an address to correct one character in it is how a person ends up
        // connecting a different server than the one they meant.
        await open(naming)
        await press(button("Change"))

        expect(asked.setUrl).toHaveBeenCalledWith("https://mcp.linear.app/mcp")
    })

    it("opens a new window when the first attempt is retried", async () => {
        // The window opened for the first press was closed when the failure replaced the
        // wait. A retry that reuses the closed handle points a provider at nothing, and a
        // browser refuses a window opened after the create has resolved.
        const opened = vi.fn(() => ({closed: false, close: vi.fn(), focus: vi.fn()}))
        vi.stubGlobal("open", opened)
        await open(
            state({
                status: "create_failed",
                url: "https://mcp.linear.app/mcp",
                name: "Linear",
                probe: OAUTH_PROBE,
                error: "The connection could not be saved.",
            }),
        )
        await press(button("Try again"))

        expect(opened).toHaveBeenCalledOnce()
    })

    it("asks nobody to choose scopes", async () => {
        // They are the server's business, and the checklist this replaces asked a question
        // whose answer nobody outside the provider's documentation could know.
        await open(naming)

        expect(text()).not.toContain("Choose which permissions to grant")
    })
})

describe("C4, the provider's window", () => {
    it("says whose window it is and how it ends, and offers no action row", async () => {
        await open(
            state({
                status: "awaiting_consent",
                url: "https://mcp.linear.app/mcp",
                name: "Linear",
                probe: OAUTH_PROBE,
                endpointId: "mcp-1",
            }),
        )

        // The wait only renders once the window has been asked for, which on this screen is
        // the press that got here.
        expect(text()).toContain("Waiting for Linear…")
        expect(text()).toContain(
            "Finish signing in in the window that opened. This closes on its own when you're done.",
        )
        expect(button("Open the window again")).toBeDefined()
        expect(button("Connect")).toBeUndefined()
    })

    it("abandons one attempt on Cancel without closing what was typed", async () => {
        // Cancelling the provider's window gives up on an attempt, not on the connection.
        // Closing the sheet here would make a closed sign-in cost the address and the name
        // as well.
        await open(
            state({
                status: "awaiting_consent",
                url: "https://mcp.linear.app/mcp",
                name: "Linear",
                probe: OAUTH_PROBE,
                endpointId: "mcp-1",
            }),
        )
        await press(button("Cancel"))

        expect(asked.cancelConsent).toHaveBeenCalled()
        expect(asked.onClose).not.toHaveBeenCalled()
    })

    it("reports a refusal without claiming anything was saved", async () => {
        await open(
            state({
                status: "consent_cancelled",
                url: "https://mcp.linear.app/mcp",
                name: "Linear",
                probe: OAUTH_PROBE,
                endpointId: "mcp-1",
                error: "Authorization window closed before completion.",
            }),
        )

        expect(text()).toContain(
            "Linear didn't authorize Agenta. The sign-in was cancelled or denied. Nothing was saved.",
        )
        expect(button("Try again")).toBeDefined()
        expect(button("Cancel")).toBeDefined()
    })
})

describe("C5, the server wants a key", () => {
    const keyScreen = state({
        status: "naming",
        url: "https://mcp.axiom.co/mcp",
        name: "Axiom",
        probe: KEY_PROBE,
    })

    it("names the header and the secret, and says where the value goes", async () => {
        await open(keyScreen)

        expect(text()).toContain("Reachable · needs an API key")
        expect((control("Header") as HTMLInputElement).value).toBe("Authorization")
        expect(control("Project secret")).toBeTruthy()
        expect(text()).toContain(
            "Pick a project secret or create one. The value is sent as this header when the agent runs and is never shown again.",
        )
    })

    it("cannot connect until a secret is chosen", async () => {
        await open(keyScreen)

        expect(button("Connect")?.disabled).toBe(true)
    })

    it("shows a server that wants nothing only the card and the name", async () => {
        await open(
            state({
                status: "naming",
                url: "https://mcp.acme.test/mcp",
                name: "Acme",
                probe: NO_AUTH_PROBE,
            }),
        )

        expect(text()).toContain("Reachable · no sign-in needed")
        expect(control("Header")).toBeNull()
        expect(button("Connect")?.disabled).toBe(false)
    })
})

describe("C6, the key was refused", () => {
    const rejected = state({
        status: "verify_failed",
        url: "https://mcp.axiom.co/mcp",
        name: "Axiom",
        probe: KEY_PROBE,
        endpointId: "mcp-1",
        slug: "axiom",
        error: "The server rejected the credential (401).",
    })

    it("flags both credential fields and relabels the action", async () => {
        await open(rejected)

        expect(control("Header")?.getAttribute("aria-invalid")).toBe("true")
        expect(control("Project secret")?.getAttribute("aria-invalid")).toBe("true")
        expect(text()).toContain(
            "The server rejected this key. The server rejected the credential (401). Check the header the server expects, or pick another secret.",
        )
        expect(button("Try again")).toBeDefined()
    })

    it("is the same sheet a key connection reconnects through, with nothing re-decided", async () => {
        await open(
            state({
                status: "manual_auth",
                url: "https://mcp.axiom.co/mcp",
                name: "Axiom",
                endpointId: "mcp-9",
                slug: "axiom",
                createdHere: false,
            }),
            {
                reconnect: {
                    id: "mcp-9",
                    slug: "axiom",
                    name: "Axiom",
                    url: "https://mcp.axiom.co/mcp",
                    authMode: "api_key",
                },
            },
        )

        expect(text()).toContain("Reconnect MCP server")
        // The address and the label are this connection's already. Editing either here
        // would repoint or rename a server agents are pointing at.
        expect((control("Name") as HTMLInputElement).disabled).toBe(true)
        expect(button("Change")).toBeUndefined()
        expect(control("Header")).toBeTruthy()
    })
})
