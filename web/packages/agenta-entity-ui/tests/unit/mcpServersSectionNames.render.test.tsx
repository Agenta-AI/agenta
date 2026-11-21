/**
 * The MCP rows name a server by its connection's name, as every other place does (canvas F01),
 * not by the tool prefix the saved item stores. The handlers still get the saved item.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

const endpoints = [
    {
        id: "mcp-1",
        slug: "audit2-mock",
        name: "audit2-mock",
        auth_mode: "none" as const,
        namespace: "custom" as const,
        data: {route: {base_url: "https://mcp.example.test/mcp"}},
    },
]

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    mcpEndpointsQueryAtom: {},
}))

vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/useAgentRequirements", () => ({
    useAgentRequirements: () => null,
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => ({data: endpoints}),
}))

import {McpServersSectionBody} from "../../src/DrillInView/SchemaControls/agentTemplate/McpServersSectionBody"

beforeAll(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const saved = {
    name: "audit2_mock",
    connection: {type: "gateway", namespace: "custom", slug: "audit2-mock"},
}

describe("McpServersSectionBody row names", () => {
    it("shows the connection's name and opens the saved item", () => {
        const openServer = vi.fn()
        const openForm = vi.fn()
        act(() =>
            root.render(
                createElement(McpServersSectionBody, {
                    items: [saved],
                    openForm,
                    openServer,
                    removeServer: vi.fn(),
                    removeServerAt: vi.fn(),
                    statusFor: () => undefined,
                }),
            ),
        )
        expect(container.textContent).toContain("audit2-mock")
        expect(container.textContent).not.toContain("audit2_mock")
        const row = container.querySelector("[role=button]") as HTMLElement
        act(() => row.click())
        // A server that resolves opens its view, keyed by the saved item, not the form.
        expect(openForm).not.toHaveBeenCalled()
        expect(openServer).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(openServer.mock.calls[0])).toContain("audit2_mock")
    })
})
