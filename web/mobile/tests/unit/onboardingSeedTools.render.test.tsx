// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    createToolConnection: vi.fn(() => Promise.resolve({})),
}))

vi.mock("@agenta/entities/gatewayTool", () => ({
    isConnectionActive: () => true,
    isConnectionValid: () => true,
    createToolConnection: state.createToolConnection,
    invalidateToolConnections: vi.fn(),
}))
vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {projectIdAtom: atom("proj-1")}
})

import type {ToolConnection} from "@agenta/entities/gatewayTool"

import {useSeedToolConnections} from "@/features/onboarding/useSeedToolConnections"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const Seed = (props: {enabled: boolean; connections: ToolConnection[]; loaded: boolean}) => {
    useSeedToolConnections(props)
    return null
}

let root: Root | undefined

const mount = (props: Parameters<typeof Seed>[0]) => {
    if (root) act(() => root!.unmount())
    root = createRoot(document.createElement("div"))
    act(() => root!.render(<Seed {...props} />))
}

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    window.sessionStorage.clear()
    vi.clearAllMocks()
})

const saved = (integration: string) =>
    ({
        id: `conn-${integration}`,
        slug: `conn-${integration}`,
        provider_key: "composio",
        integration_key: integration,
    }) as ToolConnection

describe("onboarding tool seeding", () => {
    it("connects the zero-auth tools once per project, skipping one already connected", () => {
        const props = {enabled: true, connections: [saved("browser_tool")], loaded: true}
        mount(props)
        mount(props)
        expect(state.createToolConnection).toHaveBeenCalledOnce()
        expect(state.createToolConnection).toHaveBeenCalledWith({
            connection: expect.objectContaining({
                name: "Composio Search",
                provider_key: "composio",
                integration_key: "composio_search",
            }),
        })
    })

    it("seeds nothing before the connections read answers or in a preview", () => {
        mount({enabled: true, connections: [], loaded: false})
        mount({enabled: false, connections: [], loaded: true})
        expect(state.createToolConnection).not.toHaveBeenCalled()
    })
})
