// @vitest-environment jsdom
/**
 * The live chat for a reader who may not send: every control that writes is off. The approval
 * card's answer, its Alt+G shortcut, the queued messages, the parked question, connection and
 * secret docks, tool answers in the transcript, rewind and the held Home task. The same screen
 * with `canSend` keeps them all, so a case cannot pass on a screen that never offers anything.
 *
 * The engine and the docks are stubs that expose their callbacks as buttons; the screen under
 * test is the real `LiveConversation`, and what it hands each stub is the thing asked about.
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

const approval = {approvalId: "gate-1", toolName: "send_email"}

vi.mock("@agenta/chat/hooks", () => ({
    useAgentConversation: () => ({
        messages: [],
        turns: [{id: "t1", hidden: false, isUser: false, message: {}}],
        isHydrating: false,
        isEmpty: false,
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
vi.mock("@agenta/chat/clientTools", () => ({
    getPendingSecretInteractions: () => [{toolCallId: "secret-1"}],
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
        MODEL_SETUP_PLACEHOLDER: "Set up the model to send messages",
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
vi.mock("@/features/chat/useOpenModelSetup", () => ({useOpenModelSetup: () => vi.fn()}))
vi.mock("@/features/chat/Composer", () => ({
    Composer: ({
        disabled,
        sendDisabled,
        placeholder,
    }: {
        disabled: boolean
        sendDisabled?: boolean
        placeholder?: string
    }) => (
        <div
            data-testid="composer"
            data-disabled={disabled ? "true" : "false"}
            data-send-disabled={sendDisabled ? "true" : "false"}
            data-placeholder={placeholder ?? ""}
        />
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
    useApprovalActions: () => ({phase: "idle", errorText: null, respond: calls.steerRespond}),
}))
vi.mock("@/features/chat/useSessionSetupStep", () => ({
    useSessionSetupStep: () => ({open: false, blocking: false}),
}))
vi.mock("@/features/chat/useSessionWatch", () => ({useSessionWatch: () => ({connected: true})}))
vi.mock("@/features/chat/useStartBlankSession", () => ({useStartBlankSession: () => vi.fn()}))
vi.mock("@/features/chat/useTranscriptAutoScroll", () => ({
    useTranscriptAutoScroll: () => ({ref: {current: null}, onScroll: vi.fn(), edgeMask: ""}),
}))

import {LiveConversation} from "@/features/chat/LiveConversation"
import type {SessionReadOnly} from "@/features/chat/sessionReadOnly"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    for (const fn of Object.values(calls)) fn.mockReset()
    Object.assign(modelSetup, {blocked: false, loading: false, canFix: false})
    dialog.confirm.mockReset()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const viewer: SessionReadOnly = {
    reason: "viewer",
    notice: "You can view this chat, but you cannot send to it.",
    approvalNote: "Waiting for Alice Martin or someone who can send in this chat.",
}

const render = async (props: {readOnly?: SessionReadOnly | null; canSend?: boolean}) => {
    await act(async () =>
        root.render(
            <Provider store={createStore()}>
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
                    {...props}
                />
            </Provider>,
        ),
    )
}

const byId = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = async (id: string) => {
    const node = byId(id)
    if (node) await act(async () => node.click())
}
const altG = async () =>
    act(async () => {
        document.dispatchEvent(
            new KeyboardEvent("keydown", {key: "©", code: "KeyG", altKey: true, bubbles: true}),
        )
    })

/** Everything a reader could press; returns how many writes went out. */
const pressEverything = async () => {
    await altG()
    await click("approve")
    await click("approve-all")
    await click("queued-send")
    await click("queued-remove")
    await click("tool-answer")
    await click("task-retry")
    return Object.values(calls).reduce((sum, fn) => sum + fn.mock.calls.length, 0)
}

describe("the live chat for a reader who cannot send", () => {
    it.each([
        ["a Viewer (read-only)", {readOnly: viewer, canSend: false}],
        ["sharing not known yet (loading)", {readOnly: null, canSend: false}],
    ])("%s: no shortcut, tap or dock writes anything", async (_label, props) => {
        await render(props)

        expect(byId("approval-card")?.dataset.readOnly).toBe("true")
        expect(byId("queued-dock")).toBeNull()
        expect(byId("tool-answer")).toBeNull()
        expect(byId("elicitation-dock")).toBeNull()
        expect(byId("connection-dock")).toBeNull()
        expect(byId("secret-dock")).toBeNull()
        expect(byId("transcript")?.dataset.rewind).toBe("false")
        expect(byId("task-retry")?.dataset.disabled).toBe("true")
        expect(await pressEverything()).toBe(0)
    })

    it("a Viewer sees the notice in the composer's place; a load waits on a disabled composer", async () => {
        await render({readOnly: viewer, canSend: false})
        expect(byId("read-only-composer")?.textContent).toContain(viewer.notice)
        expect(byId("composer")).toBeNull()

        await render({readOnly: null, canSend: false})
        expect(byId("read-only-composer")).toBeNull()
        expect(byId("composer")?.dataset.disabled).toBe("true")
    })
})

describe("the live chat for a reader who can send", () => {
    it("keeps the shortcut and every control", async () => {
        await render({readOnly: null, canSend: true})

        expect(byId("approval-card")?.dataset.readOnly).toBe("false")
        expect(byId("queued-dock")).not.toBeNull()
        expect(byId("elicitation-dock")).not.toBeNull()
        expect(byId("transcript")?.dataset.rewind).toBe("true")
        expect(byId("composer")?.dataset.disabled).toBe("false")

        await altG()
        expect(calls.respond).toHaveBeenCalledWith(true)
        await click("queued-send")
        expect(calls.sendQueuedNow).toHaveBeenCalledWith("q1")
        await click("tool-answer")
        expect(calls.sendToolOutput).toHaveBeenCalled()
    })
})

describe("a rewind confirmation open when access goes", () => {
    it("its OK re-runs nothing", async () => {
        const confirm = vi.fn()
        calls.rewind.mockReturnValue({confirm, sideEffects: ["send_email"], restoreText: undefined})
        await render({readOnly: null, canSend: true})
        await click("rewind")
        expect(dialog.confirm).toHaveBeenCalledTimes(1)
        const {onOk} = dialog.confirm.mock.calls[0][0] as {onOk: () => void}

        // The recheck lowers the reader to a Viewer while the dialog is open.
        await render({readOnly: viewer, canSend: false})
        await act(async () => onOk())

        expect(confirm).not.toHaveBeenCalled()
    })

    it("its OK re-runs nothing once the chat was taken away (the screen unmounted)", async () => {
        const confirm = vi.fn()
        calls.rewind.mockReturnValue({confirm, sideEffects: ["send_email"], restoreText: undefined})
        await render({readOnly: null, canSend: true})
        await click("rewind")
        const {onOk} = dialog.confirm.mock.calls[0][0] as {onOk: () => void}

        // The sharing re-read answers 404: the chat screen replaces the conversation.
        await act(async () => root.render(<Provider store={createStore()}>{null}</Provider>))
        await act(async () => onOk())

        expect(confirm).not.toHaveBeenCalled()
    })

    it("with access kept, its OK re-runs the turn", async () => {
        const confirm = vi.fn()
        calls.rewind.mockReturnValue({confirm, sideEffects: ["send_email"], restoreText: undefined})
        await render({readOnly: null, canSend: true})
        await click("rewind")
        const {onOk} = dialog.confirm.mock.calls[0][0] as {onOk: () => void}
        await act(async () => onOk())

        expect(confirm).toHaveBeenCalledTimes(1)
    })
})

describe("an agent whose model needs setup", () => {
    it("turns Send off but keeps typing, swaps the placeholder and holds the Home task", async () => {
        modelSetup.blocked = true
        await render({readOnly: null, canSend: true})

        const composer = byId("composer")
        expect(composer?.dataset.disabled).toBe("false")
        expect(composer?.dataset.sendDisabled).toBe("true")
        expect(composer?.dataset.placeholder).toBe("Set up the model to send messages")
        expect(byId("task-retry")?.dataset.disabled).toBe("true")
    })

    it("keeps Retry off while the check has not answered, and on once it has", async () => {
        modelSetup.loading = true
        await render({readOnly: null, canSend: true})

        expect(byId("composer")?.dataset.sendDisabled).toBe("false")
        expect(byId("task-retry")?.dataset.disabled).toBe("true")

        modelSetup.loading = false
        await render({readOnly: null, canSend: true})
        expect(byId("task-retry")?.dataset.disabled).toBe("false")
    })
})
