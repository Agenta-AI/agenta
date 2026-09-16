// @vitest-environment jsdom
/**
 * What the MCP registry has to say on screen, not just compute.
 *
 * This section had no unit or rendered test in either app before this file; the only thing
 * covering it was the Playwright suite, which drives `/w` alone. Each case here is a way the
 * page could read as safe or complete when it is not: a credential's name mistaken for its
 * value, a dead login shown as connected, a destructive verb that does not say what it ends,
 * and an open drawer reporting a state the list has already moved past.
 */
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const atoms = vi.hoisted(() => ({
    endpoints: {toString: () => "endpointsAtom"},
    refresh: {toString: () => "refreshAtom"},
    remove: {toString: () => "deleteAtom"},
    secrets: {toString: () => "secretsAtom"},
}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    // `getMcpConnectionState` is the code under test for the status cell; only the atoms are
    // swapped for sentinels the jotai stub below can recognise.
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    mcpEndpointsQueryAtom: atoms.endpoints,
    refreshMcpEndpointsAtom: atoms.refresh,
    deleteMcpEndpointAtom: atoms.remove,
}))

vi.mock("@agenta/entities/secret", () => ({customNamedSecretsAtom: atoms.secrets}))

// The connect journey is a 566-line state machine over the network; the drawer reads the tool
// list. Neither is this file's subject, so both are stubbed. The drawer stub reports the state
// of whatever endpoint it is handed, which is what the by-key case asserts on.
vi.mock("@agenta/entity-ui/mcpEndpoint", () => ({
    McpConnectJourney: ({open}: {open: boolean}) =>
        open ? <div data-testid="mcp-connect-journey" /> : null,
    McpConnectionDetail: ({endpoint}: {endpoint: {name?: string; secret_id?: string} | null}) =>
        endpoint ? (
            <div data-testid="mcp-connection-detail">
                {endpoint.name}
                <span data-testid="detail-secret">{endpoint.secret_id ?? "none"}</span>
            </div>
        ) : null,
}))

const setters = vi.hoisted(() => ({remove: vi.fn(), refresh: vi.fn()}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: (atom: unknown) => {
        if (atom === atoms.endpoints) return state.query
        if (atom === atoms.secrets) return state.secrets
        return undefined
    },
    useSetAtom: (atom: unknown) => {
        if (atom === atoms.remove) return setters.remove
        if (atom === atoms.refresh) return setters.refresh
        return vi.fn()
    },
}))

import {getSettingsTabDescription} from "@agenta/settings"

import McpServersSection from "../../src/mcp/McpServersSection"

interface Endpoint {
    id: string
    slug: string
    name: string
    auth_mode: "oauth" | "api_key" | "none"
    secret_id?: string | null
    flags?: {is_valid?: boolean}
    data: {route: {base_url: string}}
}

const endpoint = (over: Partial<Endpoint> & Pick<Endpoint, "id" | "name">): Endpoint => ({
    slug: over.id,
    auth_mode: "oauth",
    secret_id: "sec-1",
    data: {route: {base_url: `https://mcp.${over.id}.example/mcp`}},
    ...over,
})

const LINEAR = endpoint({id: "linear", name: "Linear", auth_mode: "oauth", secret_id: "sec-1"})
const AXIOM = endpoint({id: "axiom", name: "Axiom", auth_mode: "api_key", secret_id: "sec-2"})
const MEMORY = endpoint({id: "memory", name: "Memory", auth_mode: "none", secret_id: null})
const OCTOLENS = endpoint({
    id: "octolens",
    name: "Octolens",
    auth_mode: "oauth",
    secret_id: null,
})

const state: {
    query: {data: Endpoint[] | undefined; isPending: boolean}
    secrets: {id: string; name: string; slug: string}[]
} = {query: {data: [], isPending: false}, secrets: []}

const ALL_SECRETS = [
    {id: "sec-1", name: "linear_token", slug: "linear_token"},
    {id: "sec-2", name: "axiom_token", slug: "axiom_token"},
]

const show = (rows: Endpoint[], options: {isPending?: boolean; readOnly?: boolean} = {}) => {
    state.query = {data: rows, isPending: options.isPending ?? false}
    state.secrets = ALL_SECRETS
    return render(<McpServersSection confirm={confirmSpy} readOnly={options.readOnly} />)
}

let confirmSpy: ReturnType<typeof vi.fn>

/**
 * jsdom implements neither `PointerEvent` nor pointer capture, and Radix's menu trigger needs
 * both. Filled in here rather than in a setup file so the reason travels with the one suite
 * that depends on it.
 */
if (!(globalThis as {PointerEvent?: unknown}).PointerEvent) {
    class StubPointerEvent extends MouseEvent {
        constructor(type: string, init: MouseEventInit = {}) {
            super(type, init)
        }
    }
    ;(globalThis as {PointerEvent?: unknown}).PointerEvent = StubPointerEvent
}
for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"]) {
    if (!(method in Element.prototype)) {
        Object.defineProperty(Element.prototype, method, {value: () => false, writable: true})
    }
}

/** The kebab in a row's trailing cell. Radix opens the menu on pointerdown, not click. */
const openRowMenu = (name: string) => {
    const row = screen.getByText(name).closest("tr") as HTMLTableRowElement
    const kebab = within(row).getAllByRole("button").at(-1) as HTMLElement
    act(() => {
        fireEvent.pointerDown(kebab, {bubbles: true, button: 0, ctrlKey: false})
    })
}

const menuItems = () => screen.getAllByRole("menuitem").map((item) => item.textContent?.trim())

beforeEach(() => {
    confirmSpy = vi.fn()
    setters.remove.mockReset()
    setters.refresh.mockReset()
})

afterEach(cleanup)

describe("the registry table", () => {
    it("names the four columns the spec draws", () => {
        show([LINEAR])
        for (const heading of ["Name", "Server URL", "Auth", "Status"]) {
            expect(screen.getByRole("columnheader", {name: heading})).toBeTruthy()
        }
    })

    it("leads each row with the server tile and the connection name", () => {
        const {container} = show([LINEAR])
        expect(screen.getByTestId("mcp-connection-name").textContent).toBe("Linear")
        // One generic tile per row, at the 24px size the spec's Name cell draws.
        const tile = container.querySelector('[data-slot="icon-tile"]')
        expect(tile?.getAttribute("data-size")).toBe("24")
        expect(tile?.getAttribute("data-tone")).toBe("info")
    })

    it("shows the server URL", () => {
        show([LINEAR])
        expect(screen.getByText("https://mcp.linear.example/mcp")).toBeTruthy()
    })
})

describe("the auth cell", () => {
    it("reads OAuth for a connection that signed in", () => {
        show([LINEAR])
        expect(screen.getByText("OAuth")).toBeTruthy()
    })

    it("names the secret a key-authenticated connection uses, and never its value", () => {
        show([AXIOM])
        expect(screen.getByText("API key ·")).toBeTruthy()
        expect(screen.getByText("axiom_token")).toBeTruthy()
        // The id is the handle on the vault row; printing it here would be closer to showing
        // the credential than to naming it.
        expect(screen.queryByText("sec-2")).toBeNull()
    })

    it("falls back to the bare kind when the secret no longer resolves", () => {
        state.secrets = []
        render(<McpServersSection confirm={confirmSpy} />)
        expect(screen.getByText("API key")).toBeTruthy()
    })

    it("reads None for a server that needs no credential", () => {
        show([MEMORY])
        expect(screen.getByText("None")).toBeTruthy()
    })
})

describe("the status cell", () => {
    it("reads Connected for a usable connection, with no repair offered", () => {
        show([LINEAR])
        const cell = screen.getByTestId("mcp-connection-status")
        expect(within(cell).getByText("Connected")).toBeTruthy()
        expect(within(cell).queryByRole("button", {name: "Reconnect"})).toBeNull()
    })

    it("reads Login expired with an inline Reconnect when the grant is gone", () => {
        show([OCTOLENS])
        const cell = screen.getByTestId("mcp-connection-status")
        expect(within(cell).getByText("Login expired")).toBeTruthy()
        expect(within(cell).getByRole("button", {name: "Reconnect"})).toBeTruthy()
    })

    it("reads Login expired for a key the server stopped accepting", () => {
        show([{...AXIOM, flags: {is_valid: false}}])
        expect(
            within(screen.getByTestId("mcp-connection-status")).getByText("Login expired"),
        ).toBeTruthy()
    })

    it("offers no third status, because nothing on the record reports reachability", () => {
        show([LINEAR, AXIOM, MEMORY, OCTOLENS])
        expect(screen.queryByText("Unreachable")).toBeNull()
        // The two the page can actually tell apart, and the old wording for neither.
        expect(screen.queryByText("Needs authorization")).toBeNull()
        expect(screen.queryByText("Needs input")).toBeNull()
    })

    it("opens the reconnect journey without also opening the connection", () => {
        show([OCTOLENS])
        act(() => {
            fireEvent.click(
                within(screen.getByTestId("mcp-connection-status")).getByRole("button", {
                    name: "Reconnect",
                }),
            )
        })
        expect(screen.getByTestId("mcp-connect-journey")).toBeTruthy()
        // The row's own click opens the drawer; the link must not do both.
        expect(screen.queryByTestId("mcp-connection-detail")).toBeNull()
    })
})

describe("the row menu", () => {
    it("holds the spec's four verbs, with Disconnect last and destructive", () => {
        show([LINEAR])
        openRowMenu("Linear")
        expect(menuItems()).toEqual(["Reconnect", "View tools", "Rename", "Disconnect"])
        const disconnect = screen.getByRole("menuitem", {name: "Disconnect"})
        expect(disconnect.className).toContain("text-colorError")
    })

    it("offers no separate Remove, because Disconnect is what ends a connection", () => {
        show([LINEAR])
        openRowMenu("Linear")
        expect(screen.queryByRole("menuitem", {name: "Remove"})).toBeNull()
    })

    it("offers Disconnect on a connection that holds no grant to revoke", () => {
        // The old menu hid Disconnect unless the row was OAuth and ready, because it revoked a
        // token. It ends the connection now, which every row can do (decision 33).
        show([MEMORY])
        openRowMenu("Memory")
        expect(screen.getByRole("menuitem", {name: "Disconnect"})).toBeTruthy()
    })
})

describe("disconnecting", () => {
    it("asks first, naming the act on the button and the consequence in the body", () => {
        show([LINEAR])
        openRowMenu("Linear")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "Disconnect"}))
        })
        expect(confirmSpy).toHaveBeenCalledTimes(1)
        const request = confirmSpy.mock.calls[0][0]
        expect(request.title).toBe("Disconnect Linear")
        expect(request.message).toBe("Agents using this server lose its tools")
        expect(request.okText).toBe("Disconnect")
        expect(request.danger).toBe(true)
        // Nothing happens until the dialog is answered.
        expect(setters.remove).not.toHaveBeenCalled()
    })

    it("removes the connection from the project once confirmed", async () => {
        show([LINEAR])
        openRowMenu("Linear")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "Disconnect"}))
        })
        await act(async () => {
            await confirmSpy.mock.calls[0][0].onOk()
        })
        expect(setters.remove).toHaveBeenCalledWith("linear")
    })
})

describe("the open connection", () => {
    it("is tracked by key, so the drawer follows the row rather than freezing on it", () => {
        const {rerender} = show([AXIOM])
        act(() => {
            fireEvent.click(screen.getByTestId("mcp-connection-name"))
        })
        expect(screen.getByTestId("detail-secret").textContent).toBe("sec-2")

        // The list refetches and this connection comes back without its credential. Holding the
        // row object froze it at click time, so the drawer went on reporting the old one (D2).
        state.query = {data: [{...AXIOM, secret_id: null}], isPending: false}
        rerender(<McpServersSection confirm={confirmSpy} />)
        expect(screen.getByTestId("detail-secret").textContent).toBe("none")
    })

    it("closes when the connection leaves the list entirely", () => {
        const {rerender} = show([AXIOM])
        act(() => {
            fireEvent.click(screen.getByTestId("mcp-connection-name"))
        })
        expect(screen.getByTestId("mcp-connection-detail")).toBeTruthy()

        state.query = {data: [], isPending: false}
        rerender(<McpServersSection confirm={confirmSpy} />)
        expect(screen.queryByTestId("mcp-connection-detail")).toBeNull()
    })
})

describe("the empty page", () => {
    it("states what a connection gets you and offers one way to start", () => {
        show([])
        expect(screen.getByText("No MCP servers connected")).toBeTruthy()
        expect(
            screen.getByText(
                "Connect a server by URL. You'll sign in or add a key once; agents in this project can then add it and choose what it may run.",
            ),
        ).toBeTruthy()
        // The header button is dropped in favour of the one in the panel, so the same action is
        // never offered twice on one screen.
        expect(screen.getAllByTestId("mcp-connect-open")).toHaveLength(1)
    })

    it("draws the muted tile, not the row tile", () => {
        const {container} = show([])
        const tile = container.querySelector('[data-slot="icon-tile"]')
        expect(tile?.getAttribute("data-size")).toBe("44")
        expect(tile?.getAttribute("data-tone")).toBe("muted")
    })

    it("says nothing at all while the list is still loading", () => {
        show([], {isPending: true})
        expect(screen.queryByText("No MCP servers connected")).toBeNull()
    })
})

describe("loading", () => {
    it("holds three rows' worth of space rather than collapsing the page", () => {
        const {container} = show([], {isPending: true})
        expect(container.querySelectorAll("tbody tr")).toHaveLength(3)
    })
})

describe("read-only", () => {
    it("keeps every write affordance off the page", () => {
        show([OCTOLENS], {readOnly: true})
        expect(screen.queryByTestId("mcp-connect-open")).toBeNull()
        expect(screen.queryByRole("button", {name: "Reconnect"})).toBeNull()
        expect(screen.getByText("Login expired")).toBeTruthy()
    })

    it("drops the row menu with it", () => {
        show([LINEAR], {readOnly: true})
        const row = screen.getByText("Linear").closest("tr") as HTMLTableRowElement
        expect(within(row).queryAllByRole("button")).toHaveLength(0)
    })
})

describe("the page's own sentence", () => {
    it("separates connecting a server from deciding what it may do", () => {
        // The subtitle is the only place the two jobs are told apart, which is why permissions
        // are absent from this page without that reading as an omission.
        expect(getSettingsTabDescription("mcpEndpoints", {} as never)).toBe(
            "MCP servers connected to this project. Each agent chooses which of these to use and what it may run.",
        )
    })
})
