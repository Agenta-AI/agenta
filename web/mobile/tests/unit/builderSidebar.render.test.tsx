// @vitest-environment jsdom
/**
 * The builder sidebar: the switcher on "Builder" and the search in the "Chats" heading.
 */
import type {ReactNode} from "react"

import {NavMenu} from "@agenta/navigation-ui"
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// cmdk scrolls the active row into view; jsdom has no scrollIntoView.
Element.prototype.scrollIntoView ??= () => undefined

// The rail's scroll fade and cmdk measure their boxes; jsdom has no ResizeObserver.
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
        DropdownMenuSeparator: () => <hr />,
        DropdownMenuItem: ({
            children,
            onSelect,
            ...rest
        }: {
            children: ReactNode
            onSelect?: () => void
            "data-testid"?: string
            "aria-current"?: "true"
        }) => (
            <button
                type="button"
                role="menuitem"
                data-testid={rest["data-testid"]}
                aria-current={rest["aria-current"]}
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

const routerPush = vi.fn()
vi.mock("next/router", () => ({
    default: {asPath: "/"},
    useRouter: () => ({push: routerPush, query: {}, pathname: "/", asPath: "/"}),
}))

const {AgentSidebarSwitcher} = await import("../../src/features/agent-sidebar/AgentSidebarSwitcher")
const {createBuilderSidebarScope} =
    await import("../../src/features/builder-page/builderSidebarScope")

afterEach(cleanup)

const agents = Array.from({length: 10}, (_, index) => ({id: `a${index}`, name: `Agent ${index}`}))

describe("the sidebar switcher", () => {
    it("in the builder sidebar: Builder first and checked, then every agent, no search", () => {
        const onPick = vi.fn()
        render(
            <AgentSidebarSwitcher
                agents={agents}
                current={{kind: "builder"}}
                collapsed={false}
                onPick={onPick}
                onPickBuilder={vi.fn()}
            />,
        )
        const items = screen.getAllByRole("menuitem")
        expect(items.map((item) => item.textContent)).toEqual([
            "Builder",
            ...agents.map((agent) => agent.name),
        ])
        expect(items[0].getAttribute("aria-current")).toBe("true")
        expect(items.slice(1).some((item) => item.getAttribute("aria-current"))).toBe(false)
        // More agents than the agent sidebar's search threshold, and still no search field.
        expect(screen.queryByRole("textbox")).toBeNull()
        fireEvent.click(items[3])
        expect(onPick).toHaveBeenCalledWith("a2")
    })

    it("in the agent sidebar: Builder first, the agent checked, Builder opens the builder", () => {
        const onPickBuilder = vi.fn()
        const onPick = vi.fn()
        render(
            <AgentSidebarSwitcher
                agents={agents}
                current={{kind: "agent", agentId: "a1"}}
                collapsed={false}
                onPick={onPick}
                onPickBuilder={onPickBuilder}
            />,
        )
        const builder = screen.getByTestId("agent-sidebar-switcher-builder")
        expect(builder.getAttribute("aria-current")).toBeNull()
        const current = screen
            .getAllByRole("menuitem")
            .find((item) => item.textContent === "Agent 1")!
        expect(current.getAttribute("aria-current")).toBe("true")
        fireEvent.click(current)
        expect(onPick).not.toHaveBeenCalled()
        fireEvent.click(builder)
        expect(onPickBuilder).toHaveBeenCalledOnce()
        // The agent sidebar keeps its agent search above 8 agents.
        expect(screen.getByRole("textbox")).toBeTruthy()
    })
})

describe("the search next to Chats", () => {
    beforeEach(() => {
        chatsCalls.length = 0
        chatRows = [
            {session_id: "s1", name: "Refund policy", updated_at: new Date().toISOString()},
            {session_id: "s2", name: "Weekly report", updated_at: new Date().toISOString()},
        ]
    })

    const scope = createBuilderSidebarScope("w1", "p1", () => undefined)
    const Sidebar = () => {
        const sections = scope.useSections()
        return <NavMenu items={sections[0].items} collapsed={false} />
    }

    it("opens the search window over the builder chats, searches on the server, and opens a pick", async () => {
        render(<Sidebar />)
        expect(screen.queryByRole("dialog")).toBeNull()
        fireEvent.click(screen.getByRole("button", {name: "Search chats"}))

        const dialog = await screen.findByRole("dialog")
        const field = within(dialog).getByPlaceholderText("Search chats")
        expect(within(dialog).getByText("Weekly report")).toBeTruthy()

        fireEvent.change(field, {target: {value: "refund"}})
        await waitFor(() => expect(chatsCalls.at(-1)).toBe("refund"))
        await waitFor(() => expect(within(dialog).queryByText("Weekly report")).toBeNull())
        fireEvent.click(within(dialog).getByText("Refund policy"))
        expect(routerPush).toHaveBeenCalledWith("/w/w1/p/p1/builder/s1")
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    })
})
