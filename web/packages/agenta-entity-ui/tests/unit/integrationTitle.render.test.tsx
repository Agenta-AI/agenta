/** The integration title tags a saved connection "Not connected" only when the read says so. */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {query} = vi.hoisted(() => ({
    query: {connections: [] as unknown[], isLoading: false, error: null as Error | null},
}))

vi.mock("@agenta/entities/gatewayTool", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/gatewayTool")>()),
    useToolConnectionsQuery: () => ({...query, count: 0, refetch: vi.fn()}),
    useToolIntegrationDetail: () => ({integration: {name: "Gmail", logo: null}}),
}))

import {IntegrationTitle} from "../../src/DrillInView/SchemaControls/agentTemplate/IntegrationPermissionList"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

const render = async () => {
    await act(async () => {
        root.render(
            createElement(IntegrationTitle, {
                target: {provider: "composio", integration: "gmail"} as never,
                connectionSlug: "gmail-team",
            }),
        )
    })
}

describe("integration title", () => {
    it("tags a saved connection the project no longer has", async () => {
        query.error = null
        await render()
        expect(host.textContent).toContain("Not connected")
    })

    it("does not tag it when the connection read failed", async () => {
        query.error = new Error("offline")
        await render()
        expect(host.textContent).not.toContain("Not connected")
    })
})
