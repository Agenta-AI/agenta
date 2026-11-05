// @vitest-environment jsdom
//
// The chat screen decides when the top bar may move a session to a newer version on its own. The
// screen is the real one; the workspace stub reports what it was told.
import {act, type ReactNode} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const world = vi.hoisted(() => ({
    entity: {
        entityId: "rev-1" as string | null,
        agentId: "agent-1" as string | null,
        followsAgent: true,
    },
    liveness: {data: [] as unknown[] | undefined, isLoading: false},
    autoUpdate: [] as (boolean | undefined)[],
}))

vi.mock("@agenta/chat/model", () => ({
    buildTurnViewModels: () => [],
    createExecutedToolIdentityCache: () => ({}),
    createTurnViewModelCache: () => ({}),
    getPendingApprovals: () => [],
    latestTurnId: () => null,
}))
vi.mock("@agenta/entities/session", async () => {
    const {atom} = await import("jotai")
    return {fetchSessionRecordsAtom: atom(null, async () => undefined), isSessionFresh: () => true}
})
vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {projectIdAtom: atom("proj-1")}
})
vi.mock("@/components/ContentRail", () => ({ContentRail: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({ScreenScaffold: () => null}))
vi.mock("@/components/StatusTag", () => ({StatusTag: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/features/home/pendingTask", async () => {
    const {atom} = await import("jotai")
    return {pendingTasksAtom: atom({})}
})
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/sessions/useLivenessPoll", () => ({useLivenessPoll: () => world.liveness}))
vi.mock("@/features/chat/ApprovalDock", () => ({ApprovalDock: () => null}))
vi.mock("@/features/chat/LiveConversation", () => ({LiveConversation: () => null}))
vi.mock("@/features/chat/ReadOnlyComposerNotice", () => ({ReadOnlyComposerNotice: () => null}))
vi.mock("@/features/chat/SessionWorkspace", () => ({
    SessionWorkspace: ({autoUpdateRevision}: {autoUpdateRevision?: boolean}) => {
        world.autoUpdate.push(autoUpdateRevision)
        return null
    },
}))
vi.mock("@/features/chat/states/ChatNoAccess", () => ({ChatNoAccess: () => null}))
vi.mock("@/features/chat/states/ChatStates", () => ({
    ChatEmpty: () => null,
    ChatLoading: () => null,
}))
vi.mock("@/features/chat/states/ChatUnreachable", () => ({ChatUnreachable: () => null}))
vi.mock("@/features/chat/TranscriptTurns", () => ({TranscriptTurns: () => null}))
vi.mock("@/features/chat/turnRuns", () => ({mergeAssistantRuns: (turns: unknown[]) => turns}))
vi.mock("@/features/chat/useAgentEntity", () => ({
    useAgentEntity: () => ({
        ...world.entity,
        resolving: false,
        refetchLatest: async () => ({status: "pending", data: undefined}),
        unreachable: false,
        agentHidden: false,
        retry: () => undefined,
        retrying: false,
    }),
}))
vi.mock("@/features/chat/useAgentVisibilityRecheck", () => ({
    useAgentVisibilityRecheck: () => undefined,
}))
vi.mock("@/features/chat/useApprovalActions", () => ({useApprovalActions: () => ({})}))
vi.mock("@/features/chat/useChatAccess", () => ({
    useChatAccess: () => ({
        blocked: null,
        readOnly: null,
        canSend: true,
        checkedAt: 0,
        agentHidden: false,
        rowAgentHidden: null,
    }),
}))
vi.mock("@/features/chat/useLeaveHeldTask", () => ({useLeaveHeldTask: () => undefined}))
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

import {ChatScreen} from "@/features/chat/ChatScreen"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const SESSION = "session-1"

describe("ChatScreen auto-update gate", () => {
    let host: HTMLDivElement
    let root: Root

    const told = async () => {
        await act(async () =>
            root.render(
                <Provider store={createStore()}>
                    <ChatScreen sessionId={SESSION} projectId="proj-1" workspaceId="ws-1" />
                </Provider>,
            ),
        )
        return world.autoUpdate.at(-1)
    }

    beforeEach(() => {
        world.entity = {entityId: "rev-1", agentId: "agent-1", followsAgent: true}
        world.liveness = {data: [], isLoading: false}
        world.autoUpdate = []
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
    })

    it("allows it for a settled session with its own revision and agent", async () => {
        expect(await told()).toBe(true)
    })

    it("holds while this session's turn runs", async () => {
        world.liveness = {
            data: [{session_id: SESSION, flags: {is_running: true}}],
            isLoading: false,
        }
        expect(await told()).toBe(false)
    })

    it("does not hold for a turn running in another session", async () => {
        world.liveness = {
            data: [{session_id: "session-2", flags: {is_running: true}}],
            isLoading: false,
        }
        expect(await told()).toBe(true)
    })

    it("holds until liveness has answered", async () => {
        world.liveness = {data: undefined, isLoading: true}
        expect(await told()).toBe(false)
    })

    it("holds when the liveness read failed", async () => {
        world.liveness = {data: undefined, isLoading: false}
        expect(await told()).toBe(false)
    })

    it("holds for a session bound to a variant or revision", async () => {
        world.entity = {entityId: "rev-1", agentId: "agent-1", followsAgent: false}
        expect(await told()).toBe(false)
    })

    it("holds while the bar shows the last session's revision", async () => {
        await told()
        world.entity = {entityId: null, agentId: "agent-2", followsAgent: true}
        expect(await told()).toBe(false)
    })

    it("holds while the bar shows the last session's agent", async () => {
        await told()
        world.entity = {entityId: "rev-2", agentId: null, followsAgent: false}
        expect(await told()).toBe(false)
    })
})
