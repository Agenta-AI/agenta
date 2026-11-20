// @vitest-environment jsdom
/**
 * The builder sidebar: the switcher on "Builder" and the search in the "Chats" heading.
 */
import type {ReactNode} from "react"

import {NavMenu} from "@agenta/navigation-ui"
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The rail's scroll fade measures its box; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
    observe = () => undefined
    unobserve = () => undefined
    disconnect = () => undefined
} as unknown as typeof ResizeObserver

// Menus render inline: Radix opens them on a pointer sequence jsdom does not send.
vi.mock("@agenta/ui/ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/ui/ui")>()
    const Pass = ({children}: {children?: ReactNode}) => <div>{children}</div>
    return {
        ...actual,
        DropdownMenu: Pass,
        DropdownMenuTrigger: Pass,
        DropdownMenuContent: Pass,
        DropdownMenuLabel: Pass,
        DropdownMenuSeparator: () => <hr />,
        DropdownMenuItem: ({
            children,
            onSelect,
            disabled,
            ...rest
        }: {
            children: ReactNode
            onSelect?: () => void
            disabled?: boolean
            "data-testid"?: string
        }) => (
            <button
                type="button"
                role="menuitem"
                disabled={disabled}
                data-testid={rest["data-testid"]}
                onClick={() => onSelect?.()}
            >
                {children}
            </button>
        ),
    }
})

vi.mock("@agenta/entity-ui/agent", () => ({
    AgentChip: () => <span />,
    useAgentIconChrome: () => ({customised: false, glyph: null, className: "", style: {}}),
}))

const chatsCalls: string[] = []
let chatRows: {session_id: string; name: string; updated_at: string}[] = []
vi.mock("../../src/features/builder-page/useBuilderChats", () => ({
    useBuilderChats: (search = "") => {
        chatsCalls.push(search)
        return {
            rows: search
                ? chatRows.filter((row) => row.name.toLowerCase().includes(search.toLowerCase()))
                : chatRows,
            pending: false,
            failed: false,
            retry: () => undefined,
            loadMore: () => undefined,
        }
    },
}))

vi.mock("../../src/features/nav/useMobileNavItems", () => ({
    MOBILE_NAV_SCOPE_ID: "mobile-main",
    useMobileBottomNavItems: () => [],
}))

vi.mock("next/router", () => ({
    default: {asPath: "/"},
    useRouter: () => ({push: vi.fn(), query: {}, pathname: "/", asPath: "/"}),
}))

const {AgentSidebarSwitcher} = await import("../../src/features/agent-sidebar/AgentSidebarSwitcher")
const {createBuilderSidebarScope} =
    await import("../../src/features/builder-page/builderSidebarScope")

afterEach(cleanup)

const agents = Array.from({length: 10}, (_, index) => ({id: `a${index}`, name: `Agent ${index}`}))

describe("the builder sidebar switcher", () => {
    it("shows Builder with the chevron, lists Builder first with a check, then every agent, with no search", () => {
        const onPick = vi.fn()
        render(
            <AgentSidebarSwitcher
                agents={agents}
                current={{kind: "builder"}}
                collapsed={false}
                onPick={onPick}
            />,
        )
        const items = screen.getAllByRole("menuitem")
        expect(items[0].textContent).toBe("Builder")
        expect(items[0].querySelector("svg")).toBeTruthy()
        expect(items.slice(1).map((item) => item.textContent)).toEqual(
            agents.map((agent) => agent.name),
        )
        // More agents than the agent sidebar's search threshold, and still no search field.
        expect(screen.queryByRole("textbox")).toBeNull()
        expect(screen.queryByText("Agent")).toBeNull()
        fireEvent.click(items[3])
        expect(onPick).toHaveBeenCalledWith("a2")
    })

    it("keeps the agent sidebar's menu: no Builder row, the search above 8 agents", () => {
        render(
            <AgentSidebarSwitcher
                agents={agents}
                current={{kind: "agent", agentId: "a1"}}
                collapsed={false}
                onPick={vi.fn()}
            />,
        )
        expect(screen.queryByTestId("agent-sidebar-switcher-builder")).toBeNull()
        expect(screen.getByRole("textbox")).toBeTruthy()
    })
})

describe("the search in the Chats heading", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        chatsCalls.length = 0
        chatRows = [
            {session_id: "s1", name: "Refund policy", updated_at: new Date().toISOString()},
            {session_id: "s2", name: "Weekly report", updated_at: new Date().toISOString()},
        ]
    })
    afterEach(() => vi.useRealTimers())

    const scope = createBuilderSidebarScope("w1", "p1", () => undefined)
    const Sidebar = () => {
        const sections = scope.useSections()
        return <NavMenu items={sections[0].items} collapsed={false} />
    }

    it("turns the heading into a field, filters by title on the server, and restores the list on Escape", () => {
        render(<Sidebar />)
        expect(screen.getByText("Chats")).toBeTruthy()
        fireEvent.click(screen.getByTestId("builder-chats-search"))

        const field = screen.getByTestId("builder-chats-search-field")
        expect(document.activeElement).toBe(field)
        expect(screen.queryByText("Chats")).toBeNull()

        fireEvent.change(field, {target: {value: "refund"}})
        act(() => void vi.advanceTimersByTime(300))
        expect(chatsCalls.at(-1)).toBe("refund")
        expect(screen.getByText("Refund policy")).toBeTruthy()
        expect(screen.queryByText("Weekly report")).toBeNull()

        fireEvent.change(field, {target: {value: "nothing like it"}})
        act(() => void vi.advanceTimersByTime(300))
        expect(screen.getByText("No chats found")).toBeTruthy()

        fireEvent.keyDown(field, {key: "Escape"})
        expect(screen.queryByTestId("builder-chats-search-field")).toBeNull()
        expect(screen.getByText("Chats")).toBeTruthy()
        expect(chatsCalls.at(-1)).toBe("")
        expect(screen.getByText("Refund policy")).toBeTruthy()
        expect(screen.getByText("Weekly report")).toBeTruthy()
    })

    it("closes on the x as well", () => {
        render(<Sidebar />)
        fireEvent.click(screen.getByTestId("builder-chats-search"))
        fireEvent.click(screen.getByRole("button", {name: "Clear search"}))
        expect(screen.queryByTestId("builder-chats-search-field")).toBeNull()
        expect(screen.getByText("Chats")).toBeTruthy()
    })
})
