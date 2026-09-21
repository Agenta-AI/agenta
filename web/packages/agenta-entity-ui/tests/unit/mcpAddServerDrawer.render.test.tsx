/**
 * What the Add MCP server drawer puts on screen, per state.
 *
 * The cases that matter are the ones where a drawer that reads as correct would not be: a
 * server already on the agent still offering to be added, a search that hides everything
 * looking like an empty project, and an empty project keeping a header action that would
 * duplicate the one call to action it has.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TOUCH_TARGET_MINIMUM_PX, touchTargetHeight, touchTargetHitArea} from "@agenta/ui/ui"

import {
    McpAddServerDrawer,
    type McpConnectionOption,
} from "../../src/mcpEndpoint/McpAddServerDrawer"

const OPTIONS: McpConnectionOption[] = [
    {slug: "linear", name: "Linear", host: "mcp.linear.app", status: "connected", added: true},
    {slug: "axiom", name: "Axiom", host: "mcp.axiom.co", status: "connected"},
    {slug: "octolens", name: "Octolens", host: "mcp.octolens.com", status: "login_expired"},
]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (props: Partial<Parameters<typeof McpAddServerDrawer>[0]> = {}) => {
    const onAdd = vi.fn()
    const onReconnect = vi.fn()
    const onConnectServer = vi.fn()
    await act(async () => {
        root.render(
            createElement(McpAddServerDrawer, {
                open: true,
                onClose: vi.fn(),
                options: OPTIONS,
                onAdd,
                onReconnect,
                onConnectServer,
                ...props,
            }),
        )
    })
    return {onAdd, onReconnect, onConnectServer}
}

/** The drawer is portalled, so every query is against the document, not the host node. */
const text = () => document.body.textContent ?? ""

const buttons = () => [...document.querySelectorAll("button")]

const buttonNamed = (label: string) =>
    buttons().find((button) => (button.getAttribute("aria-label") ?? "") === label)

const buttonReading = (label: string) =>
    buttons().find((button) => (button.textContent ?? "").trim() === label)

const rows = () =>
    [...document.querySelectorAll("[data-state]")].filter(
        (node) =>
            node.tagName === "DIV" &&
            node.hasAttribute("data-state") &&
            ["added", "connected", "login_expired", "unreachable"].includes(
                node.getAttribute("data-state") ?? "",
            ),
    )

const type = async (value: string) => {
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Search servers"]')
    expect(field, "no search field").not.toBeNull()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(field!, value)
        field!.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
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

describe("McpAddServerDrawer, a project with servers", () => {
    it("names the drawer, the section and the one connect action", async () => {
        await render()

        expect(text()).toContain("Add MCP server")
        expect(text()).toContain("Connected in this project · 3")
        expect(buttonReading("Connect server")).toBeDefined()
        expect(text()).toContain(
            "Add opens the permission drawer for this agent. Connect server adds the new server once it's connected.",
        )
    })

    it("draws the three row states, and only those", async () => {
        await render()

        expect(rows().map((row) => row.getAttribute("data-state"))).toEqual([
            "added",
            "connected",
            "login_expired",
        ])
    })

    it("offers a server already on the agent no way to be added again", async () => {
        const {onAdd} = await render()

        const added = rows()[0]!
        expect(added.textContent).toContain("Added")
        expect(added.className).toContain("opacity-70")
        // Not merely styled as inert: the row carries no control at all.
        expect([...added.querySelectorAll("button")]).toHaveLength(0)
        expect(onAdd).not.toHaveBeenCalled()
    })

    it("adds a connected server and reconnects an expired one", async () => {
        const {onAdd, onReconnect} = await render()

        await act(async () => {
            buttonNamed("Add Axiom to this agent")!.dispatchEvent(
                new MouseEvent("click", {bubbles: true}),
            )
        })
        expect(onAdd).toHaveBeenCalledWith(OPTIONS[1])

        await act(async () => {
            buttonNamed("Reconnect Octolens")!.dispatchEvent(
                new MouseEvent("click", {bubbles: true}),
            )
        })
        expect(onReconnect).toHaveBeenCalledWith(OPTIONS[2])
    })

    it("shows the expiry in place of the host, so the row never claims a live host", async () => {
        await render()

        const expired = rows()[2]!
        expect(expired.textContent).toContain("Login expired")
        expect(expired.textContent).not.toContain("mcp.octolens.com")
    })

    it("shows the host alone when no cached tool count is on the record", async () => {
        await render()

        expect(rows()[1]!.textContent).toContain("mcp.axiom.co")
        expect(text()).not.toContain("tools")
    })

    it("shows the count beside the host when the record carries one", async () => {
        await render({
            options: [{...OPTIONS[1]!, toolCount: 28}],
        })

        expect(text()).toContain("mcp.axiom.co · 28 tools")
    })

    // The status cannot be derived today, but the row does not hardcode the two it can
    // show: the day a health field lands, this row says Unreachable without a change here.
    it("states any non-working status in the data layer's own words", async () => {
        await render({
            options: [{...OPTIONS[1]!, status: "unreachable"}],
        })

        expect(text()).toContain("Unreachable")
        expect(text()).not.toContain("mcp.axiom.co")
        expect(buttonNamed("Reconnect Axiom")).toBeDefined()
    })
})

describe("McpAddServerDrawer search", () => {
    it("filters by name", async () => {
        await render()
        await type("axi")

        expect(rows()).toHaveLength(1)
        expect(rows()[0]!.textContent).toContain("Axiom")
    })

    it("filters by host, which is not the name", async () => {
        await render()
        await type("linear.app")

        expect(rows()).toHaveLength(1)
        expect(rows()[0]!.textContent).toContain("Linear")
    })

    it("says so inline and keeps the header action when nothing matches", async () => {
        await render()
        await type("nothing-by-this-name")

        expect(rows()).toHaveLength(0)
        expect(text()).toContain("No servers match")
        // The empty-project screen is a different screen: its copy must not appear here,
        // and the header action it hides must still be here.
        expect(text()).not.toContain("No MCP servers in this project yet")
        expect(buttonReading("Connect server")).toBeDefined()
    })
})

describe("McpAddServerDrawer, a project with no servers", () => {
    it("carries one call to action and drops the header one", async () => {
        const {onConnectServer} = await render({options: []})

        expect(text()).toContain("No MCP servers in this project yet")
        expect(text()).toContain(
            "Connect an MCP server by URL. You'll sign in or add a key once, and every agent in the project can use it.",
        )
        expect(
            buttons().filter((b) => (b.textContent ?? "").trim() === "Connect server"),
        ).toHaveLength(1)
        expect(text()).not.toContain("Connected in this project")

        await act(async () => {
            buttonReading("Connect server")!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        expect(onConnectServer).toHaveBeenCalledOnce()
    })
})

describe("McpAddServerDrawer while the registry is in flight", () => {
    it("draws three skeleton rows rather than an empty project", async () => {
        await render({options: [], loading: true})

        const skeleton = document.querySelector('[data-slot="skeleton-rows"]')
        expect(skeleton, "no skeleton block").not.toBeNull()
        expect(skeleton!.children).toHaveLength(3)
        expect(text()).not.toContain("No MCP servers in this project yet")
        expect(text()).not.toContain("No servers match")
    })
})

/** Control heights in px, restated here so this file does not lean on the kit for them. */
const SIZE_BY_CLASS_UNDER_TEST: Record<string, number> = {
    "h-control-xs": 24,
    "h-control-sm": 28,
    "size-control-sm": 28,
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

describe("the connection row's actions on a phone", () => {
    it("give Add and Reconnect a 44px hit area at the row's own 28px height", async () => {
        // The row rhythm is the desktop's and stays 28px; the reach is an invisible box. Both
        // actions, because a row offers one or the other and never both.
        await render()

        for (const label of ["Add Axiom to this agent", "Reconnect Octolens"]) {
            const action = buttonNamed(label)
            expect(action, label).toBeDefined()
            expect(action!.className, label).toContain("h-control-sm")
            expect(touchTargetHeight(action!.className), label).toBe(TOUCH_TARGET_MINIMUM_PX)
        }
    })

    it("measures 44px of reach without asking the helper for it", async () => {
        await render()

        const action = buttonNamed("Add Axiom to this agent")
        const measured = reachOf(action!.className)
        expect(measured.size, "not the 28px control this case is about").toBe(28)
        expect(measured.border, "not the bordered Button this case is about").toBe(1)
        expect(measured.reach).toBe(44)
    })

    it("gives the drawer's own Close a 44px hit area on both axes", async () => {
        // The way out of the drawer, and a 28px square rather than a labelled button, so the
        // minimum failed it on both axes. Pinned here as well as in the kit because this is the
        // drawer the redesign added and the one a phone reader meets first.
        await render()

        const close = buttonNamed("Close")
        expect(close, "no close button").toBeDefined()
        expect(close!.className).toContain("size-control-sm")
        expect(touchTargetHitArea(close!.className)).toEqual({
            width: TOUCH_TARGET_MINIMUM_PX,
            height: TOUCH_TARGET_MINIMUM_PX,
        })
    })
})

describe("McpAddServerDrawer on a phone", () => {
    it("is a bottom sheet below the breakpoint and a right-edge drawer above it", async () => {
        // The one prop that makes a configuration panel correct in both apps, and the reason
        // the mobile app needs no drawer of its own. The geometry itself is measured in a
        // browser; what this pins is that the drawer asks for the responsive side at all, the
        // way the permission drawer beside it does.
        await render()

        const panel = document.querySelector('[role="dialog"]')
        expect(panel, "no drawer panel").not.toBeNull()
        expect(panel!.className).toContain("bottom-0")
        expect(panel!.className).toContain("lg:right-0")
    })
})
