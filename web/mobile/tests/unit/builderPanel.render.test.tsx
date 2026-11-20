// @vitest-environment jsdom
/**
 * The Builder content of the panel (tasks 8.1, 24.1 to 24.3): the 2-day rule over the chats this
 * browser links to the agent, a new chat with quick actions and recent chats, the history, the
 * context chip, the page context of each message as a snapshot, and a switch to another session
 * of the same agent that renders nothing in the builder but the chip.
 */
import {act, useContext, useState, type ReactNode} from "react"

import {userAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

interface SeenProps {
    entityId: string
    sessionId: string
    beforeSend?: (text: string) => string | undefined
    inputRef?: {current: unknown}
    emptyState?: ReactNode
    composerHeader?: ReactNode
    belowComposer?: ReactNode
    composerPlaceholder?: string
    hideSlashCommands?: boolean
    userMessageAccessory?: (message: UIMessage) => ReactNode
}
const seen = vi.hoisted(() => ({
    props: null as null | SeenProps,
    role: null as string | null,
    renders: 0,
    mounts: 0,
    filled: [] as string[],
}))
vi.mock("@/features/chat/LiveConversation", async () => {
    const {useEffect} = await import("react")
    const {ConversationRoleContext} = await import("@/features/chat/conversationRole")
    return {
        LiveConversation: (props: SeenProps) => {
            seen.props = props
            seen.role = useContext(ConversationRoleContext)
            seen.renders += 1
            useEffect(() => {
                seen.mounts += 1
            }, [])
            if (props.inputRef)
                props.inputRef.current = {
                    setMarkdown: async (text: string) => {
                        seen.filled.push(text)
                    },
                    focus: () => undefined,
                }
            return (
                <div data-testid="conversation">
                    {props.emptyState}
                    <div data-testid="composer">{props.composerHeader}</div>
                    {props.belowComposer}
                </div>
            )
        },
    }
})
const live = vi.hoisted(() => ({running: [] as string[]}))
vi.mock("@/features/sessions/useLivenessPoll", () => ({
    useLivenessPoll: () => ({
        data: live.running.map((id) => ({session_id: id, flags: {is_running: true}})),
        isLoading: false,
    }),
}))
vi.mock("@/features/agent-layout/useAgentRow", () => ({
    useAgentRow: () => ({row: {id: "agent-1", name: "Support triage"}}),
}))
vi.mock("@/features/agent-layout/agentPanelContext", () => ({
    useAgentPanel: () => ({close: vi.fn()}),
}))
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        builderAgentRevisionIdQueryAtom: atom({
            data: "builder-rev",
            isPending: false,
            isFetching: false,
            refetch: () => undefined,
        }),
    }
})
// The chat list: the stored ids it was asked for, answered from `list.rows`.
const list = vi.hoisted(() => ({
    rows: [] as {session_id: string; name?: string; updated_at?: string}[],
    failed: false,
    /** The list on screen is the last query's, kept while this one loads. */
    placeholder: false,
    asked: [] as {sessionIds?: string[]; search?: string; enabled?: boolean}[],
}))
vi.mock("@agenta/sessions/state", () => ({
    useSessionList: (options: {sessionIds?: string[]; search?: string; enabled?: boolean}) => {
        list.asked.push(options)
        const ids = options.sessionIds ?? []
        const rows = list.rows.filter(
            (row) =>
                (list.placeholder || ids.includes(row.session_id)) &&
                (!options.search || row.name?.includes(options.search)),
        )
        return {
            data: options.enabled ? {pages: [list.failed ? null : {sessions: rows}]} : undefined,
            isPending: !options.enabled,
            isError: false,
            isPlaceholderData: list.placeholder,
            refetch: vi.fn(),
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
        }
    },
    rowsFromPages: (pages: ({sessions: unknown[]} | null)[] | undefined) =>
        (pages ?? []).flatMap((page) => page?.sessions ?? []),
}))
const headers = vi.hoisted(() => ({rows: {} as Record<string, {name?: string}>}))
vi.mock("@/features/chat/useSessionHeader", () => ({
    sessionHeaderKey: (projectId: string, sessionId: string) => [
        "session-stream",
        projectId,
        sessionId,
    ],
    useSessionHeader: (_projectId: string, sessionId: string) => ({
        data: sessionId ? (headers.rows[sessionId] ?? null) : undefined,
        isPending: false,
    }),
}))
vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("next/link", () => ({
    default: ({href, children, ...rest}: {href: string; children: ReactNode}) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}))

import {readBuilderChats, rememberBuilderChat} from "@/features/builder/builderChatLink"
import {BuilderPanel} from "@/features/builder/BuilderPanel"
import {
    pageContextAtom,
    parseContextLine,
    withContextLine,
    type PageContext,
} from "@/features/builder/pageContext"
import {builderChatLinkVersionAtom} from "@/features/builder/useBuilderChatList"
import {pageSessionIdAtom} from "@/features/chat/pageSessionId"
import {viewFormDirtyAtom} from "@/features/chat/viewFormDirty"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const NOW = Date.now()
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()

let root: Root
let container: HTMLDivElement
let store: ReturnType<typeof createStore>
let queryClient: QueryClient

/** Stands in for the agent layout: it renders again on every session switch. */
let switchSession: (sessionId: string) => void = () => undefined
const Layout = ({agentId}: {agentId: string}) => {
    const [, setSessionId] = useState("s1")
    switchSession = (sessionId) => {
        setSessionId(sessionId)
        store.set(pageSessionIdAtom, sessionId)
    }
    return <BuilderPanel agentId={agentId} workspaceId="w1" projectId="p1" />
}

const render = async (agentId = "agent-1") => {
    await act(async () => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>
                    <Layout agentId={agentId} />
                </Provider>
            </QueryClientProvider>,
        )
    })
}

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`)
const click = async (element: Element | null) => {
    await act(async () => {
        ;(element as HTMLElement).click()
    })
}
const button = (text: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text) ?? null

let userCount = 0
beforeEach(() => {
    window.localStorage.clear()
    seen.props = null
    seen.role = null
    seen.renders = 0
    seen.mounts = 0
    seen.filled = []
    list.rows = []
    list.failed = false
    list.placeholder = false
    list.asked = []
    live.running = []
    headers.rows = {}
    store = createStore()
    // A user per test: the panel keeps the last shown chat per user for a remount.
    userCount += 1
    store.set(userAtom, {id: `u${userCount}`} as never)
    queryClient = new QueryClient()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const user = () => `u${userCount}`

describe("BuilderPanel: which chat opens", () => {
    it("runs the builder's revision as the embedded conversation", async () => {
        await render()
        expect(seen.props?.entityId).toBe("builder-rev")
        expect(seen.role).toBe("embedded")
        expect(seen.props?.hideSlashCommands).toBe(true)
        expect(seen.props?.composerPlaceholder).toBe("Ask the builder about this agent")
    })

    it("opens the newest stored chat when it ran in the last 2 days", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "old-chat")
        rememberBuilderChat(user(), "p1", "agent-1", "recent-chat")
        list.rows = [
            {session_id: "recent-chat", name: "Urgency", updated_at: hoursAgo(30)},
            {session_id: "old-chat", name: "Old", updated_at: hoursAgo(200)},
        ]
        await render()
        expect(seen.props?.sessionId).toBe("recent-chat")
        expect(byTestId("builder-chat-title")?.textContent).toBe("Urgency")
        // A chat with messages shows no quick actions.
        expect(byTestId("builder-quick-actions")).toBeNull()
    })

    it("opens a new chat when the newest chat is 3 days old, and lists it under Recent chats", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "old-chat")
        list.rows = [
            {session_id: "old-chat", name: "Add the refund skill", updated_at: hoursAgo(72)},
        ]
        await render()
        expect(seen.props?.sessionId).not.toBe("old-chat")
        expect(byTestId("builder-chat-title")?.textContent).toBe("New chat")
        const recent = byTestId("builder-recent-chats")!
        expect(recent.textContent).toContain("Recent chats")
        expect(recent.textContent).toContain("Add the refund skill")
        expect(recent.textContent).toContain("3d")
        expect(recent.textContent).toContain("View all")
    })

    it("opens an old chat that still runs", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "running-chat")
        list.rows = [{session_id: "running-chat", updated_at: hoursAgo(72)}]
        live.running = ["running-chat"]
        await render()
        expect(seen.props?.sessionId).toBe("running-chat")
    })

    it("opens a new chat with no Recent chats part when none is stored, and links it at the first send", async () => {
        await render()
        const sessionId = seen.props!.sessionId
        expect(byTestId("builder-recent-chats")).toBeNull()
        // No stored id: nothing is asked of the server.
        expect(list.asked.every((options) => !options.enabled)).toBe(true)
        expect(readBuilderChats(user(), "p1", "agent-1")).toEqual([])
        act(() => void seen.props!.beforeSend!("Hello"))
        expect(readBuilderChats(user(), "p1", "agent-1")).toEqual([sessionId])
    })

    it("opens a new chat and says the list failed when the query fails", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "chat-1")
        list.rows = [{session_id: "chat-1", updated_at: hoursAgo(1)}]
        list.failed = true
        await render()
        expect(seen.props?.sessionId).not.toBe("chat-1")
        const recent = byTestId("builder-recent-chats")!
        expect(recent.textContent).toContain("The chats could not be loaded.")
        expect(recent.textContent).toContain("Try again")
    })

    it("shows no stored chat the query no longer returns", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "kept")
        rememberBuilderChat(user(), "p1", "agent-1", "gone")
        list.rows = [{session_id: "kept", name: "Kept chat", updated_at: hoursAgo(100)}]
        await render()
        const rows = [...container.querySelectorAll("[data-testid=builder-chat-row]")]
        expect(rows.map((row) => row.textContent)).toEqual(["Kept chat4d"])
    })

    it("asks for the stored ids in one stable order, whatever the link order", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "b")
        rememberBuilderChat(user(), "p1", "agent-1", "a")
        list.rows = [{session_id: "a", updated_at: hoursAgo(1)}]
        await render()
        expect(list.asked.at(-1)?.sessionIds).toEqual(["a", "b"])
    })

    it("never shows the chat of another agent", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "chat-1")
        list.rows = [{session_id: "chat-1", updated_at: hoursAgo(1)}]
        await render("agent-1")
        expect(seen.props?.sessionId).toBe("chat-1")
        await render("agent-2")
        expect(seen.props?.sessionId).not.toBe("chat-1")
    })
})

describe("BuilderPanel: another agent's list", () => {
    it("waits for this agent's list and never opens a chat from the list kept on screen", async () => {
        rememberBuilderChat(user(), "p1", "agent-2", "chat-2")
        list.rows = [
            {session_id: "chat-1", updated_at: hoursAgo(1)},
            {session_id: "chat-2", updated_at: hoursAgo(100)},
        ]
        list.placeholder = true
        await render("agent-2")
        expect(seen.props).toBeNull()
        list.placeholder = false
        // The real list answers on its own; here a link change makes the panel read it again.
        await act(async () => store.set(builderChatLinkVersionAtom, (v) => v + 1))
        expect(seen.props?.sessionId).not.toBe("chat-1")
        expect(seen.props?.sessionId).not.toBe("chat-2")
    })
})

describe("BuilderPanel: new chat", () => {
    it("shows the question and the line with the agent name", async () => {
        await render()
        expect(container.textContent).toContain("What should we change?")
        expect(container.textContent).toContain("I can change, test and explain Support triage.")
    })

    it("opens one quick action at a time, and a ready request fills the composer without sending", async () => {
        await render()
        await click(button("Test"))
        const ready = byTestId("builder-ready-requests")!
        expect(ready.textContent).toContain("Test with 5 sample requests")
        expect(ready.textContent).toContain("I write the requests and check the answers")
        await click(button("Skills"))
        expect(byTestId("builder-ready-requests")!.textContent).toContain("Suggest a skill")
        await click(button("Skills"))
        expect(byTestId("builder-ready-requests")).toBeNull()
        await click(button("Explain"))
        await click(
            [...container.querySelectorAll("[data-testid=builder-ready-requests] button")][0],
        )
        expect(seen.filled).toEqual(["Explain what this agent does"])
        expect(readBuilderChats(user(), "p1", "agent-1")).toEqual([])
    })

    it("opens a recent chat and starts a new one with +", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "old-chat")
        list.rows = [
            {session_id: "old-chat", name: "Add the refund skill", updated_at: hoursAgo(100)},
        ]
        await render()
        const firstNew = seen.props!.sessionId
        // The row button holds the title and the age.
        await click(
            [...container.querySelectorAll("[data-testid=builder-chat-row]")].find((row) =>
                row.textContent?.includes("Add the refund skill"),
            ) ?? null,
        )
        expect(seen.props?.sessionId).toBe("old-chat")
        await click(container.querySelector('[aria-label="New chat"]'))
        expect(seen.props?.sessionId).not.toBe("old-chat")
        expect(seen.props?.sessionId).not.toBe(firstNew)
    })

    it("opens the history with View all, and Back returns to the same chat", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "old-chat")
        list.rows = [{session_id: "old-chat", name: "Daily summary", updated_at: hoursAgo(100)}]
        await render()
        const sessionId = seen.props!.sessionId
        const mounts = seen.mounts
        await click(button("View all"))
        expect(byTestId("builder-chat-history")?.textContent).toContain("Daily summary")
        expect(container.textContent).toContain("Chat history")
        await click(container.querySelector('[aria-label="Back"]'))
        expect(byTestId("builder-chat-history")).toBeNull()
        // The chat stayed mounted under the history: its composer and scroll are as they were.
        expect(seen.props?.sessionId).toBe(sessionId)
        expect(seen.mounts).toBe(mounts)
    })

    it("links Open in the builder to the same chat with the agent in its pane", async () => {
        await render()
        const href = byTestId("builder-open-in-builder")?.getAttribute("href")
        expect(href).toBe(`/w/w1/p/p1/builder/${seen.props!.sessionId}?tab=agent%3Aagent-1`)
    })
})

describe("BuilderPanel: page context", () => {
    const configuration = {
        kind: "configuration" as const,
        tab: "agent" as const,
        item: {list: "skills" as const, key: "ticket-triage", name: "ticket-triage"},
    }
    const onSession = () => {
        store.set(pageSessionIdAtom, "s1")
        headers.rows.s1 = {name: "Charged twice for March"}
        queryClient.setQueryData(["session-stream", "p1", "s1"], {name: "Charged twice for March"})
    }

    it("shows the session on the chip and sends it, read at send time as a snapshot", async () => {
        onSession()
        await render()
        expect(byTestId("builder-context-chip")?.textContent).toBe(
            "Support triage · Charged twice for March",
        )
        const send = seen.props!.beforeSend!
        let first = ""
        act(() => void (first = send("Make replies shorter")!))
        expect(parseContextLine(first, "Make replies shorter")).toEqual({
            agent: {id: "agent-1", name: "Support triage"},
            page: {kind: "session", session: {id: "s1", name: "Charged twice for March"}},
            has_unsaved_draft: false,
        })
        // On Configuration with an open item and a form with edits.
        act(() => {
            store.set(pageContextAtom, configuration)
            store.set(viewFormDirtyAtom, true)
        })
        expect(byTestId("builder-context-chip")?.textContent).toBe("Support triage · ticket-triage")
        let second = ""
        act(() => void (second = send("Why is it slow?")!))
        // The person navigates away; the queued text keeps what was read at send time.
        act(() => {
            store.set(pageContextAtom, null)
            store.set(viewFormDirtyAtom, false)
        })
        expect(parseContextLine(second, "Why is it slow?")).toEqual({
            agent: {id: "agent-1", name: "Support triage"},
            page: configuration,
            has_unsaved_draft: true,
        })
        expect(parseContextLine(first, "Make replies shorter")?.page?.kind).toBe("session")
    })

    it("removes the chip, sends the agent only, and adds the page back", async () => {
        onSession()
        await render()
        await click(container.querySelector('[aria-label="Remove the context"]'))
        expect(byTestId("builder-context-chip")).toBeNull()
        expect(byTestId("builder-context-add")?.textContent).toBe("Add this page as context")
        let sent = ""
        act(() => void (sent = seen.props!.beforeSend!("Hi")!))
        expect(parseContextLine(sent, "Hi")?.page).toBeUndefined()
        expect(parseContextLine(sent, "Hi")?.agent.name).toBe("Support triage")
        await click(byTestId("builder-context-add"))
        expect(byTestId("builder-context-chip")?.textContent).toContain("Charged twice for March")
    })

    it("shows the chip again after a removal on another page", async () => {
        onSession()
        await render()
        await click(container.querySelector('[aria-label="Remove the context"]'))
        headers.rows.s2 = {name: "Login fails on Safari"}
        await act(async () => switchSession("s2"))
        expect(byTestId("builder-context-chip")?.textContent).toBe(
            "Support triage · Login fails on Safari",
        )
    })

    it("shows the chip a sent message carried, and none for a line with the agent only or no line", async () => {
        await render()
        const accessory = seen.props!.userMessageAccessory!
        const message = (context: PageContext | null, words: string): UIMessage => ({
            id: "m1",
            role: "user",
            parts: [{type: "text", text: context ? withContextLine(context, words) : words}],
            metadata: {display_content: words},
        })
        const agent = {id: "agent-1", name: "Support triage"}
        const withPage: PageContext = {agent, page: configuration, has_unsaved_draft: false}
        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <Provider store={store}>
                        <div data-testid="sent">
                            {accessory(message(withPage, "Why?"))}
                            {accessory(message({agent, has_unsaved_draft: false}, "Why?"))}
                            {accessory(message(null, "Why?"))}
                        </div>
                    </Provider>
                </QueryClientProvider>,
            )
        })
        const chips = container.querySelectorAll("[data-testid=builder-sent-context]")
        expect(chips).toHaveLength(1)
        expect(chips[0].textContent).toBe("Support triage · ticket-triage")
    })
})

describe("BuilderPanel: same-agent switch", () => {
    it("keeps the chat, its quick action and the conversation; only the chip renders", async () => {
        rememberBuilderChat(user(), "p1", "agent-1", "old-chat")
        list.rows = [{session_id: "old-chat", name: "Old", updated_at: hoursAgo(100)}]
        store.set(pageSessionIdAtom, "s1")
        headers.rows.s1 = {name: "Charged twice for March"}
        headers.rows.s2 = {name: "Login fails on Safari"}
        await render()
        await click(button("Test"))
        const sessionId = seen.props!.sessionId
        const renders = seen.renders
        const mounts = seen.mounts

        await act(async () => switchSession("s2"))

        expect(byTestId("builder-context-chip")?.textContent).toBe(
            "Support triage · Login fails on Safari",
        )
        // No render and no remount of the conversation: its composer text, scroll position and
        // running answer are untouched.
        expect(seen.renders).toBe(renders)
        expect(seen.mounts).toBe(mounts)
        expect(seen.props?.sessionId).toBe(sessionId)
        expect(byTestId("builder-ready-requests")).not.toBeNull()
    })

    it("restores the same chat and its open quick action after a remount (a page file change)", async () => {
        await render()
        await click(button("Automate"))
        const sessionId = seen.props!.sessionId
        act(() => root.unmount())
        root = createRoot(container)
        await render()
        expect(seen.props?.sessionId).toBe(sessionId)
        expect(byTestId("builder-ready-requests")?.textContent).toContain("Run it every morning")
    })
})
