// @vitest-environment jsdom
/**
 * The slots the builder chat fills in the live conversation (task 24.1): the empty state, the
 * chip inside the composer, the part under the composer, the composer placeholder and input
 * handle, no `/` palette, and what shows with a sent user message. With none of them set, the
 * session's own conversation renders as before.
 */
import {act, type ReactNode} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const calls = vi.hoisted(() => ({
    respond: vi.fn(),
    approveAll: vi.fn(),
    sendToolOutput: vi.fn(),
    removeQueued: vi.fn(),
    sendQueuedNow: vi.fn(),
    steerRespond: vi.fn(),
    sendPendingTask: vi.fn(),
    rewind: vi.fn(),
}))
const dialog = vi.hoisted(() => ({confirm: vi.fn()}))
const modelSetup = vi.hoisted(() => ({blocked: false, loading: false, canFix: false}))
const personalSetup = vi.hoisted(() => ({open: false}))
const engine = vi.hoisted(() => ({isEmpty: false}))

const approval = {approvalId: "gate-1", toolName: "send_email"}

vi.mock("@agenta/chat/hooks", () => ({
    useAgentConversation: () => ({
        messages: [
            {
                id: "m1",
                role: "user",
                parts: [{type: "text", text: "line\n\nHello"}],
                metadata: {display_content: "Hello"},
            },
        ],
        turns: [{id: "t1", hidden: false, isUser: false, message: {}}],
        isHydrating: false,
        isEmpty: engine.isEmpty,
        queued: [{id: "q1", text: "queued text"}],
        editingId: null,
        hitlPending: true,
        stopped: false,
        status: "ready",
        sendInFlight: false,
        approvals: {
            open: true,
            recoverable: false,
            answered: false,
            responding: false,
            errorText: null,
            settledIds: new Set(),
            respond: calls.respond,
            approveAll: calls.approveAll,
        },
        sendToolOutput: calls.sendToolOutput,
        removeQueued: calls.removeQueued,
        sendQueuedNow: calls.sendQueuedNow,
        sendNowPending: false,
        adoptRevision: vi.fn(),
        beginEdit: vi.fn(),
        cancelEdit: vi.fn(() => ""),
        revalidate: vi.fn(),
        send: vi.fn(),
        stop: vi.fn(),
        voidPendingResume: vi.fn(),
        interactionChanged: vi.fn(),
        rewind: calls.rewind,
        steer: vi.fn(),
        keepRefusedSend: vi.fn(),
        commitEdit: vi.fn(),
        inputBusy: false,
        retryHistory: vi.fn(),
    }),
    useAgentModelKeyStatus: () => ({gateActive: false, loading: false}),
    useAgentModelSetup: () => modelSetup,
    // The docks open only when the screen enables them, as the real hooks do.
    useElicitationDock: ({enabled}: {enabled: boolean}) => ({
        open: enabled,
        settlingIds: new Set(),
        settle: calls.sendToolOutput,
        dismiss: vi.fn(),
    }),
    useConnectionDock: ({enabled}: {enabled: boolean}) => ({
        open: enabled,
        settlingIds: new Set(),
        settle: calls.sendToolOutput,
        dismiss: vi.fn(),
    }),
    useSecretDock: ({enabled}: {enabled: boolean}) => ({
        open: enabled,
        front: enabled ? {toolCallId: "secret-1"} : null,
        settlingIds: new Set(),
        settle: calls.sendToolOutput,
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
    getInteractionAvailability: () => ({approvals: true, parkedDocks: true}),
    getLivePendingApprovals: () => [approval],
    isSessionTurnStopping: () => false,
    deriveRemoteTurnPresentation: () => ({showActivity: false}),
}))
vi.mock("@agenta/chat/assets", () => ({
    latestTurnId: () => null,
    resolveStopExecution: vi.fn(),
    shouldShowStopControl: () => false,
    restoreRefusedSend: vi.fn(),
}))
vi.mock("@agenta/chat/state", () => ({getSessionTurnId: () => null, runKey: () => ""}))
vi.mock("@agenta/entities/session", async () => {
    const {atom} = await import("jotai")
    return {
        cancelSessionExecution: vi.fn(),
        dropUnacceptedLocalSessionAtom: atom(null, () => undefined),
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
vi.mock("@agenta/entity-ui/agent", () => ({
    AgentIntroCard: () => <div data-testid="intro-card" />,
}))
vi.mock("@agenta/entity-ui/needs-setup", () => ({
    modelSetupPlaceholder: () => "Set up the model to send messages",
}))
vi.mock("@agenta/entity-ui/clientTools", () => ({
    SecretRequestDock: () => <div data-testid="secret-dock" />,
}))
vi.mock("@agenta/entity-ui/onboarding", () => ({
    PersonalAccountsCard: () => <div data-testid="personal-card" />,
}))
vi.mock("@/features/chat/usePersonalSetupStep", () => ({
    usePersonalSetupStep: () => ({open: personalSetup.open, items: [], pendingKeys: new Set()}),
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
vi.mock("@/features/home/pendingTask", async () => {
    const {atom} = await import("jotai")
    return {
        pendingTasksAtom: atom({
            "session-1": {text: "held task", delivery: "failed", parts: []},
        }),
        sendPendingTaskAtom: atom(null, (_get, _set, input: unknown) =>
            calls.sendPendingTask(input),
        ),
        failPendingTaskAtom: atom(null, () => undefined),
        keepFailedSendAtom: atom(null, () => undefined),
    }
})
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/sessions/useLivenessPoll", () => ({
    livenessQueryKey: () => ["liveness"],
    useLivenessUpdatedAt: () => 0,
}))
vi.mock("@/features/wallet/useWalletSummary", () => ({
    useWalletSummary: () => ({data: undefined, isLoading: false}),
    walletSummaryKey: (projectId: string) => ["wallet", "summary", projectId],
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
    PendingTaskError: ({onRetry, retryDisabled}: {onRetry: () => void; retryDisabled: boolean}) => (
        <button
            data-testid="task-retry"
            data-disabled={retryDisabled ? "true" : "false"}
            onClick={onRetry}
        />
    ),
}))
vi.mock("@/features/chat/ConnectModelStrip", () => ({ConnectModelStrip: () => null}))
const stripSeen = vi.hoisted(() => ({canSwitchModel: undefined as boolean | undefined}))
vi.mock("@/features/wallet/CreditAlertStrip", () => ({
    CreditAlertStrip: ({canSwitchModel}: {canSwitchModel?: boolean}) => {
        stripSeen.canSwitchModel = canSwitchModel
        return null
    },
}))
vi.mock("@/features/chat/useOpenModelSetup", () => ({useOpenModelSetup: () => vi.fn()}))
vi.mock("@/features/chat/Composer", () => ({
    Composer: ({
        placeholder,
        headerExtra,
        hideSlashCommands,
        inputRef,
    }: {
        placeholder?: string
        headerExtra?: ReactNode
        hideSlashCommands?: boolean
        inputRef?: {current: unknown}
    }) => {
        composerSeen.inputRef = inputRef
        return (
            <div
                data-testid="composer"
                data-placeholder={placeholder ?? ""}
                data-hide-slash-commands={hideSlashCommands ? "true" : "false"}
            >
                {headerExtra}
            </div>
        )
    },
}))
const composerSeen = vi.hoisted(() => ({inputRef: undefined as undefined | {current: unknown}}))
vi.mock("@/features/chat/TranscriptTurns", async () => {
    const {useContext} = await import("react")
    const {UserMessageAccessoryContext} = await import("@/features/chat/userMessageAccessory")
    const Accessory = () => {
        const read = useContext(UserMessageAccessoryContext) as ((id: string) => ReactNode) | null
        return <div data-testid="accessory">{read ? read("m1") : "none"}</div>
    }
    return {TranscriptTurns: () => <Accessory />}
})
vi.mock("@/features/chat/useApprovalActions", () => ({
    useApprovalActions: () => ({phase: "idle", errorText: null, respond: calls.steerRespond}),
}))
vi.mock("@/features/chat/useSessionWatch", () => ({useSessionWatch: () => ({connected: true})}))
// The builder follow reads `@agenta/playground/state`; it has its own test.
vi.mock("@/features/builder/useBuilderCommitChecks", () => ({
    useBuilderCommitChecks: () => undefined,
}))
vi.mock("@/features/chat/useStartBlankSession", () => ({useStartBlankSession: () => vi.fn()}))
vi.mock("@/features/chat/useTranscriptAutoScroll", () => ({
    useTranscriptAutoScroll: () => ({ref: {current: null}, onScroll: vi.fn(), edgeMask: ""}),
}))

import {LiveConversation} from "@/features/chat/LiveConversation"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    engine.isEmpty = true
    stripSeen.canSwitchModel = undefined
    composerSeen.inputRef = undefined
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const base = {
    entityId: "rev-1",
    sessionId: "session-1",
    projectId: "p1",
    workspaceId: "w1",
    running: false,
    stopStateLoading: false,
    sharedReader: false,
    embedded: true,
}

const render = async (props: Partial<Parameters<typeof LiveConversation>[0]> = {}) => {
    await act(async () => {
        root.render(
            <Provider store={createStore()}>
                <LiveConversation {...base} {...props} />
            </Provider>,
        )
    })
}

const byId = (id: string) => host.querySelector(`[data-testid="${id}"]`)

describe("LiveConversation slots", () => {
    it("renders the session conversation as before when no slot is set", async () => {
        await render()
        expect(byId("intro-card")).not.toBeNull()
        const composer = byId("composer")!
        expect(composer.getAttribute("data-placeholder")).toBe("")
        expect(composer.getAttribute("data-hide-slash-commands")).toBe("false")
        expect(composer.textContent).toBe("")
        expect(byId("accessory")!.textContent).toBe("none")
        expect(byId("below")).toBeNull()
        // The session chat keeps "Switch model" on the credit strip.
        expect(stripSeen.canSwitchModel).toBe(true)
    })

    it("tells the credit strip when the model is not the person's to change", async () => {
        await render({canSwitchModel: false})
        expect(stripSeen.canSwitchModel).toBe(false)
    })

    it("puts each slot in its place", async () => {
        const inputRef = {current: null}
        await render({
            emptyState: <div data-testid="empty" />,
            composerHeaderExtra: <span data-testid="chip" />,
            belowComposer: <div data-testid="below" />,
            composerPlaceholder: "Ask the builder about this agent",
            inputRef,
            hideSlashCommands: true,
            userMessageAccessory: (message) => (
                <span data-testid="sent-chip">{String(message.metadata && "seen")}</span>
            ),
        })
        expect(byId("empty")).not.toBeNull()
        expect(byId("intro-card")).toBeNull()
        const composer = byId("composer")!
        expect(composer.querySelector('[data-testid="chip"]')).not.toBeNull()
        expect(composer.getAttribute("data-placeholder")).toBe("Ask the builder about this agent")
        expect(composer.getAttribute("data-hide-slash-commands")).toBe("true")
        expect(composerSeen.inputRef).toBe(inputRef)
        expect(byId("below")).not.toBeNull()
        // The accessory gets the stored message, full text and metadata included.
        expect(byId("sent-chip")?.textContent).toBe("seen")
    })
})
