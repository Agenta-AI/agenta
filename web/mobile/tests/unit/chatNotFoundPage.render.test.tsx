// @vitest-environment jsdom
/** A chat the reader cannot open shows one plain not-found page, the same for a private and an unknown chat. */
import {act, type ReactNode} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

interface AgentRead {
    entityId: string | null
    agentId: string | null
    resolving: boolean
    unreachable?: boolean
}

const {agents, blocked} = vi.hoisted(() => ({
    agents: {} as Record<string, AgentRead>,
    blocked: new Set<string>(),
}))

vi.mock("@agenta/chat/model", () => ({
    buildTurnViewModels: () => [],
    createExecutedToolIdentityCache: () => ({}),
    createTurnViewModelCache: () => ({}),
    getPendingApprovals: () => [],
}))
vi.mock("@agenta/entities/session", async () => {
    const {atom} = await import("jotai")
    return {fetchSessionRecordsAtom: atom(null, async () => undefined), isSessionFresh: () => false}
})
vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {projectIdAtom: atom("proj-1")}
})

vi.mock("@/components/ContentRail", () => ({
    ContentRail: ({children}: {children?: ReactNode}) => children,
}))
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({children}: {children?: ReactNode}) => children,
}))
vi.mock("@/components/StatusTag", () => ({StatusTag: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/sessions/useLivenessPoll", () => ({
    useLivenessPoll: () => ({data: [], isLoading: false}),
}))
vi.mock("@/features/chat/useLeaveHeldTask", () => ({useLeaveHeldTask: () => undefined}))
vi.mock("@/features/chat/ApprovalDock", () => ({ApprovalDock: () => null}))
vi.mock("@/features/chat/ReadOnlyComposerNotice", () => ({ReadOnlyComposerNotice: () => null}))
// The workspace holds the tab strip and the config pane: it renders only for a chat that opens.
vi.mock("@/features/chat/SessionWorkspace", () => ({
    SessionWorkspace: ({
        chat,
        agentId,
        entityId,
    }: {
        chat: ReactNode
        agentId?: string | null
        entityId: string | null
    }) => (
        <div data-testid="workspace" data-agent={agentId ?? ""} data-entity={entityId ?? ""}>
            {chat}
        </div>
    ),
}))
vi.mock("@/features/chat/states/ChatStates", () => ({
    ChatEmpty: () => null,
    ChatLoading: () => <div data-testid="loading" />,
}))
vi.mock("@/features/chat/states/ChatUnreachable", () => ({ChatUnreachable: () => null}))
vi.mock("@/features/chat/TranscriptTurns", () => ({TranscriptTurns: () => null}))
vi.mock("@/features/chat/turnRuns", () => ({mergeAssistantRuns: (turns: unknown[]) => turns}))
vi.mock("@/features/chat/useAgentEntity", () => ({
    useAgentEntity: (sessionId: string) => {
        const read = agents[sessionId] ?? {entityId: null, agentId: null, resolving: false}
        return {
            ...read,
            unreachable: read.unreachable ?? false,
            refetchLatest: async () => ({status: "pending", data: undefined}),
            agentHidden: false,
            retry: () => undefined,
            retrying: false,
        }
    },
}))
vi.mock("@/features/chat/useAgentVisibilityRecheck", () => ({
    useAgentVisibilityRecheck: () => undefined,
}))
vi.mock("@/features/chat/useApprovalActions", () => ({
    useApprovalActions: () => ({phase: "idle"}),
}))
vi.mock("@/features/chat/useChatAccess", () => ({
    useChatAccess: ({sessionId}: {sessionId: string}) => ({
        blocked: blocked.has(sessionId) ? "not_found" : null,
        readOnly: null,
        canSend: !blocked.has(sessionId),
        accessPending: false,
        checkedAt: 0,
        agentHidden: false,
        rowAgentHidden: null,
    }),
}))
vi.mock("@/features/chat/useReferenceToolDisplays", () => ({
    useReferenceToolDisplays: () => undefined,
}))
vi.mock("@/features/chat/useSessionTranscript", () => ({
    useSessionTranscript: () => ({messages: [], state: "empty"}),
}))
vi.mock("@/features/chat/useSessionWatch", () => ({useSessionWatch: () => ({connected: false})}))
vi.mock("@/features/chat/useTranscriptAutoScroll", () => ({
    useTranscriptAutoScroll: () => ({ref: {current: null}}),
}))
vi.mock("@/features/chat/LiveConversation", () => ({
    LiveConversation: ({sessionId}: {sessionId: string}) => (
        <div data-testid="live" data-session={sessionId} />
    ),
}))
vi.mock("next/link", () => ({
    default: ({href, children}: {href: string; children: ReactNode}) => (
        <a href={href}>{children}</a>
    ),
}))

import {ChatScreen} from "@/features/chat/ChatScreen"
import {sharingCopy} from "@/lib/sharingCopy"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const OWN = "session-own"
const HIDDEN = "session-hidden"
const NEXT = "session-next"

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

beforeEach(() => {
    store = createStore()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    for (const key of Object.keys(agents)) delete agents[key]
    blocked.clear()
    agents[OWN] = {entityId: "rev-own", agentId: "agent-own", resolving: false}
    blocked.add(HIDDEN)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

/** The session route never remounts the screen: in-app navigation re-renders it. */
const open = async (sessionId: string) => {
    await act(async () =>
        root.render(
            <Provider store={store}>
                <ChatScreen sessionId={sessionId} projectId="proj-1" workspaceId="ws-1" />
            </Provider>,
        ),
    )
}

const workspace = () => host.querySelector('[data-testid="workspace"]')
const notFound = () => host.querySelector('[data-testid="chat-no-access-not_found"]')

describe("a chat link the reader cannot open", () => {
    it("opened fresh, shows only the not-found page, with no workspace around it", async () => {
        await open(HIDDEN)

        expect(notFound()).toBeTruthy()
        expect(workspace()).toBeNull()
        expect(host.textContent).toContain(sharingCopy.chatNotFound)
        expect(host.textContent).toContain(sharingCopy.chatNotFoundAskOwner)
    })

    it("opened from another chat, keeps nothing of that chat, and the next chat borrows nothing", async () => {
        await open(OWN)
        expect(workspace()?.getAttribute("data-agent")).toBe("agent-own")

        await open(HIDDEN)
        expect(notFound()).toBeTruthy()
        expect(workspace()).toBeNull()

        // A chat whose agent is still being read would hold the last agent across the gap.
        agents[NEXT] = {entityId: null, agentId: null, resolving: true}
        await open(NEXT)
        expect(workspace()?.getAttribute("data-agent")).toBe("")
        expect(workspace()?.getAttribute("data-entity")).toBe("")
    })

    it("looks the same whatever the agent read answers, so it does not tell a private chat from an unknown one", async () => {
        agents[HIDDEN] = {entityId: null, agentId: null, resolving: false, unreachable: true}
        await open(HIDDEN)
        const unknown = host.innerHTML

        agents[HIDDEN] = {entityId: null, agentId: null, resolving: true}
        await open(OWN)
        await open(HIDDEN)

        expect(host.innerHTML).toBe(unknown)
    })
})
