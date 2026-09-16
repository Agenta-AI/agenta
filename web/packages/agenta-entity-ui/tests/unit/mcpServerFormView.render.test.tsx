/**
 * The MCP server form, after its permission editor moved out into a drawer.
 *
 * The form is no longer the way a server reaches an agent, so what it is FOR now is the
 * cases the add drawer cannot serve: an item saved before connections were shared, one
 * pointing at a connection the project no longer has, and one carrying the reserved prefix.
 * Each of those is explained by exactly one notice here and nowhere else, so a redesign that
 * quietly drops one leaves an agent that cannot be repaired.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const endpoints = [
    {
        id: "mcp-1",
        slug: "linear",
        name: "Linear",
        auth_mode: "oauth" as const,
        namespace: "custom" as const,
        secret_id: "secret-1",
        data: {route: {base_url: "https://mcp.linear.app"}},
    },
]

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    // The reference and policy helpers are the code under test; only the query is stubbed.
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    mcpEndpointsQueryAtom: {},
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => ({data: endpoints}),
}))

import {McpServerFormView} from "../../src/DrillInView/SchemaControls/McpServerFormView"

const gateway = (slug: string) => ({type: "gateway", namespace: "custom", slug})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (value: Record<string, unknown>) => {
    const onChange = vi.fn()
    await act(async () => {
        root.render(createElement(McpServerFormView, {value, onChange}))
    })
    return onChange
}

const text = () => document.body.textContent ?? ""

const buttonReading = (label: string) =>
    [...document.querySelectorAll("button")].find(
        (button) => (button.textContent ?? "").trim() === label,
    )

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

describe("the MCP server form's three notices", () => {
    it("explains an item saved before connections were shared", async () => {
        await render({name: "linear", connection: {type: "http", url: "https://mcp.linear.app"}})

        expect(text()).toContain(
            "This server was configured before connections were shared across agents.",
        )
    })

    it("refuses the reserved prefix and says what to do about it", async () => {
        await render({name: "agenta-tools", connection: gateway("linear")})

        expect(text()).toContain("That prefix is reserved.")
    })

    it("says so when the saved connection is no longer in the project", async () => {
        await render({name: "gone", connection: gateway("gone")})

        expect(text()).toContain("This connection is no longer available")
    })

    it("keeps the frozen-prefix explanation on the prefix row", async () => {
        await render({name: "linear", connection: gateway("linear")})

        expect(text()).toContain("Tool prefix")
        expect(text()).toContain("linear")
    })
})

describe("the form's Permissions row", () => {
    it("is a way out to the drawer, not the editor inline", async () => {
        await render({name: "linear", connection: gateway("linear")})

        expect(buttonReading("Set permissions")).toBeDefined()
        // The editor's own copy, which would be on the page if it were still embedded here.
        expect(text()).not.toContain("Every tool on this server follows the server's own")
        expect(text()).not.toContain("Set permissions per tool")
    })

    it("offers nothing to open while no connection is chosen", async () => {
        await render({name: "", connection: gateway("")})

        expect(buttonReading("Set permissions")?.hasAttribute("disabled")).toBe(true)
    })
})
