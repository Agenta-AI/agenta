/**
 * The connect sheet's six states, held one at a time, read for what they say.
 *
 * Six, because success is not one of them: the sheet closes when the connection is real and
 * the new row is the whole of the feedback (decision 26). The last describe here pins that
 * the seventh screen is gone rather than merely unreachable.
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

/** The same answer, from a server whose challenge named a scheme Authorization does not carry. */
const KEY_PROBE_WITH_SCHEME = {
    ...KEY_PROBE,
    auth: {...KEY_PROBE.auth, challenge_status: 401, challenge_schemes: ["DSN"]},
}

/** And one that named Bearer, which is the value this product already sends. */
const KEY_PROBE_BEARER = {
    ...KEY_PROBE,
    auth: {...KEY_PROBE.auth, challenge_status: 401, challenge_schemes: ["Bearer"]},
}

/** A server that asked for a credential and named no scheme at all. */
const KEY_PROBE_NO_SCHEME = {
    ...KEY_PROBE,
    auth: {...KEY_PROBE.auth, challenge_status: 401, challenge_schemes: []},
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
    failureStatus: null,
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

/**
 * The control a visible label points at, the way `getByLabelText` resolves one.
 *
 * Written out rather than imported, because this package has no testing-library: the point
 * is the same, that a label whose `htmlFor` names nothing is a label attached to nothing.
 */
const labelledControl = (label: string): HTMLElement | null => {
    const node = [...document.querySelectorAll("label")].find(
        (candidate) => candidate.textContent?.replace(/\*$/, "").trim() === label,
    )
    const id = node?.getAttribute("for")
    return id ? document.getElementById(id) : null
}

/** The text of whatever a control points `aria-describedby` at. */
const describedText = (element: HTMLElement | null): string =>
    (element?.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")

const control = (label: string) =>
    document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label)

/** Control heights in px, restated here so this file does not lean on the kit for them. */
const SIZE_BY_CLASS_UNDER_TEST: Record<string, number> = {
    "h-control-xs": 24,
    "h-control-sm": 28,
}

/**
 * The reach a control's classes yield, derived here rather than asked of the kit.
 *
 * D126 shipped because the touch helper and its reader shared one assumption, so a case that
 * asks either of them confirms the class the helper wrote rather than the box a finger gets.
 * The size class is the border box and the `after` inset is measured from inside the border, so
 * the box at the edge a reader can see is `size - 2 x border + 2 x inset`.
 */
const reachOf = (className: string) => {
    const classes = className.split(/\s+/).filter(Boolean)
    const size = SIZE_BY_CLASS_UNDER_TEST[classes.find((c) => c in SIZE_BY_CLASS_UNDER_TEST) ?? ""]
    const border = classes.includes("border-0") ? 0 : classes.includes("border") ? 1 : 0
    const inset = classes
        .map((c) => /^after:-inset-y-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))$/.exec(c))
        .find(Boolean)
    const px = inset ? Number(inset[1] ?? Number(inset[2]) * 4) : 0
    return {size, border, inset: px, reach: size - 2 * border + 2 * px}
}

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

describe("the address field's description, in both states", () => {
    // P2 from round 4. The field pointed at a help line that the failure screen stops
    // rendering, so a reader on C2 had an invalid input describing nothing — and C2 is the
    // one state where the description is the whole answer.
    const describedIds = (element: HTMLElement | null) =>
        (element?.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)

    const describedNodes = (element: HTMLElement | null) =>
        describedIds(element).map((id) => document.getElementById(id))

    it("points at the help line while the address is still being typed", async () => {
        await open(state({status: "url_entry"}))

        const field = control("Server URL")
        expect(describedIds(field)).toHaveLength(1)
        expect(describedNodes(field).every(Boolean)).toBe(true)
        expect(describedNodes(field)[0]?.textContent).toContain(
            "The server's HTTP endpoint. Agenta checks it and detects whether it needs OAuth, an API key, or nothing.",
        )
    })

    it("points at the failure once the check has failed", async () => {
        await open(
            state({
                status: "check_failed",
                url: "https://mcp.internal.acme.dev/mcp",
                probe: {
                    reachable: false,
                    auth: {mode: "unknown", scopes_offered: []},
                    problem: {
                        cause: "unreachable",
                        message: "No MCP response from mcp.internal.acme.dev.",
                    },
                },
                error: "No MCP response from mcp.internal.acme.dev.",
            }),
        )

        const field = control("Server URL")
        expect(field?.getAttribute("aria-invalid")).toBe("true")
        expect(describedIds(field)).toHaveLength(1)
        // The id has to resolve to a node that is actually there.
        expect(describedNodes(field).every(Boolean)).toBe(true)
        expect(describedNodes(field)[0]?.textContent).toContain("Couldn't reach this server.")
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
        // whose answer nobody outside the provider's documentation could know. The status
        // outlived the checklist, so the guarantee is that it renders the wait, and the
        // scopes the server offered reach the provider without reaching the person. Opened
        // on `naming` against the retired headline, this asserted nothing either way.
        await open(
            state({
                status: "choosing_scopes",
                url: "https://mcp.linear.app/mcp",
                name: "Linear",
                probe: OAUTH_PROBE,
                scopesOffered: ["read", "write"],
                endpointId: "mcp-1",
            }),
        )

        expect(text()).toContain("Waiting for Linear…")
        expect(document.querySelectorAll("input[type='checkbox']")).toHaveLength(0)
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

    it("gives both of its links 44px of reach at the row's own 24px height", async () => {
        // The quiet half of the screen's actions, and on this screen the only two controls
        // there are: a person whose consent window went behind something has nothing else to
        // press. A link has no chrome, so it sits on the scale's smallest step and the reach
        // beyond it is an invisible box. The row's 16px gap is wider than the 10px either box
        // reaches sideways, so the two do not take each other's presses.
        await open(
            state({
                status: "awaiting_consent",
                url: "https://mcp.linear.app/mcp",
                name: "Linear",
                probe: OAUTH_PROBE,
                endpointId: "mcp-1",
            }),
        )

        for (const label of ["Open the window again", "Cancel"]) {
            const link = button(label)
            expect(link, label).toBeDefined()
            const measured = reachOf(link!.className)
            expect(measured.size, `${label}: not the 24px control this case is about`).toBe(24)
            expect(measured.border, `${label}: not the bordered Button this case is about`).toBe(1)
            expect(measured.reach, label).toBe(44)
            expect(link!.className, label).not.toMatch(/after:(bg|border|text|shadow)-/)
        }
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

describe("every description a field points at is on screen", () => {
    /**
     * D127. The hint ids were written by hand at the call sites and set on the control
     * whatever the screen, so any screen that drew no hint left the control naming an element
     * that was not in the document. Four screens did that on the name field alone, and a
     * description that points at nothing reads to assistive technology as no description,
     * silently.
     */
    const dangling = (label: string): string[] =>
        (control(label)?.getAttribute("aria-describedby") ?? "")
            .split(/\s+/)
            .filter(Boolean)
            .filter((id) => !document.getElementById(id))

    const screens: [string, McpJourneyState, Partial<McpConnectJourneyProps> | undefined][] = [
        ["C1, the address", state({status: "url_entry"}), undefined],
        [
            "C3, the OAuth name step",
            state({
                status: "naming",
                url: "https://mcp.linear.app/mcp",
                name: "Linear",
                probe: OAUTH_PROBE,
            }),
            undefined,
        ],
        [
            "C5, the key step, which draws no hint under the name",
            state({
                status: "naming",
                url: "https://mcp.axiom.co/mcp",
                name: "Axiom",
                probe: KEY_PROBE,
            }),
            undefined,
        ],
        [
            "C5's no-auth half, which draws none either",
            state({
                status: "naming",
                url: "https://mcp.acme.test/mcp",
                name: "Acme",
                probe: NO_AUTH_PROBE,
            }),
            undefined,
        ],
        [
            "C6, where an error box is the description",
            state({
                status: "verify_failed",
                url: "https://mcp.axiom.co/mcp",
                name: "Axiom",
                probe: KEY_PROBE,
                endpointId: "mcp-1",
                slug: "axiom",
                error: "The server rejected the credential.",
            }),
            undefined,
        ],
        [
            "the reconnect entry, where the name is locked",
            state({
                status: "discovering_scopes",
                url: "https://mcp.linear.app/mcp",
                name: "Linear",
                endpointId: "mcp-9",
                slug: "linear-7mx",
                createdHere: false,
            }),
            {
                reconnect: {
                    id: "mcp-9",
                    slug: "linear-7mx",
                    name: "Linear",
                    url: "https://mcp.linear.app/mcp",
                    authMode: "oauth" as const,
                },
            },
        ],
    ]

    for (const [name, current, props] of screens) {
        it(`resolves every reference on ${name}`, async () => {
            await open(current, props)

            for (const label of ["Server URL", "Name", "Header", "Project secret"]) {
                if (!control(label)) continue
                expect({[label]: dangling(label)}).toEqual({[label]: []})
            }
        })
    }
})

describe("the reconnect entry, which opens on a screen nobody has pressed", () => {
    const RECONNECT = {
        id: "mcp-9",
        slug: "linear-7mx",
        name: "Linear",
        url: "https://mcp.linear.app/mcp",
    }

    it("offers both actions on the OAuth entry, where nothing is running yet", async () => {
        // `discovering_scopes` is where a reconnect starts, because the window the press
        // opens can only be opened inside the press. Reading it as busy disabled Connect and
        // Cancel together, and the press that would have resolved it was the one disabled
        // (round 6c, D-R6C-4).
        await open(
            state({
                status: "discovering_scopes",
                url: RECONNECT.url,
                name: RECONNECT.name,
                endpointId: RECONNECT.id,
                slug: RECONNECT.slug,
                createdHere: false,
            }),
            {reconnect: {...RECONNECT, authMode: "oauth"}},
        )

        expect(text()).toContain("Reconnect MCP server")
        expect(button("Connect")?.disabled).toBe(false)
        expect(button("Cancel")?.disabled).toBe(false)
    })

    it("leaves the key entry as it always was, which is the contrast", async () => {
        // A key connection reconnects through `manual_auth`, which is not a busy status, so
        // this sheet never stalled. Only the OAuth entry sat in a busy status with nothing
        // in flight, which is what locates the defect in the status rather than the screen.
        await open(
            state({
                status: "manual_auth",
                url: RECONNECT.url,
                name: RECONNECT.name,
                endpointId: RECONNECT.id,
                slug: RECONNECT.slug,
                createdHere: false,
            }),
            {reconnect: {...RECONNECT, authMode: "api_key"}},
        )

        expect(text()).toContain("Reconnect MCP server")
        expect(button("Cancel")?.disabled).toBe(false)
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
        await open({...keyScreen, probe: KEY_PROBE_BEARER})

        expect(text()).toContain("Reachable · needs an API key")
        expect((control("Header") as HTMLInputElement).value).toBe("Authorization")
        expect(control("Project secret")).toBeTruthy()
        expect(text()).toContain(
            "Pick a project secret or create one. The value is sent as this header when the agent runs and is never shown again.",
        )
    })

    it("offers only the two actions the spec draws", async () => {
        await open(keyScreen)

        // "Connect without authentication" used to sit here. This screen is only ever
        // reached by a server that refused the anonymous handshake, so connecting without a
        // credential would make a connection the server has already said no to (decision 53).
        expect(text()).not.toContain("Connect without authentication")
        expect(button("Cancel")).toBeDefined()
        expect(button("Connect")).toBeDefined()
    })

    it("attaches the secret label to the control it names", async () => {
        await open(keyScreen)

        // `Field` generates an id and points its label at it whenever the child has none, so
        // a child that drops the id leaves the label naming nothing at all (round 4, D104).
        const control = labelledControl("Project secret")
        expect(control).not.toBeNull()
        expect(control?.getAttribute("aria-label")).toBe("Project secret")
    })

    it("cannot connect until a secret is chosen", async () => {
        await open(keyScreen)

        expect(button("Connect")?.disabled).toBe(true)
    })

    it("prefills x-api-key when the challenge named no scheme", async () => {
        // The spec's C5 note: the scheme picks "Authorization" and otherwise "x-api-key".
        // The field was seeded "Authorization" whatever the server said, which is a claim
        // about a header nobody had been told.
        await open({...keyScreen, probe: KEY_PROBE_NO_SCHEME})

        expect((control("Header") as HTMLInputElement).value).toBe("x-api-key")
    })

    it("keeps what was typed, whatever the probe says next", async () => {
        // The field shows "what was typed, or the prefill". Only the prefill half is obvious
        // from a render, so a change making the value probe-derived passes the package while
        // silently overwriting a person's typing the moment a probe answers (round 5).
        await open({...keyScreen, probe: KEY_PROBE_NO_SCHEME})
        expect((control("Header") as HTMLInputElement).value).toBe("x-api-key")

        const field = control("Header") as HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(field) as object,
            "value",
        )?.set
        await act(async () => {
            setter?.call(field, "X-Acme-Token")
            field.dispatchEvent(new Event("input", {bubbles: true}))
        })

        // The same sheet, re-rendered with a probe whose prefill is the other one.
        await open({...keyScreen, probe: KEY_PROBE_BEARER})

        expect((control("Header") as HTMLInputElement).value).toBe("X-Acme-Token")
    })

    it("reconnects with the header the connection is already saved under", async () => {
        // A key reconnect repairs a credential and changes nothing else (decisions 10 and
        // 34). Prefilling the probe's default offered `Authorization` over a saved
        // `X-Api-Key`, so a person who accepted what was on screen broke a working
        // connection (round 6d, live).
        await open(
            state({
                status: "manual_auth",
                url: "https://mcp.axiom.co/mcp",
                name: "Axiom",
                endpointId: "mcp-1",
                slug: "axiom",
                createdHere: false,
            }),
            {
                reconnect: {
                    id: "mcp-1",
                    slug: "axiom",
                    name: "Axiom",
                    url: "https://mcp.axiom.co/mcp",
                    authMode: "api_key" as const,
                    credentialHeader: "X-Api-Key",
                },
            },
        )

        expect((control("Header") as HTMLInputElement).value).toBe("X-Api-Key")
    })

    it("keeps Authorization on a reconnect that saved no header of its own", async () => {
        await open(
            state({
                status: "manual_auth",
                url: "https://mcp.axiom.co/mcp",
                name: "Axiom",
                endpointId: "mcp-1",
                slug: "axiom",
                createdHere: false,
            }),
            {
                reconnect: {
                    id: "mcp-1",
                    slug: "axiom",
                    name: "Axiom",
                    url: "https://mcp.axiom.co/mcp",
                    authMode: "api_key" as const,
                },
            },
        )

        expect((control("Header") as HTMLInputElement).value).toBe("Authorization")
    })

    it("names the scheme the server asked for, where it asked for one", async () => {
        await open({...keyScreen, probe: KEY_PROBE_WITH_SCHEME})

        // The field cannot be filled from a scheme, because a scheme is not a header name.
        // What the challenge can do is tell the reader what this server wants in it, and the
        // line saying so has to reach the field's own announcement.
        expect((control("Header") as HTMLInputElement).value).toBe("Authorization")
        expect(text()).toContain("This server asked for the DSN scheme.")
        expect(describedText(control("Header"))).toContain("DSN")
    })

    it("says nothing about a Bearer challenge, which Authorization already answers", async () => {
        await open({...keyScreen, probe: KEY_PROBE_BEARER})

        // `Authorization: Bearer <token>` is what an endpoint with no registered header
        // already sends, so naming it would tell a reader to do what is being done for them.
        expect(text()).not.toContain("scheme.")
        expect(control("Header")?.getAttribute("aria-describedby")).toBeNull()
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
        // The status of the request that carried the key, which is the one this sentence is
        // about; the anonymous probe's challenge is a different request (round 4, D133).
        failureStatus: 403,
        error: "The server rejected the credential.",
    })

    it("flags both credential fields and relabels the action", async () => {
        await open(rejected)

        expect(control("Header")?.getAttribute("aria-invalid")).toBe("true")
        expect(control("Project secret")?.getAttribute("aria-invalid")).toBe("true")
        expect(text()).toContain(
            "The server rejected this key (403). The server rejected the credential. " +
                "Check the header the server expects, or pick another secret.",
        )
        expect(button("Try again")).toBeDefined()
    })

    it("tells both refused fields where the reason is", async () => {
        await open(rejected)

        // `Field` announces an error it was handed, and this one is a box below the pair
        // rather than either field's own, so nothing paired them: two controls saying they
        // were invalid and neither saying why (round 4, D106).
        for (const label of ["Header", "Project secret"]) {
            const described = describedText(control(label))
            expect(described).toContain("The server rejected this key (403).")
            expect(described).toContain("Check the header the server expects")
        }
    })

    it("names the status the credentialed request was refused with", async () => {
        // The control that tells the two requests apart: the anonymous challenge says 401 and
        // the credentialed refusal says 403, and the sentence is about the second (D133).
        await open({...rejected, probe: KEY_PROBE_BEARER, failureStatus: 403})

        expect(text()).toContain("The server rejected this key (403).")
        expect(text()).not.toContain("The server rejected this key (401).")
    })

    it("names it on a reconnect too, which probes nothing and still gets an answer", async () => {
        // Decision 56 said this screen could not show a code on a reconnect. That held only
        // while the number came from the probe; sourced from the credentialed request, a
        // reconnect has one like any other attempt.
        await open(
            {...rejected, probe: null, failureStatus: 401},
            {
                reconnect: {
                    id: "mcp-1",
                    slug: "axiom",
                    name: "Axiom",
                    url: "https://mcp.axiom.co/mcp",
                    authMode: "api_key" as const,
                },
            },
        )

        expect(text()).toContain("The server rejected this key (401).")
    })

    it("names what the server expects when the challenge said so", async () => {
        await open({...rejected, probe: KEY_PROBE_WITH_SCHEME})

        // The spec's sentence carried this clause and it was dropped for want of anything
        // to put in it. Decision 27 replaces the spec's em dashes with a colon, and keeps
        // the clause.
        expect(text()).toContain(
            "The server rejected this key (403). The server rejected the credential. " +
                "Check the header the server expects: DSN or pick another secret.",
        )
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

describe("success, which draws nothing", () => {
    it("closes instead of reporting, and says none of what it used to", async () => {
        const onClose = vi.fn()
        await open(
            state({
                status: "connected",
                url: "https://mcp.linear.app/mcp",
                name: "Linear",
                probe: OAUTH_PROBE,
                endpointId: "mcp-1",
                slug: "linear-7mx",
            }),
            {onClose},
        )

        expect(onClose).toHaveBeenCalled()
        // The screen the spec never drew, in the words it used: a heading, a count and a
        // button to dismiss what nobody needed to read.
        expect(text()).not.toContain("Linear is connected.")
        expect(text()).not.toContain("tools available")
        expect(button("Done")).toBeUndefined()
    })
})
