// @vitest-environment jsdom
/**
 * A send outlives the chat screen that started it. When it fails after the user opened another
 * session, nothing on screen can take the message back: the session must stay listed, and the
 * message must wait as a failed task the screen offers again when the user returns. While the
 * screen is open, a failed first send still drops the session row, as before.
 *
 * The engine is a stub that hands back the callbacks the screen gives it; the screen under test is
 * the real `LiveConversation`, with the real pending-task atoms.
 */
import {act, type ReactNode} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const setupStep = vi.hoisted(() => ({blocking: false}))
const calls = vi.hoisted(() => ({
    dropLocalSession: vi.fn(),
    onSendFailed: null as null | ((message: unknown, error?: unknown) => void),
}))
const dialog = vi.hoisted(() => ({confirm: vi.fn()}))
// The refusal type the screen reads a reason from, kept apart from the rest of `@agenta/chat/model`.
const refusals = vi.hoisted(() => ({
    SendRefusedError: class extends Error {
        constructor(readonly statedReason: string) {
            super(statedReason)
        }
    },
}))

vi.mock("@agenta/chat/hooks", () => ({
    useAgentConversation: (options: {
        onSendFailed?: (message: unknown, error?: unknown) => void
    }) => {
        calls.onSendFailed = options.onSendFailed ?? null
        return {
            messages: [],
            turns: [],
            isHydrating: false,
            isEmpty: true,
            queued: [],
            editingId: null,
            hitlPending: false,
            stopped: false,
            status: "ready",
            sendInFlight: false,
            approvals: {
                open: false,
                recoverable: false,
                answered: false,
                responding: false,
                errorText: null,
                settledIds: new Set(),
                respond: vi.fn(),
                approveAll: vi.fn(),
            },
            sendToolOutput: vi.fn(),
            removeQueued: vi.fn(),
            sendQueuedNow: vi.fn(),
            sendNowPending: false,
            adoptRevision: vi.fn(),
            beginEdit: vi.fn(),
            cancelEdit: vi.fn(() => ""),
            revalidate: vi.fn(),
            send: vi.fn(),
            stop: vi.fn(),
            voidPendingResume: vi.fn(),
            interactionChanged: vi.fn(),
            rewind: vi.fn(),
            steer: vi.fn(),
            keepRefusedSend: vi.fn(),
            commitEdit: vi.fn(),
            inputBusy: false,
            retryHistory: vi.fn(),
        }
    },
    useAgentModelKeyStatus: () => ({gateActive: false, loading: false}),
    useAgentModelSetup: () => ({blocked: false, loading: false, canFix: false}),
    useElicitationDock: () => ({
        open: false,
        settlingIds: new Set(),
        settle: vi.fn(),
        dismiss: vi.fn(),
    }),
    useConnectionDock: () => ({
        open: false,
        settlingIds: new Set(),
        settle: vi.fn(),
        dismiss: vi.fn(),
    }),
    useComposerAttachments: () => ({restoreAttachments: vi.fn(), setRejections: vi.fn()}),
}))

vi.mock("@agenta/chat/components", () => ({
    ModelSetupBanner: () => null,
    ConnectionFocusProvider: ({children}: {children: ReactNode}) => children,
    ConnectionWarningStrip: () => null,
    ConnectionDock: () => <div data-testid="connection-dock" />,
    ElicitationDock: () => <div data-testid="elicitation-dock" />,
    QueuedMessagesDock: ({
        onRemove,
        onSendNow,
    }: {
        onRemove: (id: string) => void
        onSendNow?: (id: string) => void
    }) => (
        <div data-testid="queued-dock">
            <button data-testid="queued-send" onClick={() => onSendNow?.("q1")} />
            <button data-testid="queued-remove" onClick={() => onRemove("q1")} />
        </div>
    ),
    // A card that answers whatever it is told to: the guard must not depend on it hiding buttons.
    ApprovalCard: ({
        readOnly,
        onRespond,
        onApproveAll,
    }: {
        readOnly?: boolean
        onRespond: (input: {approvalId: string; approved: boolean}) => void
        onApproveAll: () => void
    }) => (
        <div data-testid="approval-card" data-read-only={readOnly ? "true" : "false"}>
            <button
                data-testid="approve"
                onClick={() => onRespond({approvalId: "gate-1", approved: true})}
            />
            <button data-testid="approve-all" onClick={() => onApproveAll()} />
        </div>
    ),
}))

vi.mock("@agenta/chat/model", () => ({
    SendRefusedError: refusals.SendRefusedError,
    refusedSendReason: (error: unknown) =>
        error instanceof refusals.SendRefusedError ? error.statedReason : null,
    getInteractionAvailability: () => ({approvals: true, parkedDocks: true}),
    getLivePendingApprovals: () => [],
    isSessionTurnStopping: () => false,
    deriveRemoteTurnPresentation: () => ({showActivity: false}),
}))
vi.mock("@agenta/chat/assets", () => ({
    latestTurnId: () => null,
    resolveStopExecution: vi.fn(),
    shouldShowStopControl: () => false,
    restoreRefusedSend: vi.fn(),
}))
vi.mock("@agenta/chat/clientTools", () => ({
    getPendingSecretInteractions: () => [],
}))
vi.mock("@agenta/chat/state", () => ({getSessionTurnId: () => null, runKey: () => ""}))
vi.mock("@agenta/entities/session", async () => {
    const {atom} = await import("jotai")
    return {
        cancelSessionExecution: vi.fn(),
        dropUnacceptedLocalSessionAtom: atom(null, (_get, _set, sessionId: string) =>
            calls.dropLocalSession(sessionId),
        ),
        markLocalSessionAcceptedAtom: atom(null, () => undefined),
        registerLocalSessionAtom: atom(null, () => undefined),
        isSessionFresh: () => false,
    }
})
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const ready = atom(true)
    return {
        invalidateAgentCommittedRevisionCache: vi.fn(),
        workflowBuildKitOverlayReadyAtomFamily: () => ready,
    }
})
vi.mock("@agenta/entity-ui/agent", () => ({AgentIntroCard: () => null}))
vi.mock("@agenta/entity-ui/clientTools", () => ({
    SecretRequestDock: () => <div data-testid="secret-dock" />,
}))
vi.mock("@agenta/entity-ui/onboarding", () => ({
    AgentSetupCard: () => null,
    PersonalAccountsCard: () => null,
}))
vi.mock("@/features/chat/usePersonalSetupStep", () => ({
    usePersonalSetupStep: () => ({open: false, items: [], pendingKeys: new Set()}),
}))
vi.mock("@agenta/shared/utils", () => ({isOnScreen: () => true, isOverlayOpen: () => false}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {warning: vi.fn()},
    modal: dialog,
}))
vi.mock("@agenta/ui/components/presentational", () => ({ChatBubble: () => null}))
vi.mock("@agenta/ui/quote-selection", () => ({QuoteSelectionLayer: () => null}))
vi.mock("@agenta/ui/shortcuts", () => ({
    isAltChord: (e: KeyboardEvent) => e.altKey && !e.ctrlKey && !e.metaKey,
}))
vi.mock("@agenta/ui/ui", () => ({Button: () => null}))
vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

vi.mock("@/components/ContentRail", async () => {
    const {forwardRef} = await import("react")
    return {
        ContentRail: forwardRef<HTMLDivElement, {children?: ReactNode}>(({children}, ref) => (
            <div ref={ref}>{children}</div>
        )),
    }
})
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({
        children,
        footer,
        scrollRef,
    }: {
        children: ReactNode
        footer?: ReactNode
        scrollRef?: React.Ref<HTMLDivElement>
    }) => (
        <div ref={scrollRef}>
            {children}
            {footer}
        </div>
    ),
}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/sessions/useLivenessPoll", () => ({
    livenessQueryKey: () => ["liveness"],
    useLivenessUpdatedAt: () => 0,
}))
vi.mock("@/features/wallet/useWalletSummary", () => ({
    useWalletSummary: () => ({data: undefined, isLoading: false}),
}))
vi.mock("@/features/chat/buildKitWait", () => ({waitForBuildKit: async () => true}))
vi.mock("@/features/chat/hasUnsavedConfigEdits", () => ({hasUnsavedConfigEdits: () => false}))
vi.mock("@/features/chat/steer", () => ({isSteerEnabled: () => true}))
vi.mock("@/features/chat/turnStatus", () => ({
    deriveMobileRemoteTurnPresentation: () => ({showActivity: false}),
    showTrailingWorkingPulse: () => false,
}))
vi.mock("@/features/chat/turnRowClass", () => ({mobileTurnRowClass: ""}))
vi.mock("@/features/chat/states/ChatStates", () => ({ChatLoading: () => null}))
vi.mock("@/features/chat/states/PendingTaskError", () => ({
    PendingTaskError: ({
        failureReason,
        retryDisabled,
    }: {
        failureReason?: string
        retryDisabled: boolean
    }) => (
        <div data-testid="task-error" data-retry-disabled={retryDisabled ? "true" : "false"}>
            {failureReason}
        </div>
    ),
}))
vi.mock("@/features/chat/ConnectModelStrip", () => ({ConnectModelStrip: () => null}))
vi.mock("@/features/chat/useOpenModelSetup", () => ({useOpenModelSetup: () => vi.fn()}))
vi.mock("@/features/chat/setupFailureRefresh", () => ({refreshOnSetupFailure: () => undefined}))
vi.mock("@/features/chat/Composer", () => ({
    Composer: ({disabled}: {disabled: boolean}) => (
        <div data-testid="composer" data-disabled={disabled ? "true" : "false"} />
    ),
}))
vi.mock("@/features/chat/TranscriptTurns", () => ({
    TranscriptTurns: ({
        onClientToolOutput,
        onRewind,
    }: {
        onClientToolOutput?: (output: unknown) => void
        onRewind?: (turn: {message: object}) => void
    }) => (
        <div data-testid="transcript" data-rewind={onRewind ? "true" : "false"}>
            {onRewind ? (
                <button data-testid="rewind" onClick={() => onRewind({message: {}})} />
            ) : null}
            {onClientToolOutput ? (
                <button data-testid="tool-answer" onClick={() => onClientToolOutput({})} />
            ) : null}
        </div>
    ),
}))
vi.mock("@/features/chat/useApprovalActions", () => ({
    useApprovalActions: () => ({phase: "idle", errorText: null, respond: vi.fn()}),
}))
vi.mock("@/features/chat/useSessionSetupStep", () => ({
    useSessionSetupStep: () => ({open: setupStep.blocking, blocking: setupStep.blocking}),
}))
vi.mock("@/features/chat/useSessionWatch", () => ({useSessionWatch: () => ({connected: true})}))
vi.mock("@/features/chat/useStartBlankSession", () => ({useStartBlankSession: () => vi.fn()}))
vi.mock("@/features/chat/useTranscriptAutoScroll", () => ({
    useTranscriptAutoScroll: () => ({ref: {current: null}, onScroll: vi.fn(), edgeMask: ""}),
}))

import {LiveConversation} from "@/features/chat/LiveConversation"
import {pendingTasksAtom} from "@/features/home/pendingTask"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

beforeEach(() => {
    setupStep.blocking = false
    calls.dropLocalSession.mockReset()
    calls.onSendFailed = null
    store = createStore()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const render = async () => {
    await act(async () =>
        root.render(
            <Provider store={store}>
                <LiveConversation
                    embedded
                    entityId="rev-1"
                    sessionId="session-1"
                    projectId="proj-1"
                    workspaceId="ws-1"
                    running={false}
                    stopStateLoading={false}
                    sharedReader={false}
                    agentId="agent-1"
                />
            </Provider>,
        ),
    )
}

const leave = async () => {
    await act(async () => root.unmount())
    root = createRoot(host)
}

const brief = {
    type: "file" as const,
    url: "https://files.test/brief.pdf",
    mediaType: "application/pdf",
    filename: "brief.pdf",
}
const refusal = new refusals.SendRefusedError("No credits remaining.")

describe("a send that fails after the user left the session", () => {
    it("keeps the session and offers the message again on return", async () => {
        await render()
        const onSendFailed = calls.onSendFailed!
        await leave()

        await act(async () =>
            onSendFailed({id: "m1", text: "hello", source: "local", fileParts: [brief]}, refusal),
        )

        expect(calls.dropLocalSession).not.toHaveBeenCalled()
        expect(store.get(pendingTasksAtom)["session-1"]).toEqual({
            agentId: "agent-1",
            text: "hello",
            parts: [brief],
            delivery: "failed",
            failureReason: "No credits remaining.",
        })

        await render()
        expect(host.querySelector('[data-testid="task-error"]')?.textContent).toBe(
            "No credits remaining.",
        )
    })

    it("leaves a Home task to its own send", async () => {
        const task = {agentId: "agent-1", text: "home task", delivery: "sending" as const}
        store.set(pendingTasksAtom, {"session-1": task})
        await render()
        const onSendFailed = calls.onSendFailed!
        await leave()

        await act(async () => onSendFailed({id: "m1", text: "home task", source: "local"}))

        expect(calls.dropLocalSession).not.toHaveBeenCalled()
        expect(store.get(pendingTasksAtom)["session-1"]).toBe(task)
    })
})

describe("a send that fails while the session is open", () => {
    it("drops the fresh session row and keeps no task, as before", async () => {
        await render()

        await act(async () => calls.onSendFailed!({id: "m1", text: "hello", source: "local"}))

        expect(calls.dropLocalSession).toHaveBeenCalledWith("session-1")
        expect(store.get(pendingTasksAtom)["session-1"]).toBeUndefined()
    })
})

describe("a failed task whose template connect step is up", () => {
    it("waits for the step before it can be sent again", async () => {
        store.set(pendingTasksAtom, {
            "session-1": {agentId: "agent-1", text: "hello", delivery: "failed"},
        })
        setupStep.blocking = true
        await render()
        const card = () => host.querySelector('[data-testid="task-error"]')
        expect(card()?.getAttribute("data-retry-disabled")).toBe("true")

        setupStep.blocking = false
        await render()
        expect(card()?.getAttribute("data-retry-disabled")).toBe("false")
    })
})
