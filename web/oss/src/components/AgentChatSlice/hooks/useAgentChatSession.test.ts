import {act, createElement} from "react"
import {createRoot} from "react-dom/client"
import type {UIMessage} from "ai"
import {beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const state = vi.hoisted(() => ({
    capturedHooks: undefined as
        | {prepareRequest: (args: {messages: UIMessage[]; id?: string}) => Promise<unknown>}
        | undefined,
    regenerate: vi.fn(() => Promise.resolve()),
    sendMessage: vi.fn(() => Promise.resolve()),
    turnIds: new Map<string, string>(),
}))

vi.mock("@agenta/chat/assets", () => ({
    buildRequestWithinDeadline: (build: () => Promise<unknown>) => build(),
    getMessageTraceId: () => undefined,
    latestTurnId: () => undefined,
    startupLabelFromDataPart: () => undefined,
}))

vi.mock("@agenta/chat/hooks", () => ({
    useSessionChat: (args: {hooks: NonNullable<typeof state.capturedHooks>}) => {
        state.capturedHooks = args.hooks
        return {}
    },
}))

vi.mock("@agenta/chat/model", () => ({
    createUserStoppedState: () => ({stopped: false, turnIdentity: null}),
    ignoreStreamRejection: () => undefined,
    parseAgentRunError: () => ({message: "error"}),
    reduceUserStoppedState: (
        state: {stopped: boolean; turnIdentity: null},
        event: {type: string},
    ) => ({
        ...state,
        stopped: event.type === "user-stop" ? true : event.type === "reset" ? false : state.stopped,
    }),
}))

vi.mock("@agenta/chat/state", () => ({
    clearSessionTurnId: (sessionId: string) => state.turnIds.delete(sessionId),
    clearTurnClockAtom: "clear-turn-clock",
    expandedKeysForMessages: () => [],
    getSessionTurnId: (sessionId: string) => state.turnIds.get(sessionId),
    isChatBusy: () => false,
    persistSessionMessagesAtom: "persist-messages",
    pruneExpandedAtom: "prune-expanded",
    sessionMessagesAtom: "session-messages",
    sessionRecordCountsReadAtom: "record-counts",
    setSessionStatusAtom: "set-session-status",
    setSessionTurnId: (sessionId: string, turnId: string) => state.turnIds.set(sessionId, turnId),
    stampMessagesCreatedAtAtom: "stamp-created-at",
    startTurnClockAtom: "start-turn-clock",
}))

vi.mock("@agenta/entities/session", () => ({
    cancelSessionStream: vi.fn(),
    invalidateSessionListQueries: vi.fn(),
    killSession: vi.fn(),
    recordInteractionAnswerAtom: "record-interaction-answer",
    revalidateSessionMountsAtom: "revalidate-mounts",
    revalidateSessionRecordsAtom: "revalidate-records",
}))

vi.mock("@agenta/entities/trace", () => ({markTraceAsFresh: vi.fn()}))
vi.mock("@agenta/entities/workflow", () => ({
    invalidateAgentCommittedRevisionCache: vi.fn(),
    workflowMolecule: {
        selectors: {configuration: () => "workflow-configuration"},
    },
}))

vi.mock("@agenta/playground", () => ({
    agentShouldResumeAfterApproval: () => true,
    approvalResolution: vi.fn(),
    buildAgentRequest: vi.fn(async () => ({
        invocationUrl: "https://agent.test/invoke",
        headers: {},
        requestBody: {},
    })),
    buildTurnCapture: vi.fn(),
    isHitlPending: () => false,
    isResumeSend: () => false,
    playgroundController: {actions: {switchEntity: "switch-entity"}},
    recordAnswerThenRelease: vi.fn(),
}))

vi.mock("@agenta/shared/state", () => ({agentSelfCommitSignalAtom: "commit-signal"}))
vi.mock("@agenta/shared/utils", () => ({generateId: () => "generated-id"}))
vi.mock("@agenta/ui/app-message", () => ({message: {warning: vi.fn()}}))
vi.mock("@ai-sdk/react", () => ({
    useChat: () => ({
        addToolApprovalResponse: vi.fn(),
        addToolOutput: vi.fn(),
        error: undefined,
        messages: [],
        regenerate: state.regenerate,
        sendMessage: state.sendMessage,
        setMessages: vi.fn(),
        status: "ready",
        stop: vi.fn(),
    }),
}))
vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

vi.mock("jotai", () => ({
    useAtomValue: () => "project-id",
    useSetAtom: () => vi.fn(),
    useStore: () => ({
        get: (atom: string) => {
            if (atom === "record-counts" || atom === "session-messages") return {}
            if (atom === "open-sessions") return new Set()
            return undefined
        },
    }),
}))

vi.mock("@/oss/state/project", () => ({projectIdAtom: "project-id"}))
vi.mock("../assets/constants", () => ({doesAgentChatStopKillSession: () => false}))
vi.mock("../assets/stopState", () => ({
    isStoppingPhase: () => false,
    reduceStopPhase: (state: string) => state,
}))
vi.mock("../components/Inspector/invalidate", () => ({invalidateSessionInspector: vi.fn()}))
vi.mock("../state/scope", () => ({useChatScopeKey: () => "scope"}))
vi.mock("../state/sessions", () => ({openSessionIdsAtomFamily: () => "open-sessions"}))
vi.mock("../state/turnCaptures", () => ({captureTurnRequestAtom: "capture-request"}))
vi.mock("./useFileActivityDetector", () => ({useFileActivityDetector: vi.fn()}))
vi.mock("./useSessionHydration", () => ({
    useSessionHydration: () => ({
        hydratedEmpty: false,
        isHydrating: false,
        runningElsewhere: false,
    }),
}))
vi.mock("./useToolCacheInvalidation", () => ({useToolCacheInvalidation: vi.fn()}))

import {useAgentChatSession} from "./useAgentChatSession"

describe("useAgentChatSession execution guard", () => {
    beforeEach(() => {
        state.turnIds.clear()
        state.sendMessage.mockClear()
        state.regenerate.mockClear()
    })

    it("clears the previous turn before sends, regeneration, and SDK automatic requests", async () => {
        const sessionId = "session-1"
        let result: ReturnType<typeof useAgentChatSession> | undefined
        const container = document.createElement("div")
        const root = createRoot(container)
        const Probe = () => {
            result = useAgentChatSession({
                entityId: "revision-1",
                sessionId,
                initialMessages: [],
                intent: {} as never,
            })
            return null
        }
        act(() => root.render(createElement(Probe)))

        state.turnIds.set(sessionId, "turn-before-send")
        act(() => void result!.sendMessage({text: "next"}))
        expect(state.turnIds.get(sessionId)).toBeUndefined()

        state.turnIds.set(sessionId, "turn-before-regenerate")
        act(() => void result!.regenerate())
        expect(state.turnIds.get(sessionId)).toBeUndefined()

        state.turnIds.set(sessionId, "turn-before-auto-resume")
        await act(() => state.capturedHooks!.prepareRequest({messages: [], id: sessionId}))
        expect(state.turnIds.get(sessionId)).toBeUndefined()

        act(() => root.unmount())
    })
})
