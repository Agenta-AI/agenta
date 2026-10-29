// @vitest-environment jsdom
/**
 * A first message typed on Home or an agent's page waits on the chat screen until the screen can
 * send it (the transcript, the vault and the setup step all hold it). A user who opens another
 * chat during that wait must not lose it: the chat stays in the rail, and coming back shows the
 * message as not sent, with its text, ready to retry. Staging lost the message, the rail row and
 * the chat itself in 3 of 4 switches made 0.5 s to 1.6 s after Enter.
 *
 * The screen under test is the real `ChatScreen`, with the real pending-task and local-session
 * atoms. The conversation is a stub that never sends, which is what the real one does while its
 * task is held.
 */
import {act, type ReactNode, StrictMode} from "react"

import {localSessionsAtom} from "@agenta/entities/session"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/chat/model", () => ({
    buildTurnViewModels: () => [],
    createExecutedToolIdentityCache: () => ({}),
    createTurnViewModelCache: () => ({}),
    getPendingApprovals: () => [],
}))
vi.mock("@agenta/entities/session", async () => {
    const {atom} = await import("jotai")
    const local = await import("../../../packages/agenta-entities/src/session/core/localSessions")
    const fresh = await import("../../../packages/agenta-entities/src/session/core/freshSessions")
    return {...local, ...fresh, fetchSessionRecordsAtom: atom(null, async () => undefined)}
})
vi.mock("@agenta/chat/state", async () => {
    const fresh = await import("../../../packages/agenta-entities/src/session/core/freshSessions")
    return {markSessionFresh: fresh.markSessionFresh}
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
vi.mock("@/features/chat/ApprovalDock", () => ({ApprovalDock: () => null}))
vi.mock("@/features/chat/ReadOnlyComposerNotice", () => ({ReadOnlyComposerNotice: () => null}))
vi.mock("@/features/chat/SessionWorkspace", () => ({
    SessionWorkspace: ({chat}: {chat: ReactNode}) => chat,
}))
vi.mock("@/features/chat/states/ChatNoAccess", () => ({
    ChatNoAccess: () => <div data-testid="no-access" />,
}))
vi.mock("@/features/chat/states/ChatStates", () => ({
    ChatEmpty: () => null,
    ChatLoading: () => <div data-testid="loading" />,
}))
vi.mock("@/features/chat/states/ChatUnreachable", () => ({ChatUnreachable: () => null}))
vi.mock("@/features/chat/TranscriptTurns", () => ({TranscriptTurns: () => null}))
vi.mock("@/features/chat/turnRuns", () => ({mergeAssistantRuns: (turns: unknown[]) => turns}))
// A session the server does not list resolves only through the agent it is handed.
vi.mock("@/features/chat/useAgentEntity", () => ({
    useAgentEntity: (_sessionId: string, _projectId: string, fallback?: string | null) => ({
        entityId: fallback ? `rev-of-${fallback}` : null,
        agentId: fallback ?? null,
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
vi.mock("@/features/chat/useApprovalActions", () => ({
    useApprovalActions: () => ({phase: "idle"}),
}))
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
vi.mock("@/features/chat/LiveConversation", async () => {
    const {useAtomValue} = await import("jotai")
    const {pendingTasksAtom} = await import("@/features/home/pendingTask")
    return {
        // Holds its task, as the real screen does until the transcript and the vault answer.
        LiveConversation: ({sessionId, entityId}: {sessionId: string; entityId: string}) => {
            const task = useAtomValue(pendingTasksAtom)[sessionId]
            return (
                <div
                    data-testid="live"
                    data-session={sessionId}
                    data-entity={entityId}
                    data-delivery={task?.delivery ?? (task ? "held" : "none")}
                />
            )
        },
    }
})

import {ChatScreen} from "@/features/chat/ChatScreen"
import {pendingTasksAtom, stashPendingTaskAtom} from "@/features/home/pendingTask"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const NEW = "session-new"
const OTHER = "session-other"
const MESSAGE = "Reply with the single word kestrel01252."

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

beforeEach(() => {
    vi.useFakeTimers()
    store = createStore()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
})

/** The session route, as `pages/.../sessions/[session_id].tsx` renders it: never remounted. */
const open = async (
    sessionId: string,
    agentId?: string,
    {strict = false, projectId = "proj-1"} = {},
) => {
    const screen = (
        <Provider store={store}>
            <ChatScreen
                sessionId={sessionId}
                projectId={projectId}
                workspaceId="ws-1"
                agentId={agentId}
            />
        </Provider>
    )
    await act(async () => root.render(strict ? <StrictMode>{screen}</StrictMode> : screen))
}

const wait = async (ms: number) => {
    await act(async () => {
        vi.advanceTimersByTime(ms)
    })
}

/** Enter on an agent's page: the task is stashed and the route opens with the agent in it. */
const sendFromAgentPage = async () => {
    store.set(stashPendingTaskAtom, {sessionId: NEW, task: {agentId: "agent-1", text: MESSAGE}})
    await open(NEW, "agent-1")
    expect(host.querySelector('[data-testid="live"]')?.getAttribute("data-delivery")).toBe("held")
}

const live = () => host.querySelector('[data-testid="live"]')

describe.each([300, 600, 1500])("the user opens another chat %i ms after Enter", (afterMs) => {
    it("keeps the chat in the rail and offers the message again on return", async () => {
        await sendFromAgentPage()
        await wait(afterMs)

        // The rail's link carries no agent.
        await open(OTHER)
        await wait(0)

        expect(store.get(pendingTasksAtom)[NEW]).toEqual({
            agentId: "agent-1",
            text: MESSAGE,
            delivery: "failed",
        })
        expect(store.get(localSessionsAtom)[NEW]).toMatchObject({
            sessionId: NEW,
            projectId: "proj-1",
            agentId: "agent-1",
            name: MESSAGE,
        })

        await open(NEW)
        expect(live()?.getAttribute("data-session")).toBe(NEW)
        expect(live()?.getAttribute("data-entity")).toBe("rev-of-agent-1")
        expect(live()?.getAttribute("data-delivery")).toBe("failed")
    })
})

describe("leaving the chat screen", () => {
    it("for another page keeps the message the same way", async () => {
        await sendFromAgentPage()
        await wait(500)

        await act(async () => root.unmount())
        root = createRoot(host)
        await wait(0)

        expect(store.get(pendingTasksAtom)[NEW]?.delivery).toBe("failed")
        expect(store.get(localSessionsAtom)[NEW]?.agentId).toBe("agent-1")
    })

    it("leaves a send already on its way to its own outcome", async () => {
        await sendFromAgentPage()
        const sending = {agentId: "agent-1", text: MESSAGE, delivery: "sending" as const}
        await act(async () => store.set(pendingTasksAtom, {[NEW]: sending}))

        await open(OTHER)
        await wait(0)

        expect(store.get(pendingTasksAtom)[NEW]).toBe(sending)
        expect(store.get(localSessionsAtom)[NEW]).toBeUndefined()
    })

    it("does nothing while the screen stays on the session", async () => {
        await sendFromAgentPage()
        await open(NEW, "agent-1")
        await wait(1500)

        expect(store.get(pendingTasksAtom)[NEW]?.delivery).toBeUndefined()
        expect(store.get(localSessionsAtom)[NEW]).toBeUndefined()
    })

    it("does nothing when strict mode mounts the screen twice", async () => {
        store.set(stashPendingTaskAtom, {sessionId: NEW, task: {agentId: "agent-1", text: MESSAGE}})
        await open(NEW, "agent-1", {strict: true})
        await wait(1500)

        expect(store.get(pendingTasksAtom)[NEW]?.delivery).toBeUndefined()
        expect(store.get(localSessionsAtom)[NEW]).toBeUndefined()
    })

    it("keeps a task that already failed listed, with its reason", async () => {
        await sendFromAgentPage()
        const failed = {
            agentId: "agent-1",
            text: MESSAGE,
            delivery: "failed" as const,
            failureReason: "No credits remaining.",
        }
        await act(async () => store.set(pendingTasksAtom, {[NEW]: failed}))

        await open(OTHER)
        await wait(0)

        expect(store.get(pendingTasksAtom)[NEW]).toBe(failed)
        expect(store.get(localSessionsAtom)[NEW]?.agentId).toBe("agent-1")
    })

    it("does nothing when the user comes back before the check runs", async () => {
        await sendFromAgentPage()
        await open(OTHER)
        await open(NEW)
        await wait(0)

        expect(store.get(pendingTasksAtom)[NEW]?.delivery).toBeUndefined()
        expect(store.get(localSessionsAtom)[NEW]).toBeUndefined()
    })

    it("lists the chat under the project it was sent in", async () => {
        await sendFromAgentPage()
        await open(OTHER, undefined, {projectId: "proj-2"})
        await wait(0)

        expect(store.get(localSessionsAtom)[NEW]?.projectId).toBe("proj-1")
    })
})
