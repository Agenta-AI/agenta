// @vitest-environment jsdom
/**
 * The pane Sessions tab (B04) and the builder chat "⋯" menu (B03): the latest session shows at
 * once and the switcher picks another; the menu offers the session row's actions, and "Rename"
 * turns the title into an input.
 */
import {act, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const rows = [
    {session_id: "s-new", name: "Zahnwerk GmbH", updated_at: "2026-11-20T10:00:00Z"},
    {session_id: "s-old", name: "Dentalis AG", updated_at: "2026-11-19T10:00:00Z"},
]
vi.mock("@agenta/entities/session", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    sessionListQueryOptions: () => ({
        queryKey: ["pane-sessions-test"],
        queryFn: async () => ({sessions: rows, total: rows.length}),
    }),
}))
vi.mock("@/features/automations/AutomationRunConversation", () => ({
    AutomationRunConversation: ({sessionId}: {sessionId: string}) => (
        <div data-testid="conversation">{sessionId}</div>
    ),
}))
// The popover renders its content in place, so the rows are clickable in jsdom.
vi.mock("@agenta/ui/ui", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    Popover: ({children}: {children: ReactNode}) => <div>{children}</div>,
    PopoverTrigger: ({children}: {children: ReactNode}) => <div>{children}</div>,
    PopoverContent: ({children}: {children: ReactNode}) => <div>{children}</div>,
}))

const menu = vi.hoisted(() => ({clicked: [] as string[]}))
vi.mock("@agenta/sessions-ui", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useSessionActions: () => ({
        commitRename: async () => true,
        menuItems: () => [
            {key: "rename", label: "Rename"},
            {key: "archive", label: "Archive"},
            {key: "delete", label: "Delete", danger: true},
        ],
        onMenuClick:
            () =>
            ({key}: {key: string}) => {
                menu.clicked.push(key)
            },
    }),
}))
vi.mock("@/features/sessions/SessionRowMenu", () => ({
    SessionRowMenu: ({
        entries,
        onSelect,
        trigger,
    }: {
        entries: {key: string; label: string}[]
        onSelect: (key: string) => (() => void) | void
        trigger: ReactNode
    }) => (
        <div>
            {trigger}
            {entries.map((entry) => (
                <button
                    key={entry.key}
                    data-testid={`menu-${entry.key}`}
                    onClick={() => {
                        const run = onSelect(entry.key)
                        if (typeof run === "function") run()
                    }}
                />
            ))}
        </div>
    ),
}))
vi.mock("next/router", () => ({useRouter: () => ({basePath: "/m", push: vi.fn()})}))

import {BuilderChatTitle} from "@/features/builder-page/BuilderChatTitle"
import {
    PaneSessionSwitcher,
    PaneSessions,
    usePaneSessionPick,
} from "@/features/builder-page/PaneSessions"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    menu.clicked = []
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const render = async (node: ReactNode) => {
    await act(async () => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <Provider store={createStore()}>{node}</Provider>
            </QueryClientProvider>,
        )
    })
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const Pane = () => {
    const pick = usePaneSessionPick("p1", "agent-1")
    return (
        <>
            <PaneSessionSwitcher pick={pick} />
            <PaneSessions pick={pick} agentId="agent-1" projectId="p1" workspaceId="w1" />
        </>
    )
}

const byId = (id: string) => host.querySelector(`[data-testid="${id}"]`)

describe("Pane Sessions (B04)", () => {
    it("shows the latest session at once and switches to the one picked", async () => {
        await render(<Pane />)
        expect(byId("conversation")?.textContent).toBe("s-new")
        expect(byId("pane-session-switcher")?.textContent).toContain("Zahnwerk GmbH")
        const older = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Dentalis AG",
        )
        await act(async () => older?.click())
        expect(byId("conversation")?.textContent).toBe("s-old")
        expect(byId("pane-session-switcher")?.textContent).toContain("Dentalis AG")
    })
})

describe("Builder chat menu (B03)", () => {
    const title = (
        <BuilderChatTitle
            title="Lead outreach system"
            session={null}
            sessionId="chat-1"
            workspaceId="w1"
            projectId="p1"
            userId="user-1"
        />
    )

    it("offers the session actions and sends every verb but Rename to them", async () => {
        await render(title)
        expect(
            host.querySelector('button[aria-label="Actions for Lead outreach system"]'),
        ).not.toBe(null)
        await act(async () => (byId("menu-delete") as HTMLButtonElement).click())
        await act(async () => (byId("menu-archive") as HTMLButtonElement).click())
        expect(menu.clicked).toEqual(["delete", "archive"])
    })

    it("turns the title into an input on Rename", async () => {
        await render(title)
        expect(host.querySelector("input")).toBeNull()
        await act(async () => (byId("menu-rename") as HTMLButtonElement).click())
        expect(host.querySelector("input")).not.toBeNull()
        expect(menu.clicked).toEqual([])
    })
})
