// @vitest-environment jsdom
/**
 * The Builder content of the panel (task 8.1): it opens the newest chat this browser links to the
 * agent, or a new chat; it mounts the builder chat as the "embedded" conversation on the builder's
 * revision; and each message carries the page context of the moment it is sent, as a snapshot.
 */
import {act, useContext} from "react"

import {userAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const seen = vi.hoisted(() => ({
    props: null as null | {
        entityId: string
        sessionId: string
        beforeSend?: (text: string) => string | undefined
    },
    role: null as string | null,
}))
vi.mock("@/features/chat/LiveConversation", async () => {
    const {ConversationRoleContext} = await import("@/features/chat/conversationRole")
    return {
        LiveConversation: (props: NonNullable<typeof seen.props>) => {
            seen.props = props
            seen.role = useContext(ConversationRoleContext)
            return null
        },
    }
})
vi.mock("@/features/sessions/useLivenessPoll", () => ({
    useLivenessPoll: () => ({data: [], isLoading: false}),
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

import {readBuilderChats, rememberBuilderChat} from "@/features/builder/builderChatLink"
import {BuilderPanel} from "@/features/builder/BuilderPanel"
import {pageContextAtom, parseContextLine} from "@/features/builder/pageContext"
import {viewFormDirtyAtom} from "@/features/chat/viewFormDirty"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root
let container: HTMLDivElement
let store: ReturnType<typeof createStore>

const render = async (agentId = "agent-1") => {
    await act(async () => {
        root.render(
            <Provider store={store}>
                <BuilderPanel agentId={agentId} workspaceId="w1" projectId="p1" />
            </Provider>,
        )
    })
}

beforeEach(() => {
    window.localStorage.clear()
    seen.props = null
    seen.role = null
    store = createStore()
    store.set(userAtom, {id: "u1"} as never)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe("BuilderPanel", () => {
    it("runs the builder's revision as the embedded conversation", async () => {
        await render()
        expect(seen.props?.entityId).toBe("builder-rev")
        expect(seen.role).toBe("embedded")
    })

    it("opens the newest chat linked to this agent", async () => {
        rememberBuilderChat("u1", "p1", "agent-1", "old-chat")
        rememberBuilderChat("u1", "p1", "agent-1", "new-chat")
        await render()
        expect(seen.props?.sessionId).toBe("new-chat")
    })

    it("opens a new chat when none is linked, and links it at the first send", async () => {
        await render()
        const chatId = seen.props!.sessionId
        expect(readBuilderChats("u1", "p1", "agent-1")).toEqual([])
        seen.props!.beforeSend!("Hello")
        expect(readBuilderChats("u1", "p1", "agent-1")).toEqual([chatId])
    })

    it("never shows the chat of another agent", async () => {
        rememberBuilderChat("u1", "p1", "agent-1", "chat-1")
        await render("agent-1")
        await render("agent-2")
        expect(seen.props?.sessionId).not.toBe("chat-1")
    })

    it("reads the page context at send time and the line stays a snapshot", async () => {
        await render()
        const send = seen.props!.beforeSend!
        // On the session screen: the agent only.
        const first = send("Make replies shorter")!
        expect(parseContextLine(first, "Make replies shorter")).toEqual({
            agent: {id: "agent-1", name: "Support triage"},
            has_unsaved_draft: false,
        })
        // On Configuration with an open item and a form with edits.
        const page = {
            kind: "configuration" as const,
            tab: "agent" as const,
            item: {list: "skills" as const, key: "ticket-triage", name: "ticket-triage"},
        }
        store.set(pageContextAtom, page)
        store.set(viewFormDirtyAtom, true)
        const second = send("Why is it slow?")!
        // The person navigates away; the queued text keeps what was read at send time.
        store.set(pageContextAtom, null)
        store.set(viewFormDirtyAtom, false)
        expect(parseContextLine(second, "Why is it slow?")).toEqual({
            agent: {id: "agent-1", name: "Support triage"},
            page,
            has_unsaved_draft: true,
        })
        expect(parseContextLine(first, "Make replies shorter")?.page).toBeUndefined()
    })
})
