/**
 * D48: the product has to take the step, not the test.
 *
 * The D22 and D23 suites drive the hook and call `loadTools` and unmount by hand, so deleting
 * the effect that starts tool discovery, or the wrapper that unmounts a closed journey, leaves
 * them green. These two render the real dialog and touch nothing but the controls a person
 * touches, so each fails if its driver is removed.
 *
 * Two things about testing this component cost a lot of time and are worth knowing before you
 * add to it.
 *
 * The dialog renders through a portal, so every query here goes to the document rather than to
 * the host node. A query scoped to the host finds nothing, and the symptom looks like a
 * component that rendered nothing at all.
 *
 * And a stub that resolves immediately decides races the product has not decided yet. The
 * duplicate-discovery case below could not observe its own defect until the stub was made to
 * stay in flight: with an instant answer the first call finished before React re-rendered, so
 * the effect never saw the state that would have made the second one. A test that mocks away
 * the timing cannot see a defect that only exists in the timing.
 */
import {act, createElement, useState} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {probeMcpUrl, createMcpEndpoint, listMcpTools, discoverMcpConnect, beginMcpConnect} =
    vi.hoisted(() => ({
        probeMcpUrl: vi.fn(),
        createMcpEndpoint: vi.fn(),
        listMcpTools: vi.fn(),
        discoverMcpConnect: vi.fn(),
        beginMcpConnect: vi.fn(),
    }))

vi.mock("../../../agenta-entities/src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../agenta-entities/src/mcpEndpoint/api/api")>()),
    probeMcpUrl,
    createMcpEndpoint,
    listMcpTools,
    discoverMcpConnect,
    beginMcpConnect,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
    useSetAtom: () => async () => undefined,
}))

import McpConnectJourney from "../../src/mcpEndpoint/McpConnectJourney"

/** jsdom has none, and a Radix trigger on the reconnect screen measures itself on mount. */
class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

/**
 * An input by its accessible name, whichever way it carries one: some fields put an
 * `aria-label` on the input, others only render a `<label for>` above it.
 */
const field = (name: string): HTMLInputElement | null => {
    const labelled = document.querySelector(`input[aria-label="${name}"]`)
    if (labelled) return labelled as HTMLInputElement

    const label = [...document.querySelectorAll("label")].find((candidate) =>
        candidate.textContent?.startsWith(name),
    )
    const id = label?.getAttribute("for")
    return id ? (document.getElementById(id) as HTMLInputElement | null) : null
}

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label)

/** Flush until a condition holds, so a count is taken after the work has settled. */
const waitFor = async (condition: () => boolean, label: string) => {
    for (let i = 0; i < 50; i++) {
        if (condition()) return
        await act(async () => {
            await Promise.resolve()
        })
    }
    throw new Error(`timed out waiting for ${label}`)
}

/** Let the dialog mount its portal and any awaited work behind a click resolve. */
const settle = async () => {
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

/** Render the host and wait until the portalled dialog is actually in the document. */
const openJourney = async () => {
    await act(async () => {
        root.render(createElement(Host))
    })
    await settle()
}

/** React tracks its own value on a controlled input, so a bare assignment is ignored. */
const typeInto = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input) as object,
        "value",
    )?.set
    await act(async () => {
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const press = async (element: Element | undefined) => {
    await act(async () => {
        element?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
    await settle()
}

/**
 * A host that keeps the journey rendered and toggles `open`, which is what the settings
 * section does and what made the state survive into the next attempt.
 */
let setOpen: (open: boolean) => void
const Host = () => {
    const [open, setOpenState] = useState(true)
    setOpen = setOpenState
    return createElement(McpConnectJourney, {open, onClose: () => setOpenState(false)})
}

/** The connection whose login was revoked, as every Reconnect entry point hands it over. */
const REVOKED = {
    id: "mcp-9",
    slug: "acme-7mx",
    name: "Acme",
    url: "https://mcp.acme.test/",
    authMode: "oauth" as const,
}

/** The same host, opened as a reconnect: the sheet the row menu, the drawer and the chat open. */
const ReconnectHost = () => {
    const [open, setOpenState] = useState(true)
    setOpen = setOpenState
    return createElement(McpConnectJourney, {
        open,
        onClose: () => setOpenState(false),
        reconnect: REVOKED,
    })
}

const openReconnect = async () => {
    await act(async () => {
        root.render(createElement(ReconnectHost))
    })
    await settle()
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    probeMcpUrl.mockResolvedValue({
        count: 1,
        probe: {reachable: true, server_name: "Acme", auth: {mode: "none", scopes_offered: []}},
    })
    createMcpEndpoint.mockResolvedValue({
        count: 1,
        endpoint: {id: "mcp-1", slug: "acme-7mx", name: "Acme", auth_mode: "none"},
    })
    listMcpTools.mockResolvedValue([{name: "echo", description: "Echo it back"}])
    discoverMcpConnect.mockResolvedValue({count: 1, scopes_offered: ["tools:list"]})
    // Held open: the provider's window is what ends this step, and nothing in a unit test
    // is going to open one.
    beginMcpConnect.mockImplementation(() => new Promise(() => undefined))
    // jsdom has no `window.open`, and the journey opens the consent window inside the tap
    // that asks for it. A stub keeps that gesture observable without a real popup.
    vi.stubGlobal(
        "open",
        vi.fn(() => ({closed: false, close: vi.fn(), focus: vi.fn()})),
    )
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("the duplicate-name refusal reaches assistive technology", () => {
    it("marks the name field invalid and points it at the reason", async () => {
        // Behaviour was correct for a sighted mouse user and announced nothing: Continue goes
        // dead and a screen-reader user is told why by nothing at all (round 4, D4).
        createMcpEndpoint.mockRejectedValue({
            response: {
                data: {
                    detail: {
                        code: "mcp_connection_name_taken",
                        message:
                            "Another connection in this project already uses this name; pick a different one.",
                    },
                },
            },
        })
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                server_name: "Acme",
                auth: {mode: "none", scopes_offered: []},
            },
        })

        await openJourney()
        await typeInto(field("Server URL")!, "https://mcp.acme.test/")
        await press(button("Continue"))
        await press(button("Connect"))

        const name = field("Name")
        expect(name).toBeTruthy()
        expect(name!.getAttribute("aria-invalid")).toBe("true")
        const described = (name!.getAttribute("aria-describedby") ?? "")
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
        expect(described).toContain("already uses this name")
    })
})

describe("the rendered journey", () => {
    it("closes itself once the connection is real, with nobody pressing anything", async () => {
        await openJourney()

        await typeInto(field("Server URL")!, "https://mcp.acme.test/")
        await press(button("Continue"))
        await typeInto(field("Name")!, "Acme")
        await press(button("Connect"))
        await settle()

        // Success is the new row in the list behind this, and nothing else (decision 26).
        // Nothing in this test asked the sheet to close; its own effect has to, and the host
        // hands it a fresh `onClose` on every render, so the latch has to hold too.
        expect(document.querySelector('[data-testid="mcp-connect-journey"]')).toBeNull()
        expect(document.body.textContent).not.toContain("is connected.")
        expect(button("Done")).toBeUndefined()
    })

    it("passes a registered client to OAuth only after the person enters it", async () => {
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                server_name: "GitHub",
                auth: {
                    mode: "oauth",
                    registration: "unsupported",
                    client_secret_required: true,
                    scopes_offered: [],
                },
            },
        })
        createMcpEndpoint.mockResolvedValue({
            count: 1,
            endpoint: {
                id: "mcp-github",
                slug: "github-mcp",
                name: "GitHub",
                auth_mode: "oauth",
            },
        })

        await openJourney()
        await typeInto(field("Server URL")!, "https://api.githubcopilot.com/mcp")
        await press(button("Continue"))

        expect(button("Connect")?.disabled).toBe(true)
        await typeInto(field("OAuth client ID")!, "registered-client")
        await typeInto(field("OAuth client secret")!, "registered-secret")
        expect(button("Connect")?.disabled).toBe(false)
        await press(button("Connect"))
        await waitFor(() => beginMcpConnect.mock.calls.length === 1, "OAuth begin")

        expect(beginMcpConnect).toHaveBeenCalledWith("mcp-github", ["tools:list"], "project-1", {
            client_id: "registered-client",
            client_secret: "registered-secret",
        })
    })

    it("opens a reconnect with both actions live, waiting on the press", async () => {
        await openReconnect()

        // A reconnect enters at scope discovery, which is where the press that opens the
        // provider's window has to happen, so the screen shows what it is about to do and
        // waits. Reading that status as busy disabled Connect and Cancel together, and the
        // press that would have resolved it was the one disabled: no way forward and no way
        // back but the close X (round 6c, D-R6C-4).
        expect(document.body.textContent).toContain("Reconnect MCP server")
        expect(button("Connect")?.disabled).toBe(false)
        expect(button("Cancel")?.disabled).toBe(false)

        // And nothing has gone to the provider yet, because nobody has pressed anything.
        // A sheet that had a request in flight would be right to disable its actions; this
        // one has none, which is why disabling them was the defect.
        expect(discoverMcpConnect).not.toHaveBeenCalled()
    })

    it("starts the work on the press, which is what the wait was for", async () => {
        await openReconnect()
        await press(button("Connect"))

        // The press is what opens the provider's window, so it is also what may start
        // discovery: an engine refuses `window.open` once a promise has resolved. Enabling
        // the button is only half the fix if the press still reaches nothing.
        expect(discoverMcpConnect).toHaveBeenCalledWith("mcp-9", "project-1")
    })

    it("starts the work once per press, whatever re-renders in between", async () => {
        // These effects depend on the journey object, whose identity changes with every state
        // change, so while a step was in flight any re-render re-entered it. A single press
        // was seen minting three authorization round trips against a real provider, each with
        // its own `state`, where the person asked for one (round 6d, live).
        let release: (value: unknown) => void = () => undefined
        discoverMcpConnect.mockReturnValue(
            new Promise((resolve) => {
                release = resolve
            }),
        )

        await openReconnect()
        await press(button("Connect"))

        // Re-renders while discovery is in flight, which is when the defect fired.
        for (let i = 0; i < 3; i++) {
            await act(async () => {
                root.render(createElement(ReconnectHost))
            })
            await settle()
        }

        expect(discoverMcpConnect).toHaveBeenCalledTimes(1)

        await act(async () => {
            release({count: 1, scopes_offered: ["tools:list"]})
        })
        await settle()

        // And one authorization, not one per render.
        expect(beginMcpConnect).toHaveBeenCalledTimes(1)
    })

    it("starts the work again on a second press, once", async () => {
        // The latch is cleared by `requestConsent`, which every press and every retry calls,
        // and no case pressed Connect twice in one mount, so nothing held the reset in place
        // (round 4, D183). A latch that never cleared would leave a failed attempt with no
        // way forward, which is the deadlock this screen already had once.
        discoverMcpConnect.mockRejectedValueOnce(new Error("discovery is down"))

        await openReconnect()
        await press(button("Connect"))
        expect(discoverMcpConnect).toHaveBeenCalledTimes(1)

        // The refusal screen offers Try again, which opens a window and starts over.
        await press(button("Try again"))

        expect(discoverMcpConnect).toHaveBeenCalledTimes(2)
    })

    it("asks for a URL again after closing and reopening", async () => {
        await openJourney()

        await typeInto(field("Server URL")!, "https://mcp.acme.test/")
        await press(button("Continue"))
        expect(field("Name")).not.toBeNull()

        // Closed and reopened through the host, the way the settings section does it.
        await act(async () => setOpen(false))
        await settle()
        await act(async () => setOpen(true))
        await settle()

        expect(field("Server URL")).not.toBeNull()
        expect(field("Server URL")!.value).toBe("")
        expect(field("Name")).toBeNull()
    })
})

describe("connecting a server that uses OAuth", () => {
    it("reads the offered scopes once", async () => {
        // Deferred on purpose. With an instantly-resolving stub the direct call finished
        // before React re-rendered, so the effect never saw `discovering_scopes` and the
        // duplicate could not be observed — the shape of the real bug needs a discovery that
        // is still in flight while the component renders.
        let release: (value: unknown) => void = () => undefined
        discoverMcpConnect.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve
                }),
        )
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                server_name: "Acme",
                auth: {mode: "oauth", scopes_offered: ["tools:list"]},
            },
        })

        await openJourney()
        await typeInto(field("Server URL")!, "https://mcp.acme.test/")
        await press(button("Continue"))
        await typeInto(field("Name")!, "Acme")
        await press(button("Connect"))

        // Counted only once discovery has finished, so a second in-flight call cannot hide
        // behind the flush window. Two callers used to race here: `submitName` awaited
        // discovery itself while the transition it had already dispatched fired the effect
        // that does the same. Each call is an outbound round trip and a full-row write on the
        // server (D31).
        // Counted while the first call is still in flight, which is when a second caller
        // would fire. Two callers used to race here: `submitName` awaited discovery itself
        // while the transition it had already dispatched fired the effect that does the same.
        // Each call is an outbound round trip and a full-row write on the server (D31).
        await settle()
        expect(discoverMcpConnect).toHaveBeenCalledTimes(1)

        release({count: 1, scopes_offered: ["tools:list"]})
        // Straight past the scope step to the provider: the offered scopes are asked for in
        // full, because which of them to grant is the server's business and nobody here
        // could answer it.
        await waitFor(
            () => document.body.textContent?.includes("Waiting for Acme") ?? false,
            "the consent wait",
        )
        expect(discoverMcpConnect).toHaveBeenCalledTimes(1)
        // No chooser came with the wait. Pinned on the controls rather than on the retired
        // headline, which no longer exists anywhere and so could not fail, and rather than
        // on the offered scope, which this screen never holds.
        expect(document.querySelectorAll("input[type='checkbox']")).toHaveLength(0)
    })

    it("opens the consent window inside the tap, before anything is awaited", async () => {
        // WebKit refuses `window.open` once a promise has resolved. The row is created and
        // the authorization URL minted after this press, so a window opened when they come
        // back is a window that never opens, which is how the mobile app ended up with a
        // flow that silently did nothing.
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                server_name: "Acme",
                auth: {mode: "oauth", scopes_offered: ["tools:list"]},
            },
        })
        createMcpEndpoint.mockImplementation(() => new Promise(() => undefined))

        await openJourney()
        await typeInto(field("Server URL")!, "https://mcp.acme.test/")
        await press(button("Continue"))
        await press(button("Connect"))

        expect(window.open).toHaveBeenCalledOnce()
        // Blank, and named, so the callback can find it again.
        expect(vi.mocked(window.open).mock.calls[0][0]).toBe("")
        expect(createMcpEndpoint).toHaveBeenCalled()
    })
})
