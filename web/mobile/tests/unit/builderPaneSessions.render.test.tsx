// @vitest-environment jsdom
/**
 * The pane Sessions tab (B04, B07) and the builder chat "⋯" menu (B03): the latest session shows
 * at once, the picker picks another and "New session" shows a blank one in place; the menu offers
 * the session row's actions, and "Rename" turns the title into an input.
 */
import {act, type ReactNode} from "react"

import {sessionMessagesAtom} from "@agenta/chat/state"
import {clearSessionFresh, isSessionFresh} from "@agenta/entities/session"
import {QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const SEED = [
    {session_id: "s-new", name: "Zahnwerk GmbH", updated_at: "2026-11-20T10:00:00Z"},
    {session_id: "s-old", name: "Dentalis AG", updated_at: "2026-11-19T10:00:00Z"},
]
/** The server's session list; each test starts from SEED. */
const rows = [...SEED]
vi.mock("@agenta/entities/session", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    sessionListQueryOptions: () => ({
        queryKey: ["pane-sessions-test"],
        queryFn: async () => ({sessions: [...rows], total: rows.length}),
    }),
}))
vi.mock("@/features/automations/AutomationRunConversation", () => ({
    AutomationRunConversation: ({sessionId, agentId}: {sessionId: string; agentId: string}) => (
        <div data-testid="conversation" data-agent={agentId}>
            {sessionId}
        </div>
    ),
}))
// The real blank-session start, with ids in order.
const minted = vi.hoisted(() => ({count: 0}))
vi.mock("@/lib/ids", () => ({newId: () => `blank-${++minted.count}`}))
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
const router = vi.hoisted(() => ({push: vi.fn()}))
vi.mock("next/router", () => ({
    default: router,
    useRouter: () => ({basePath: "/m", push: router.push}),
}))

import {BuilderChatTitle} from "@/features/builder-page/BuilderChatTitle"
import {PaneSessionBar} from "@/features/builder-page/PaneSessionBar"
import {PaneSessions, usePaneSessionPick} from "@/features/builder-page/PaneSessions"
import {queryClient} from "@/lib/queryClient"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
/** A store that reads the app's query client, as the app's host hydrates it. */
const store = () => {
    const value = createStore()
    value.set(queryClientAtom, queryClient)
    return value
}
let root: Root
let jotaiStore: ReturnType<typeof createStore>

beforeEach(() => {
    menu.clicked = []
    rows.splice(0, rows.length, ...SEED)
    for (let n = 1; n <= minted.count; n++) clearSessionFresh(`blank-${n}`)
    minted.count = 0
    router.push.mockClear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    host.remove()
})

const render = async (node: ReactNode) => {
    await act(async () => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <Provider store={(jotaiStore = store())}>{node}</Provider>
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
            <PaneSessionBar pick={pick} />
            <PaneSessions pick={pick} agentId="agent-1" projectId="p1" workspaceId="w1" />
        </>
    )
}

const byId = (id: string) => host.querySelector(`[data-testid="${id}"]`)
/** The server list loads again, and its update reaches the screen (one more tick). */
const refetchList = () =>
    act(async () => {
        await queryClient.refetchQueries()
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
const newSession = () => byId("pane-new-session") as HTMLButtonElement
/** A row of the picker list (not the picker button itself). */
const pickerRow = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button:not([data-testid])")].find(
        (button) => button.textContent === name,
    )

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

    it("shows a blank session of the agent in place on New session", async () => {
        await render(<Pane />)
        await act(async () => newSession().click())
        expect(byId("conversation")?.textContent).toBe("blank-1")
        expect(byId("conversation")?.getAttribute("data-agent")).toBe("agent-1")
        expect(byId("pane-session-switcher")?.textContent).toContain("Untitled session")
        expect(isSessionFresh("blank-1")).toBe(true)
        expect(router.push).not.toHaveBeenCalled()
    })

    it("shows the unused blank session again on a second tap or after a switch away", async () => {
        await render(<Pane />)
        await act(async () => newSession().click())
        await act(async () => newSession().click())
        await act(async () => pickerRow("Zahnwerk GmbH")?.click())
        await act(async () => newSession().click())
        expect(minted.count).toBe(1)
        expect(byId("conversation")?.textContent).toBe("blank-1")
    })

    it("starts another blank session once the first has a message", async () => {
        await render(<Pane />)
        await act(async () => newSession().click())
        act(() =>
            jotaiStore.set(sessionMessagesAtom, {"blank-1": [{id: "m1", role: "user", parts: []}]}),
        )
        await act(async () => newSession().click())
        expect(minted.count).toBe(2)
        expect(byId("conversation")?.textContent).toBe("blank-2")
    })

    it("lists the blank session, so a switch away can come back to it", async () => {
        await render(<Pane />)
        await act(async () => newSession().click())
        await act(async () => pickerRow("Zahnwerk GmbH")?.click())
        expect(byId("conversation")?.textContent).toBe("s-new")
        await act(async () => pickerRow("Untitled session")?.click())
        expect(byId("conversation")?.textContent).toBe("blank-1")
    })

    it("drops a blank session once the list has it, so it does not come back", async () => {
        await render(<Pane />)
        await act(async () => newSession().click())
        rows.unshift({
            session_id: "blank-1",
            name: "Weekly check",
            updated_at: "2026-11-21T10:00:00Z",
        })
        await refetchList()
        expect(pickerRow("Weekly check")).toBeDefined()
        rows.shift()
        await refetchList()
        expect(pickerRow("Untitled session")).toBeUndefined()
    })

    it("offers New session when the agent has no sessions yet", async () => {
        rows.splice(0, rows.length)
        await render(<Pane />)
        expect(byId("pane-session-switcher")).toBeNull()
        expect(host.textContent).toContain("This agent has no sessions yet.")
        await act(async () => newSession().click())
        expect(byId("conversation")?.textContent).toBe("blank-1")
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
