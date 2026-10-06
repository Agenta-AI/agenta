// @vitest-environment jsdom
import {act, useEffect} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    connections: [] as Record<string, unknown>[],
    count: 10,
    hasNextPage: true,
    isFetchingNextPage: false,
    requestMore: vi.fn(),
    connect: vi.fn(),
    createToolConnection: vi.fn(() => Promise.resolve({})),
}))

vi.mock("@agenta/entities/gatewayTool", () => ({
    isConnectionActive: () => true,
    isConnectionValid: () => true,
    createToolConnection: state.createToolConnection,
    invalidateToolConnections: vi.fn(),
    useToolConnectionsQuery: () => ({connections: state.connections, isLoading: false}),
    useToolCatalogIntegrations: () => ({
        integrations: Array.from({length: state.count}, (_, i) => ({
            key: `app-${i}`,
            name: `App ${i}`,
        })),
        hasNextPage: state.hasNextPage,
        isFetchingNextPage: state.isFetchingNextPage,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        setSearch: vi.fn(),
        setCategory: vi.fn(),
        requestMore: state.requestMore,
    }),
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({
    useDirectToolConnect: () => ({connect: state.connect, connectingKey: null}),
}))
vi.mock("@agenta/ui", () => ({
    ScrollSentinel: ({onVisible, hasMore}: {onVisible: () => void; hasMore: boolean}) => {
        useEffect(() => {
            if (hasMore) onVisible()
        }, [hasMore, onVisible])
        return null
    },
}))
vi.mock("@agenta/ui/components/presentational", () => ({LoadError: () => null}))

import {OnboardingToolsStep} from "@/features/onboarding/OnboardingToolsStep"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

const render = () => {
    if (!root) {
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    }
    act(() => root!.render(<OnboardingToolsStep />))
}
const cards = () =>
    Array.from(host!.querySelectorAll("button")).map((item) => item.textContent ?? "")
const card = (name: string) =>
    Array.from(host!.querySelectorAll("button")).find((item) => item.textContent?.startsWith(name))!

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = undefined
    host = undefined
    Object.assign(state, {connections: [], count: 10, hasNextPage: true, isFetchingNextPage: false})
    vi.clearAllMocks()
})

const saved = (integration: string) => ({
    id: `conn-${integration}`,
    slug: `conn-${integration}`,
    provider_key: "composio",
    integration_key: integration,
})

describe("onboarding tools step", () => {
    it("requests more apps and holds a partial row until the last page", () => {
        render()
        expect(state.requestMore).toHaveBeenCalled()
        expect(cards()).toHaveLength(6)
        state.hasNextPage = false
        render()
        expect(cards()).toHaveLength(10)
    })

    it("shows a connected app as connected, in its catalog position", () => {
        state.hasNextPage = false
        render()
        state.connections = [saved("app-8")]
        render()
        expect(cards()[0]).toBe("App 0Connect")
        expect(card("App 8").textContent).toBe("App 8 Connected")
        expect(card("App 8").getAttribute("aria-disabled")).toBe("true")
        act(() => card("App 8").click())
        expect(state.connect).not.toHaveBeenCalled()
    })

    it("starts the auth flow straight from the card", () => {
        render()
        act(() => card("App 3").click())
        expect(state.connect).toHaveBeenCalledWith({
            integrationKey: "app-3",
            integrationName: "App 3",
            authSchemes: [],
            existingCount: 0,
        })
    })

    it("shows feedback while another page loads", () => {
        state.isFetchingNextPage = true
        render()
        expect(host!.querySelector('[role="status"]')?.textContent).toContain("Loading more apps")
    })

    it("connects the zero-auth tools once, skipping one already connected", () => {
        state.connections = [saved("browser_tool")]
        render()
        render()
        expect(state.createToolConnection).toHaveBeenCalledOnce()
        expect(state.createToolConnection).toHaveBeenCalledWith({
            connection: expect.objectContaining({
                name: "Composio Search",
                provider_key: "composio",
                integration_key: "composio_search",
            }),
        })
    })
})
