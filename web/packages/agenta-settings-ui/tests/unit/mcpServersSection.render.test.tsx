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
import {getSettingsTabDescription} from "@agenta/settings"
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TOUCH_TARGET_MINIMUM_PX, touchTargetHeight} from "@agenta/ui/ui"

import McpServersSection from "../../src/mcp/McpServersSection"

// `vi.hoisted` and `vi.mock` are lifted above every import by the transform, so the mocks
// below are installed before the component under test is evaluated despite reading later.
const atoms = vi.hoisted(() => ({
    endpoints: {toString: () => "endpointsAtom"},
    refresh: {toString: () => "refreshAtom"},
    remove: {toString: () => "deleteAtom"},
    disconnect: {toString: () => "disconnectAtom"},
    secrets: {toString: () => "secretsAtom"},
}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    // `getMcpConnectionStatus` is the code under test for the status cell; only the atoms are
    // swapped for sentinels the jotai stub below can recognise.
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    mcpEndpointsQueryAtom: atoms.endpoints,
    refreshMcpEndpointsAtom: atoms.refresh,
    deleteMcpEndpointAtom: atoms.remove,
    disconnectMcpEndpointAtom: atoms.disconnect,
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
    // The drawer itself is WP4's and has its own suite; what this file pins is how Settings
    // opens it, which is the read-only mode and no agent to remove the server from.
    McpPermissionDrawer: ({
        open,
        slug,
        status,
        readOnly,
        onRemove,
    }: {
        open: boolean
        slug?: string
        status?: string
        readOnly?: boolean
        onRemove?: () => void
    }) =>
        open ? (
            <div
                data-testid="mcp-permission-drawer"
                data-slug={slug}
                data-status={status ?? "unset"}
                data-readonly={String(Boolean(readOnly))}
                data-has-remove={String(onRemove !== undefined)}
            />
        ) : null,
}))

const setters = vi.hoisted(() => ({remove: vi.fn(), refresh: vi.fn(), disconnect: vi.fn()}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: (atom: unknown) => {
        if (atom === atoms.endpoints) return state.query
        if (atom === atoms.secrets) return state.secrets
        return undefined
    },
    useSetAtom: (atom: unknown) => {
        if (atom === atoms.remove) return setters.remove
        if (atom === atoms.disconnect) return setters.disconnect
        if (atom === atoms.refresh) return setters.refresh
        return vi.fn()
    },
}))

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

/** The colour the dot and its label carry, which `StatusIndicator` puts on its wrapper. */
const statusTone = (cell: HTMLElement) =>
    (cell.firstElementChild as HTMLElement | null)?.className ?? ""

/**
 * The viewport the case means, since two of the four columns are a wider screen's.
 *
 * jsdom implements no `matchMedia`, so without this every breakpoint reads false and every
 * case would silently be a phone. Cases that do not say otherwise are a desktop, which is what
 * the spec's 1000px page is.
 */
const setViewport = (width: number) => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: (query: string) => {
            const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
            return {
                matches: width >= min,
                media: query,
                onchange: null,
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => false,
            }
        },
    })
}

beforeEach(() => {
    setViewport(1440)
    confirmSpy = vi.fn()
    setters.remove.mockReset()
    setters.disconnect.mockReset()
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

    it("keeps what identifies and acts on a row at phone width, and drops the details", () => {
        // Measured, the four columns are a 986px table, which a 348px phone can only scroll
        // sideways. The acceptance is that it reflows instead, and the table's own mechanism for
        // that is a per-column breakpoint. The URL and the auth are one tap away in the row.
        setViewport(430)
        show([LINEAR])

        expect(screen.getByRole("columnheader", {name: "Name"})).toBeTruthy()
        expect(screen.getByRole("columnheader", {name: "Status"})).toBeTruthy()
        expect(screen.queryByRole("columnheader", {name: "Server URL"})).toBeNull()
        expect(screen.queryByRole("columnheader", {name: "Auth"})).toBeNull()
        // The row still says which server it is, which is what a narrow table is for.
        expect(screen.getByTestId("mcp-connection-name").textContent).toBe("Linear")
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
        expect(statusTone(cell)).toContain("text-colorSuccess")
        expect(within(cell).queryByRole("button", {name: "Reconnect"})).toBeNull()
    })

    it("reads Login expired with an inline Reconnect when the grant is gone", () => {
        show([OCTOLENS])
        const cell = screen.getByTestId("mcp-connection-status")
        expect(within(cell).getByText("Login expired")).toBeTruthy()
        // The dot has to agree with the word. A row saying "Login expired" in the healthy
        // colour is read as healthy, because the colour is what a scan picks up first.
        expect(statusTone(cell)).toContain("text-colorWarning")
        expect(statusTone(cell)).not.toContain("text-colorSuccess")
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
    it("puts both destructive verbs below the divider, on a row that has a grant", () => {
        show([LINEAR])
        openRowMenu("Linear")
        expect(menuItems()).toEqual(["Reconnect", "View tools", "Rename", "Disconnect", "Remove"])
        for (const verb of ["Disconnect", "Remove"]) {
            expect(screen.getByRole("menuitem", {name: verb}).className).toContain(
                "text-colorError",
            )
        }
    })

    it("hides Disconnect where there is no grant to give back", () => {
        // The revoke route refuses anything that is not a custom OAuth target, so offering the
        // action here would be a 400 on a row that reads as connected.
        show([MEMORY])
        openRowMenu("Memory")
        expect(screen.queryByRole("menuitem", {name: "Disconnect"})).toBeNull()
        // Removing still works: a server that needs no credential is not a dead end.
        expect(screen.getByRole("menuitem", {name: "Remove"})).toBeTruthy()
    })

    it("hides Disconnect on a key connection, which the revoke route also refuses", () => {
        show([AXIOM])
        openRowMenu("Axiom")
        expect(screen.queryByRole("menuitem", {name: "Disconnect"})).toBeNull()
    })

    it("offers Disconnect on an OAuth grant the server has stopped honouring", () => {
        // The handle is dropped whether or not the far side still knows about it, which is the
        // state that made a connection report itself ready and then fail every call.
        show([{...LINEAR, flags: {is_valid: false}}])
        openRowMenu("Linear")
        expect(screen.getByRole("menuitem", {name: "Disconnect"})).toBeTruthy()
    })

    it("hides Disconnect once the grant is already gone", () => {
        show([OCTOLENS])
        openRowMenu("Octolens")
        expect(screen.queryByRole("menuitem", {name: "Disconnect"})).toBeNull()
    })
})

describe("viewing a connection's tools", () => {
    it("opens the permission drawer with nothing to set", () => {
        show([LINEAR])
        openRowMenu("Linear")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "View tools"}))
        })
        const drawer = screen.getByTestId("mcp-permission-drawer")
        expect(drawer.getAttribute("data-slug")).toBe("linear")
        expect(drawer.getAttribute("data-readonly")).toBe("true")
        // A Settings row belongs to no agent, so there is nothing to detach it from and the
        // footer's "Remove from agent" link must not be offered.
        expect(drawer.getAttribute("data-has-remove")).toBe("false")
    })

    it("tells the drawer the connection's health rather than letting it assume", () => {
        // The drawer defaults its health to connected, so a lapsed row would open a header
        // claiming the server works.
        show([OCTOLENS])
        openRowMenu("Octolens")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "View tools"}))
        })
        expect(screen.getByTestId("mcp-permission-drawer").getAttribute("data-status")).toBe(
            "login_expired",
        )
    })

    it("is a different surface from Rename, not the same drawer twice", () => {
        show([LINEAR])
        openRowMenu("Linear")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "View tools"}))
        })
        expect(screen.queryByTestId("mcp-connection-detail")).toBeNull()
    })

    it("opens the rename drawer for Rename", () => {
        show([LINEAR])
        openRowMenu("Linear")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "Rename"}))
        })
        expect(screen.getByTestId("mcp-connection-detail")).toBeTruthy()
        expect(screen.queryByTestId("mcp-permission-drawer")).toBeNull()
    })

    it("follows the row by key, so a disconnect does not leave it open on a dead one", () => {
        const {rerender} = show([LINEAR])
        openRowMenu("Linear")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "View tools"}))
        })
        expect(screen.getByTestId("mcp-permission-drawer")).toBeTruthy()

        state.query = {data: [], isPending: false}
        rerender(<McpServersSection confirm={confirmSpy} />)
        expect(screen.queryByTestId("mcp-permission-drawer")).toBeNull()
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
        expect(setters.disconnect).not.toHaveBeenCalled()
    })

    it("gives the login back once confirmed, and keeps the connection", async () => {
        show([LINEAR])
        openRowMenu("Linear")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "Disconnect"}))
        })
        await act(async () => {
            await confirmSpy.mock.calls[0][0].onOk()
        })
        expect(setters.disconnect).toHaveBeenCalledWith("linear")
        // The row stays and Reconnect renews it, so this must not delete anything.
        expect(setters.remove).not.toHaveBeenCalled()
    })
})

describe("removing", () => {
    it("says what removing costs that disconnecting does not", () => {
        show([LINEAR])
        openRowMenu("Linear")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "Remove"}))
        })
        const request = confirmSpy.mock.calls[0][0]
        expect(request.title).toBe("Remove server")
        expect(request.message).toContain("reconnecting later creates a new connection")
        expect(setters.remove).not.toHaveBeenCalled()
    })

    it("takes the connection out of the project once confirmed", async () => {
        show([LINEAR])
        openRowMenu("Linear")
        act(() => {
            fireEvent.click(screen.getByRole("menuitem", {name: "Remove"}))
        })
        await act(async () => {
            await confirmSpy.mock.calls[0][0].onOk()
        })
        expect(setters.remove).toHaveBeenCalledWith("linear")
        expect(setters.disconnect).not.toHaveBeenCalled()
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

describe("touch targets", () => {

/** Control heights in px, restated here so this file does not lean on the kit for them. */
const SIZE_BY_CLASS_UNDER_TEST: Record<string, number> = {
    "h-control-xs": 24,
    "h-control-sm": 28,
}

/**
 * The reach, derived here rather than asked of the helper.
 *
 * D126 shipped because the helper and its reader shared one assumption, so every site test
 * asserted the class the helper had written rather than the box a finger gets. Reverting both
 * together still leaves the site packages green for that reason. This case closes that: it reads
 * the control's own size class, its own border class and its own `after` inset, and does the
 * arithmetic with numbers written here. It never calls the helper, so a coordinated change to
 * the helper and the reader cannot keep it passing.
 *
 * The size class is the border box and the inset is measured from inside the border, so the box
 * at the edge a reader can see is `size - 2 x border + 2 x inset`.
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

    it("gives the status cell's Reconnect a 44px hit area at its 24px height", () => {
        // The repair offered where the problem is reported, on a phone. 24px is the control
        // scale's smallest step and the row rhythm needs it, so the reach is an invisible box.
        show([OCTOLENS])

        const reconnect = screen.getByRole("button", {name: "Reconnect"})
        expect(reconnect.className).toContain("h-control-xs")
        expect(touchTargetHeight(reconnect.className)).toBe(TOUCH_TARGET_MINIMUM_PX)
        // A tall enough control is no use if the cell beside it covers the control itself. At
        // phone width the status cell's content overran its column and slid this link 49px under
        // the actions cell, where the row menu's own hit area took 43 of its 70px. The Button
        // already refuses to shrink, so the status text beside it is what has to give way: that
        // is what the indicator's own `truncate` was for, and it could not act while the
        // indicator's automatic minimum was its own text.
        const indicator = document.querySelector('[data-testid="mcp-connection-status"] span')
        expect(indicator, "no status indicator").not.toBeNull()
        expect(indicator!.className).toContain("min-w-0")
    })

    it("measures 44px of reach without asking the helper for it", () => {
        show([OCTOLENS])

        const measured = reachOf(screen.getByRole("button", {name: "Reconnect"}).className)
        expect(measured.size, "not the 24px control this case is about").toBe(24)
        expect(measured.border, "not the bordered Button this case is about").toBe(1)
        expect(measured.reach).toBe(44)
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
