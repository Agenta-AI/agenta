/**
 * What the Add MCP server list puts on screen, per state.
 *
 * The cases that matter are the ones where a list that reads as correct would not be: a
 * server already on the agent still offering to be added, a search that hides everything
 * looking like an empty project, and an empty project keeping a header action that would
 * duplicate the one call to action it has.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {McpAddServerList, type McpConnectionOption} from "../../src/mcpEndpoint/McpAddServerList"

const OPTIONS: McpConnectionOption[] = [
    {slug: "linear", name: "Linear", host: "mcp.linear.app", status: "connected", added: true},
    {slug: "axiom", name: "Axiom", host: "mcp.axiom.co", status: "connected"},
    {slug: "octolens", name: "Octolens", host: "mcp.octolens.com", status: "login_expired"},
]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (props: Partial<Parameters<typeof McpAddServerList>[0]> = {}) => {
    const onAdd = vi.fn()
    const onReconnect = vi.fn()
    const onConnectServer = vi.fn()
    await act(async () => {
        root.render(
            createElement(McpAddServerList, {
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

/** Every query is against the document, as the view that mounts the list may portal it. */
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

describe("McpAddServerList, a project with servers", () => {
    it("offers the one connect action beside the search", async () => {
        await render()

        expect(buttonReading("Connect server")).toBeDefined()
        expect(document.querySelector('input[aria-label="Search servers"]')).not.toBeNull()
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
        // Full color, as the canvas draws it (F03 f4): "Added" is the only mark.
        expect(added.className).not.toContain("opacity")
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

    it("shows the expiry after the host, so the row never reads as a live server", async () => {
        await render()

        expect(rows()[2]!.textContent).toContain("mcp.octolens.com · Login expired")
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

        expect(text()).toContain("mcp.axiom.co · Unreachable")
        expect(buttonNamed("Reconnect Axiom")).toBeDefined()
    })
})

describe("McpAddServerList search", () => {
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

describe("McpAddServerList, a project with no servers", () => {
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

describe("McpAddServerList while the registry is in flight", () => {
    it("draws three skeleton rows rather than an empty project", async () => {
        await render({options: [], loading: true})

        const skeleton = document.querySelector('[data-slot="skeleton-rows"]')
        expect(skeleton, "no skeleton block").not.toBeNull()
        expect(skeleton!.children).toHaveLength(3)
        expect(text()).not.toContain("No MCP servers in this project yet")
        expect(text()).not.toContain("No servers match")
    })
})

describe("the connection row's actions", () => {
    it("keep Add and Reconnect at the row's own 28px height", async () => {
        await render()

        for (const label of ["Add Axiom to this agent", "Reconnect Octolens"]) {
            const action = buttonNamed(label)
            expect(action, label).toBeDefined()
            // Add is icon-only (`size-control-sm`), Reconnect keeps its label (`h-control-sm`).
            expect(action!.className, label).toMatch(/(?:^|\s)(?:h|size)-control-sm(?:\s|$)/)
        }
    })
})
