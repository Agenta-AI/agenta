import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import ConnectToolsStep from "./ConnectToolsStep"

const state = vi.hoisted(() => ({
    connections: [] as {id: string; slug: string; integration_key: string; name: string}[],
    requestMore: vi.fn(),
    hasNextPage: true,
    loading: false,
}))
vi.mock("@agenta/entities/gatewayTool", () => ({
    isConnectionActive: () => true,
    isConnectionValid: () => true,
    invalidateToolConnections: vi.fn(),
    useToolConnectionsQuery: () => ({connections: state.connections}),
    useToolCatalogIntegrations: () => ({
        integrations: Array.from({length: 10}, (_, i) => ({key: `app-${i}`, name: `App ${i}`})),
        hasNextPage: state.hasNextPage,
        prefetchThreshold: 6,
        isFetchingNextPage: state.loading,
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
    state.loading = false
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
    it("selects connected apps on their cards without a separate checklist", () => {
        state.connections = [
            {id: "saved", slug: "saved", integration_key: "app-2", name: "Account"},
        ]
        const onChange = vi.fn()
        const view = render(<ConnectToolsStep selectedIds={[]} onChange={onChange} />)
        expect(screen.queryByRole("checkbox")).toBeNull()
        fireEvent.click(screen.getByRole("button", {name: "App 2 Connected"}))
        expect(onChange).toHaveBeenLastCalledWith(["saved"])
        view.rerender(<ConnectToolsStep selectedIds={["saved"]} onChange={onChange} />)
        fireEvent.click(screen.getByRole("button", {name: "App 2 Selected"}))
        expect(onChange).toHaveBeenLastCalledWith([])
    })
    it("shows feedback while fetching another page", () => {
        state.loading = true
        render(<ConnectToolsStep selectedIds={[]} onChange={vi.fn()} />)
        expect(screen.getAllByRole("status")[0].textContent).toContain("Loading more apps")
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
