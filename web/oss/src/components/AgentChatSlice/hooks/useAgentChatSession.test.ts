import {act, createElement} from "react"

import type {UIMessage} from "ai"
import {createRoot} from "react-dom/client"
import {beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const state = vi.hoisted(() => ({
    capturedHooks: undefined as
        | {
              prepareRequest: (args: {messages: UIMessage[]; id?: string}) => Promise<unknown>
          }
        | undefined,
    messages: [] as UIMessage[],
    latestTurnId: undefined as string | undefined,
    hitlPending: false,
    sessionTurnId: null as string | null,
    stoppingTurnId: null as string | null,
    stopStateLoading: false,
    cancelSessionExecution: vi.fn(),
    resolveStopExecution: vi.fn(),
    regenerate: vi.fn(() => Promise.resolve()),
    sendMessage: vi.fn(() => Promise.resolve()),
    turnIds: new Map<string, string>(),
    busy: false,
    stop: vi.fn(),
}))

vi.mock("@agenta/chat/assets", () => ({
    buildRequestWithinDeadline: (build: () => Promise<unknown>) => build(),
    getMessageTraceId: () => undefined,
    latestTurnId: () => state.latestTurnId,
    resolveStopExecution: state.resolveStopExecution,
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
    isSessionTurnStopping: ({
        currentTurnId,
        stoppingTurnId,
    }: {
        currentTurnId?: string | null
        stoppingTurnId?: string | null
    }) => Boolean(currentTurnId && stoppingTurnId === currentTurnId),
    parseAgentRunError: () => ({message: "error"}),
    reduceUserStoppedState: (
        current: {stopped: boolean; turnIdentity: null},
        event: {type: string},
    ) => {
        if (event.type === "user-stop" && !current.stopped) return {...current, stopped: true}
        if (event.type === "reset" && current.stopped) return {...current, stopped: false}
        return current
    },
}))

vi.mock("@agenta/chat/state", () => ({
    clearSessionTurnId: (sessionId: string) => state.turnIds.delete(sessionId),
    clearTurnClockAtom: "clear-turn-clock",
    expandedKeysForMessages: () => [],
    getSessionTurnId: (sessionId: string) => state.turnIds.get(sessionId),
    isChatBusy: () => state.busy,
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
    cancelSessionExecution: state.cancelSessionExecution,
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
    isHitlPending: () => state.hitlPending,
    isResumeSend: () => false,
    playgroundController: {actions: {switchEntity: "switch-entity"}},
    recordAnswerThenRelease: vi.fn(),
}))

vi.mock("@agenta/shared/state", () => ({
    agentSelfCommitSignalAtom: "commit-signal",
}))
vi.mock("@agenta/shared/utils", () => ({generateId: () => "generated-id"}))
vi.mock("@agenta/ui/app-message", () => ({message: {warning: vi.fn()}}))
vi.mock("@ai-sdk/react", () => ({
    useChat: () => ({
        addToolApprovalResponse: vi.fn(),
        addToolOutput: vi.fn(),
        error: undefined,
        messages: state.messages,
        regenerate: state.regenerate,
        sendMessage: state.sendMessage,
        setMessages: vi.fn(),
        status: "ready",
        stop: state.stop,
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
vi.mock("../assets/constants", () => ({
    doesAgentChatStopKillSession: () => false,
}))
vi.mock("../components/Inspector/invalidate", () => ({
    invalidateSessionInspector: vi.fn(),
}))
vi.mock("../state/scope", () => ({useChatScopeKey: () => "scope"}))
vi.mock("../state/sessions", () => ({
    openSessionIdsAtomFamily: () => "open-sessions",
}))
vi.mock("../state/turnCaptures", () => ({
    captureTurnRequestAtom: "capture-request",
}))
vi.mock("./useFileActivityDetector", () => ({
    useFileActivityDetector: vi.fn(),
}))
vi.mock("./useSessionHydration", () => ({
    useSessionHydration: () => ({
        hydratedEmpty: false,
        isHydrating: false,
        runningElsewhere: false,
        sessionTurnId: state.sessionTurnId,
        stoppingTurnId: state.stoppingTurnId,
        stopStateLoading: state.stopStateLoading,
    }),
}))
vi.mock("./useToolCacheInvalidation", () => ({
    useToolCacheInvalidation: vi.fn(),
}))

import {useAgentChatSession} from "./useAgentChatSession"

describe("useAgentChatSession execution guard", () => {
    beforeEach(() => {
        state.turnIds.clear()
        state.sendMessage.mockClear()
        state.regenerate.mockClear()
        state.cancelSessionExecution.mockReset()
        state.resolveStopExecution.mockReset()
        state.stop.mockReset()
        state.resolveStopExecution.mockImplementation(async ({readExecutionId}) => {
            const executionId = readExecutionId()
            return executionId ? {status: "resolved", executionId} : {status: "settled"}
        })
        state.latestTurnId = undefined
        state.hitlPending = false
        state.sessionTurnId = null
        state.stoppingTurnId = null
        state.stopStateLoading = false
        state.busy = false
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

    it("keeps remounted interaction actions closed until an accepted paused Stop settles", async () => {
        const sessionId = "session-1"
        state.latestTurnId = "turn-1"
        state.hitlPending = true
        state.cancelSessionExecution.mockResolvedValue({
            accepted: true,
            conflict: false,
            execution: {id: "turn-1", state: "stopping"},
        })

        let result: ReturnType<typeof useAgentChatSession> | undefined
        const Probe = () => {
            result = useAgentChatSession({
                entityId: "revision-1",
                sessionId,
                initialMessages: [],
                intent: {} as never,
            })
            return null
        }

        const firstContainer = document.createElement("div")
        const firstRoot = createRoot(firstContainer)
        act(() => firstRoot.render(createElement(Probe)))
        await act(async () => {
            result!.handleStop()
            await Promise.resolve()
        })
        expect(state.cancelSessionExecution).toHaveBeenCalledWith({
            sessionId,
            projectId: "project-id",
            expectedExecutionId: "turn-1",
        })
        act(() => firstRoot.unmount())

        state.sessionTurnId = "turn-1"
        state.stoppingTurnId = "turn-1"
        const remountContainer = document.createElement("div")
        const remountRoot = createRoot(remountContainer)
        act(() => remountRoot.render(createElement(Probe)))
        expect(result!.stopping).toBe(true)

        state.stoppingTurnId = null
        act(() => remountRoot.render(createElement(Probe)))
        expect(result!.stopping).toBe(false)

        act(() => remountRoot.unmount())
    })

    it("settles an acknowledged legacy Stop without entering the retry deadline", async () => {
        vi.useFakeTimers()
        const sessionId = "session-1"
        state.busy = true
        state.turnIds.set(sessionId, "turn-1")
        state.cancelSessionExecution.mockResolvedValue({
            accepted: true,
            conflict: false,
            execution: {id: "turn-1", state: "idle"},
        })

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

        await act(async () => {
            result!.handleStop()
            await Promise.resolve()
        })
        act(() => vi.advanceTimersByTime(30_000))

        expect(state.stop).toHaveBeenCalledOnce()
        expect(state.cancelSessionExecution).toHaveBeenCalledOnce()
        expect(result!.stopping).toBe(false)

        act(() => root.unmount())
        vi.useRealTimers()
    })

    it("drops a stale retry fence after conflict so the next Stop targets the observed run", async () => {
        vi.useFakeTimers()
        const sessionId = "session-1"
        state.busy = true
        state.turnIds.set(sessionId, "turn-original")
        state.cancelSessionExecution
            .mockResolvedValueOnce({
                accepted: true,
                conflict: false,
                execution: {id: "turn-original", state: "stopping"},
            })
            .mockResolvedValueOnce({
                accepted: false,
                conflict: true,
                execution: {id: null, state: "idle"},
            })
            .mockResolvedValueOnce({
                accepted: true,
                conflict: false,
                execution: {id: "turn-replacement", state: "stopping"},
            })

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

        await act(async () => {
            result!.handleStop()
            await Promise.resolve()
        })
        act(() => vi.advanceTimersByTime(30_000))

        state.turnIds.set(sessionId, "turn-replacement")
        await act(async () => {
            result!.handleStop()
            await Promise.resolve()
        })
        await act(async () => {
            result!.handleStop()
            await Promise.resolve()
        })

        expect(state.cancelSessionExecution).toHaveBeenNthCalledWith(2, {
            sessionId,
            projectId: "project-id",
            expectedExecutionId: "turn-original",
        })
        expect(state.cancelSessionExecution).toHaveBeenNthCalledWith(3, {
            sessionId,
            projectId: "project-id",
            expectedExecutionId: "turn-replacement",
        })

        act(() => root.unmount())
        vi.useRealTimers()
    })

    it("resets a pending execution lookup when the mounted session changes", async () => {
        let release!: (value: {status: "aborted"}) => void
        state.busy = true
        state.resolveStopExecution.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve
                }),
        )

        let sessionId = "session-1"
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

        act(() => result!.handleStop())
        expect(result!.stopping).toBe(true)

        sessionId = "session-2"
        act(() => root.render(createElement(Probe)))
        expect(result!.stopping).toBe(false)

        await act(async () => {
            release({status: "aborted"})
            await Promise.resolve()
        })
        expect(result!.stopping).toBe(false)

        act(() => root.unmount())
    })

    it("ignores a cancellation response from the previously mounted session", async () => {
        let release!: (value: {
            accepted: true
            conflict: false
            execution: {id: string; state: "stopping"}
        }) => void
        state.busy = true
        state.turnIds.set("session-1", "turn-1")
        state.cancelSessionExecution.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve
                }),
        )

        let sessionId = "session-1"
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

        act(() => result!.handleStop())
        expect(result!.stopping).toBe(true)

        sessionId = "session-2"
        act(() => root.render(createElement(Probe)))
        expect(result!.stopping).toBe(false)

        await act(async () => {
            release({
                accepted: true,
                conflict: false,
                execution: {id: "turn-1", state: "stopping"},
            })
            await Promise.resolve()
        })
        expect(result!.stopping).toBe(false)

        act(() => root.unmount())
    })

    it("waits for a resumed execution id before sending Stop", async () => {
        const sessionId = "session-1"
        let release!: (value: {status: "resolved"; executionId: string}) => void
        state.busy = true
        state.resolveStopExecution.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve
                }),
        )
        state.cancelSessionExecution.mockResolvedValue({
            accepted: true,
            conflict: false,
            execution: {id: "turn-resumed", state: "stopping"},
        })

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

        act(() => result!.handleStop())
        expect(state.resolveStopExecution).toHaveBeenCalledOnce()
        expect(state.cancelSessionExecution).not.toHaveBeenCalled()

        await act(async () => {
            release({status: "resolved", executionId: "turn-resumed"})
            await Promise.resolve()
        })
        expect(state.cancelSessionExecution).toHaveBeenCalledWith({
            sessionId,
            projectId: "project-id",
            expectedExecutionId: "turn-resumed",
        })

        act(() => root.unmount())
    })
})
