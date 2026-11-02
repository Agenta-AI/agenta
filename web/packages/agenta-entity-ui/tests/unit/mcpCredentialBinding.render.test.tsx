/**
 * The key screen's binding fields: Send as, Prefix, the preview line, and the Basic helper.
 *
 * Each case sets the fields and reads the fields and the preview back. The Basic helper
 * must hand the create drawer one value, base64 of `username:password`, and keep neither
 * half; the drawer is stubbed to see what it was given.
 */
import {act, createElement} from "react"

import {detectedAuthMode, type McpJourneyState} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {useMcpConnectJourney, drawerProps} = vi.hoisted(() => ({
    useMcpConnectJourney: vi.fn(),
    drawerProps: {current: null as null | Record<string, unknown>},
}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    useMcpConnectJourney,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => [],
    useSetAtom: () => async () => undefined,
}))

vi.mock("../../src/secret", () => ({
    CreateSecretDrawer: (props: Record<string, unknown>) => {
        drawerProps.current = props
        return null
    },
}))

import McpConnectJourney from "../../src/mcpEndpoint/McpConnectJourney"

class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

const DATAFORSEO_PROBE = {
    reachable: true,
    server_name: "mcp.dataforseo.com",
    auth: {mode: "oauth" as const, scopes_offered: [], challenge_schemes: ["Bearer"]},
}

const keyScreen: McpJourneyState = {
    status: "naming",
    url: "https://mcp.dataforseo.com/v3/mcp",
    name: "mcp.dataforseo.com",
    nameTouched: false,
    probe: DATAFORSEO_PROBE,
    savedUrlProbe: null,
    authMode: "api_key",
    authModeTouched: true,
    oauthOffered: detectedAuthMode(DATAFORSEO_PROBE) === "oauth",
    scopesOffered: [],
    scopesSelected: [],
    oauthClientId: "",
    oauthClientSecretId: null,
    oauthClientAuthMethod: null,
    savedOauthConfig: null,
    scopesSaved: null,
    endpointId: null,
    slug: null,
    createdHere: true,
    failureStatus: null,
    error: null,
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const open = async (state: McpJourneyState = keyScreen) => {
    useMcpConnectJourney.mockReturnValue({
        state,
        popupName: "mcp_consent",
        expectsConsent: false,
        setUrl: vi.fn(),
        editUrl: vi.fn(),
        submitUrl: vi.fn(),
        setName: vi.fn(),
        selectAuthMode: vi.fn(),
        submitName: vi.fn(),
        toggleScope: vi.fn(),
        submitScopes: vi.fn(),
        startScopeDiscovery: vi.fn(),
        submitManualCredential: vi.fn(),
        skipAuthentication: vi.fn(),
        finish: vi.fn(() => new Promise(() => undefined)),
        cancel: vi.fn(),
        cancelConsent: vi.fn(),
        retry: vi.fn(),
        abandonAttempt: vi.fn(),
    })
    await act(async () => {
        root.render(createElement(McpConnectJourney, {open: true, onClose: vi.fn()}))
    })
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ").trim()

const control = (label: string) =>
    document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null

const labelled = (label: string) => {
    const node = [...document.querySelectorAll("label")].find(
        (candidate) => candidate.textContent?.trim() === label,
    )
    const id = node?.getAttribute("for")
    return (id ? document.getElementById(id) : null) as HTMLInputElement | null
}

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label)

const press = async (label: string) => {
    await act(async () => {
        button(label)?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
}

/** Open a Radix select the way the keyboard does, then pick the option whose label starts here. */
const choose = async (trigger: Element | null, option: string) => {
    expect(trigger).toBeTruthy()
    await act(async () =>
        trigger!.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})),
    )
    const item = [...document.querySelectorAll('[role="option"]')].find((node) =>
        node.textContent?.startsWith(option),
    )
    expect(item).toBeTruthy()
    await act(async () => (item as HTMLElement).click())
}

const type = async (field: HTMLInputElement | null, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    await act(async () => {
        setter?.call(field, value)
        field?.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    drawerProps.current = null
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

describe("the binding fields", () => {
    it("starts a Bearer server at Authorization with Bearer, and previews it", async () => {
        await open()

        expect(control("Header name")?.value).toBe("Authorization")
        expect(control("Prefix")?.textContent).toBe("Bearer")
        expect(text()).toContain("Sent as Authorization: Bearer ••••.")
    })

    it("fills Basic, explains it, and shows the helper", async () => {
        await open()
        await choose(control("Prefix"), "Basic")

        expect(control("Header name")?.value).toBe("Authorization")
        expect(control("Prefix")?.textContent).toBe("Basic")
        expect(text()).toContain(
            "What goes in front of the secret. Basic expects username:password encoded once; the helper below does that.",
        )
        expect(text()).toContain("Sent as Authorization: Basic ••••.")
        expect(text()).toContain("Basic (username and password)")
        // The server asked for Bearer and the prefix now says Basic, so the screen says so.
        expect(text()).toContain("This server asked for the Bearer scheme.")
    })

    it("empties the name for a custom header and sends the bare value", async () => {
        await open()
        await choose(control("Prefix"), "None")
        await type(control("Header name"), "")

        expect(control("Header name")?.value).toBe("")
        expect(control("Prefix")?.textContent).toBe("None")
        expect(text()).not.toContain("Sent as")
        // A key cannot be sent under no name.
        expect(button("Connect")?.disabled).toBe(true)

        await type(control("Header name"), "CONTEXT7_API_KEY")

        expect(text()).toContain(
            "The secret is sent as the header value with nothing in front of it.",
        )
        expect(text()).toContain("Sent as CONTEXT7_API_KEY: ••••.")
    })

    it("sends a query parameter, named as one", async () => {
        await open()
        await choose(control("Send as"), "Query parameter")

        expect(control("Send as")?.textContent).toBe("Query parameter")
        expect(control("Header name")).toBeNull()
        // A query value takes no prefix, so there is nothing to pick.
        expect(control("Prefix")).toBeNull()
        await type(control("Parameter name"), "exaApiKey")

        expect(text()).toContain("Sent as ?exaApiKey=••••.")
        expect(text()).toContain(
            "The value is sent as this query parameter when the agent runs and is never shown again.",
        )
    })
})

describe("a refusal's headline, as a screen reader reads it", () => {
    it("starts the sentence after the headline with its space, in one text", async () => {
        // A browser leaves a space-only text out of the accessible description, so a space
        // on its own between the headline and the hint read "(401).This server".
        await open()
        const journey = useMcpConnectJourney.mock.results.at(-1)?.value
        useMcpConnectJourney.mockReturnValue({
            ...journey,
            state: {
                ...keyScreen,
                status: "verify_failed",
                endpointId: "mcp-1",
                failureStatus: 401,
                error: "",
            },
        })
        await act(async () => {
            root.render(createElement(McpConnectJourney, {open: true, onClose: vi.fn()}))
        })

        const headline = [...document.querySelectorAll("span")].find(
            (node) => node.textContent === "The server rejected this key (401).",
        )
        const sentence = headline?.nextSibling?.textContent ?? ""
        expect(sentence.startsWith(" ")).toBe(true)
        expect(sentence.trim()).not.toBe("")
        expect(`${headline?.textContent}${sentence}`).toMatch(/\(401\)\. \S/)
    })
})

describe("the Basic helper", () => {
    it("encodes username:password once and hands one value to the create drawer", async () => {
        await open()
        await choose(control("Prefix"), "Basic")

        expect(button("Create secret")?.disabled).toBe(true)
        await type(labelled("Username"), "login@example.com")
        await type(labelled("Password"), "test-password-one")
        await press("Create secret")

        expect(drawerProps.current?.open).toBe(true)
        expect(drawerProps.current?.nameSuffix).toBe("API_KEY")
        expect(drawerProps.current?.initialValue).toBe(btoa("login@example.com:test-password-one"))
        // Neither half is kept once the value is handed over.
        expect(labelled("Username")?.value).toBe("")
        expect(labelled("Password")?.value).toBe("")
    })

    it("refuses a colon in the username, which Basic would read as the end of it", async () => {
        await open()
        await choose(control("Prefix"), "Basic")

        await type(labelled("Username"), "team:user")
        await type(labelled("Password"), "test-password-one")

        expect(text()).toContain("A username cannot contain a colon.")
        expect(button("Create secret")?.disabled).toBe(true)
    })

    it("takes a colon in the password, which Basic keeps whole", async () => {
        await open()
        await choose(control("Prefix"), "Basic")

        await type(labelled("Username"), "team-user")
        await type(labelled("Password"), "pass:word")
        await press("Create secret")

        expect(text()).not.toContain("A username cannot contain a colon.")
        expect(drawerProps.current?.initialValue).toBe(btoa("team-user:pass:word"))
    })

    it("is not offered for any other prefix", async () => {
        await open()

        expect(text()).not.toContain("Basic (username and password)")
    })
})

describe("a key in the URL", () => {
    // Firecrawl takes the key as a path segment. The address was submitted with `{secret}`,
    // so nothing has been checked yet and the key screen is where it is checked.
    const firecrawl: McpJourneyState = {
        ...keyScreen,
        url: "https://mcp.firecrawl.dev/{secret}/v2/mcp",
        name: "mcp.firecrawl.dev",
        probe: null,
        oauthOffered: false,
    }

    it("starts on In the URL, with no name to fill and the address under it", async () => {
        await open(firecrawl)

        expect(control("Send as")?.textContent).toBe("In the URL")
        expect(control("Header name")).toBeNull()
        expect(control("Parameter name")).toBeNull()
        expect(control("Prefix")).toBeNull()
        expect(control("Server URL")?.value).toBe(firecrawl.url)
        expect(text()).toContain(
            "The secret replaces {secret} when Agenta calls the server. It is never stored in the URL.",
        )
        expect(text()).toContain(
            "The value is put into the address when the agent runs and is never shown again.",
        )
        expect(text()).not.toContain("Sent as")
    })

    it("claims nothing about an address it has not checked", async () => {
        await open(firecrawl)

        expect(document.querySelector('[data-testid="mcp-probe-result"]')).toBeNull()
    })

    it("says why None cannot connect a placeholder address", async () => {
        await open({...firecrawl, authMode: "none"})

        expect(text()).toContain(
            "Only an API key can replace {secret} in the URL. Choose API key, or remove {secret} from the URL.",
        )
        expect(button("Connect")?.disabled).toBe(true)
    })

    it("says why OAuth cannot connect a placeholder address", async () => {
        await open({...firecrawl, authMode: "oauth", oauthOffered: true})

        expect(text()).toContain(
            "Only an API key can replace {secret} in the URL. Choose API key, or remove {secret} from the URL.",
        )
    })

    it("says why an address with two placeholders cannot connect", async () => {
        await open({...firecrawl, url: "https://mcp.firecrawl.dev/{secret}/{secret}/mcp"})

        expect(text()).toContain(
            "The URL needs exactly one {secret} in its path for the secret to replace.",
        )
        expect(button("Connect")?.disabled).toBe(true)
    })

    it("asks for In the URL when another binding meets the placeholder", async () => {
        await open(firecrawl)
        await choose(control("Send as"), "Header")

        expect(text()).toContain(
            "This URL contains {secret}. Set Send as to In the URL so the secret replaces it.",
        )
        expect(button("Connect")?.disabled).toBe(true)
    })
})
