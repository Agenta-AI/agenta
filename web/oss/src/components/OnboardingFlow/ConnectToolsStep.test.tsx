import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import ConnectToolsStep from "./ConnectToolsStep"

const state = vi.hoisted(() => ({
    connections: [] as {id: string; slug: string; integration_key: string; name: string}[],
    requestMore: vi.fn(),
    hasNextPage: true,
}))
vi.mock("@agenta/entities/gatewayTool", () => ({
    isConnectionActive: () => true,
    isConnectionValid: () => true,
    invalidateToolConnections: vi.fn(),
    useToolConnectionsQuery: () => ({connections: state.connections}),
    useToolCatalogIntegrations: () => ({
        integrations: Array.from({length: 10}, (_, i) => ({key: `app-${i}`, name: `App ${i}`})),
        hasNextPage: state.hasNextPage,
        isFetchingNextPage: false,
        isLoading: false,
        setSearch: vi.fn(),
        setCategory: vi.fn(),
        requestMore: state.requestMore,
    }),
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({ConnectDrawer: () => null}))
vi.stubGlobal(
    "IntersectionObserver",
    class {
        constructor(private callback: (entries: {isIntersecting: boolean}[]) => void) {}
        observe() {
            this.callback([{isIntersecting: true}])
        }
        disconnect() {}
    },
)
afterEach(() => {
    cleanup()
    state.connections = []
    state.hasNextPage = true
    vi.clearAllMocks()
})
describe("onboarding app pagination", () => {
    it("requests more automatically and holds the partial row until the last page", () => {
        const view = render(<ConnectToolsStep selectedIds={[]} onChange={vi.fn()} />)
        expect(state.requestMore).toHaveBeenCalled()
        expect(screen.queryByRole("button", {name: /App 9/})).toBeNull()
        state.hasNextPage = false
        view.rerender(<ConnectToolsStep selectedIds={[]} onChange={vi.fn()} />)
        expect(screen.getByRole("button", {name: /App 9/})).toBeTruthy()
    })
    it("moves a newly connected app to the first grid position", () => {
        const view = render(<ConnectToolsStep selectedIds={[]} onChange={vi.fn()} />)
        state.connections = [
            {id: "new", slug: "new", integration_key: "app-8", name: "Connected account"},
        ]
        view.rerender(<ConnectToolsStep selectedIds={[]} onChange={vi.fn()} />)
        expect(
            screen
                .getAllByRole("button")
                .filter((button) => button.textContent?.startsWith("App"))[0].textContent,
        ).toContain("App 8")
    })
})
