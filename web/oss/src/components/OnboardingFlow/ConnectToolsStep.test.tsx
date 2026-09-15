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
const direct = vi.hoisted(() => ({connect: vi.fn(), connectingKey: null as string | null}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({
    useDirectToolConnect: () => direct,
}))
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
    it("adds every connected app to the agent with no separate selection", () => {
        state.connections = [
            {id: "saved", slug: "saved", integration_key: "app-2", name: "Account"},
        ]
        const onChange = vi.fn()
        render(<ConnectToolsStep selectedIds={[]} onChange={onChange} />)
        expect(screen.queryByRole("checkbox")).toBeNull()
        expect(onChange).toHaveBeenLastCalledWith(["saved"])
        const card = screen.getByRole("button", {name: /App 2/})
        expect(card.textContent).toContain("Connected")
        expect(card.hasAttribute("disabled")).toBe(true)
    })
    it("starts the auth flow directly from the card", () => {
        render(<ConnectToolsStep selectedIds={[]} onChange={vi.fn()} />)
        fireEvent.click(screen.getByRole("button", {name: /App 3/}))
        expect(direct.connect).toHaveBeenCalledWith(
            expect.objectContaining({integrationKey: "app-3"}),
        )
    })
    it("shows feedback while fetching another page", () => {
        state.loading = true
        render(<ConnectToolsStep selectedIds={[]} onChange={vi.fn()} />)
        expect(screen.getAllByRole("status")[0].textContent).toContain("Loading more apps")
    })
    it("keeps a newly connected app in its catalog position", () => {
        const view = render(<ConnectToolsStep selectedIds={[]} onChange={vi.fn()} />)
        state.connections = [
            {id: "new", slug: "new", integration_key: "app-8", name: "Connected account"},
        ]
        view.rerender(<ConnectToolsStep selectedIds={[]} onChange={vi.fn()} />)
        const cards = screen
            .getAllByRole("button")
            .filter((button) => button.textContent?.startsWith("App"))
        expect(cards[0].textContent).toContain("App 0")
        expect(cards.find((card) => card.textContent?.includes("App 8"))?.textContent).toContain(
            "Connected",
        )
    })
})
