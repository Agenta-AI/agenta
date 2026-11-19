// @vitest-environment jsdom
/**
 * Two conversations on one screen: the session's own ("page") and the builder chat ("embedded").
 * A run or approval shortcut acts on the focused conversation only, and on the page conversation
 * when the focus is in neither (design D6, task 7.1). The role is a context value, so a role change
 * keeps the same mount: the composer and the scroller are the same nodes with the same state.
 *
 * The engine is a stub per session id; the screen under test is the real `LiveConversation`.
 */
import {act, type ReactNode} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const calls = vi.hoisted(() => ({
    approve: vi.fn<(sessionId: string) => void>(),
    stop: vi.fn<(sessionId: string) => void>(),
}))

vi.mock("@agenta/chat/hooks", () => ({
    useAgentConversation: ({sessionId}: {sessionId: string}) => ({
        messages: [],
        turns: [{id: "t1", hidden: false, isUser: false, message: {}}],
        isHydrating: false,
        isEmpty: false,
        queued: [],
        editingId: null,
        hitlPending: false,
        stopped: false,
        status: "streaming",
        sendInFlight: false,
        approvals: {
            open: true,
            recoverable: false,
            answered: false,
            responding: false,
            errorText: null,
            settledIds: new Set(),
            respond: () => calls.approve(sessionId),
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
        // The first thing a Stop does, before any request.
        voidPendingResume: () => calls.stop(sessionId),
        interactionChanged: vi.fn(),
        rewind: vi.fn(),
        steer: vi.fn(),
        keepRefusedSend: vi.fn(),
        commitEdit: vi.fn(),
        inputBusy: false,
        retryHistory: vi.fn(),
    }),
    useAgentModelKeyStatus: () => ({gateActive: false, loading: false}),
    useAgentModelSetup: () => ({blocked: false, loading: false, canFix: false}),
    useElicitationDock: () => ({open: false, settlingIds: new Set(), dismiss: vi.fn()}),
    useConnectionDock: () => ({open: false, settlingIds: new Set(), dismiss: vi.fn()}),
    useSecretDock: () => ({open: false, front: null, settlingIds: new Set(), dismiss: vi.fn()}),
    useComposerAttachments: () => ({restoreAttachments: vi.fn(), setRejections: vi.fn()}),
}))
vi.mock("@agenta/chat/components", () => ({
    ModelSetupBanner: () => null,
    ConnectionFocusProvider: ({children}: {children: ReactNode}) => children,
    ConnectionWarningStrip: () => null,
    ConnectionDock: () => null,
    ElicitationDock: () => null,
    QueuedMessagesDock: () => null,
    ApprovalCard: () => null,
}))
vi.mock("@agenta/chat/model", () => ({
    getInteractionAvailability: () => ({approvals: true, parkedDocks: false}),
    getLivePendingApprovals: () => [{approvalId: "gate-1", toolName: "send_email"}],
    isSessionTurnStopping: () => false,
}))
vi.mock("@agenta/chat/assets", () => ({
    latestTurnId: () => null,
    // Never settles: the stop under test is the call that starts it.
    resolveStopExecution: () => new Promise(() => undefined),
    shouldShowStopControl: () => true,
    restoreRefusedSend: vi.fn(),
}))
vi.mock("@agenta/chat/state", () => ({getSessionTurnId: () => undefined}))
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
vi.mock("@agenta/entity-ui/agent", () => ({AgentIntroCard: () => null}))
vi.mock("@agenta/entity-ui/needs-setup", () => ({modelSetupPlaceholder: () => ""}))
vi.mock("@agenta/entity-ui/clientTools", () => ({SecretRequestDock: () => null}))
vi.mock("@agenta/entity-ui/onboarding", () => ({PersonalAccountsCard: () => null}))
vi.mock("@/features/chat/usePersonalSetupStep", () => ({
    usePersonalSetupStep: () => ({open: false, items: [], pendingKeys: new Set()}),
}))
vi.mock("@agenta/shared/utils", () => ({isOnScreen: () => true, isOverlayOpen: () => false}))
vi.mock("@agenta/ui/app-message", () => ({message: {warning: vi.fn()}, modal: {}}))
vi.mock("@agenta/ui/components/presentational", () => ({ChatBubble: () => null}))
vi.mock("@agenta/ui/quote-selection", () => ({QuoteSelectionLayer: () => null}))
vi.mock("@agenta/ui/shortcuts", () => ({
    isAltChord: (e: KeyboardEvent) => e.altKey && !e.ctrlKey && !e.metaKey,
}))
vi.mock("@agenta/ui/ui", () => ({Button: () => null}))
vi.mock("@tanstack/react-query", () => ({useQueryClient: () => ({invalidateQueries: vi.fn()})}))
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
        <div data-testid="scroller" ref={scrollRef}>
            {children}
            {footer}
        </div>
    ),
}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))
vi.mock("@/features/home/pendingTask", async () => {
    const {atom} = await import("jotai")
    return {
        pendingTasksAtom: atom({}),
        sendPendingTaskAtom: atom(null, () => undefined),
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
vi.mock("@/features/chat/turnStatus", () => ({
    deriveMobileRemoteTurnPresentation: () => ({showActivity: false}),
    showTrailingWorkingPulse: () => false,
}))
vi.mock("@/features/chat/turnRowClass", () => ({mobileTurnRowClass: ""}))
vi.mock("@/features/chat/states/ChatStates", () => ({ChatLoading: () => null}))
vi.mock("@/features/chat/states/PendingTaskError", () => ({PendingTaskError: () => null}))
vi.mock("@/features/chat/ConnectModelStrip", () => ({ConnectModelStrip: () => null}))
vi.mock("@/features/wallet/CreditAlertStrip", () => ({CreditAlertStrip: () => null}))
vi.mock("@/features/chat/useOpenModelSetup", () => ({useOpenModelSetup: () => vi.fn()}))
// A stand-in composer with a real field, so the focus can sit in a conversation.
vi.mock("@/features/chat/Composer", () => ({
    Composer: ({sessionId}: {sessionId: string}) => (
        <textarea data-testid={`composer-${sessionId}`} />
    ),
}))
vi.mock("@/features/chat/TranscriptTurns", () => ({TranscriptTurns: () => null}))
vi.mock("@/features/chat/ApprovalDock", () => ({ApprovalDock: () => null}))
vi.mock("@/features/chat/useApprovalActions", () => ({
    useApprovalActions: () => ({phase: "idle", errorText: null, respond: vi.fn()}),
}))
vi.mock("@/features/chat/useSessionWatch", () => ({useSessionWatch: () => ({connected: true})}))
vi.mock("@/features/chat/useStartBlankSession", () => ({useStartBlankSession: () => vi.fn()}))
// The scroll memory has its own test; here the scroller only has to be a node that stays.
vi.mock("@/features/chat/useTranscriptAutoScroll", () => ({
    useTranscriptAutoScroll: () => ({ref: {current: null}, onScroll: vi.fn(), edgeMask: ""}),
}))

import {type ConversationRole, ConversationRoleContext} from "@/features/chat/conversationRole"
import {LiveConversation} from "@/features/chat/LiveConversation"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
const store = createStore()

beforeEach(() => {
    calls.approve.mockReset()
    calls.stop.mockReset()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const Conversation = ({sessionId, role}: {sessionId: string; role: ConversationRole}) => (
    // The container gives the role; no key names it.
    <ConversationRoleContext.Provider value={role}>
        <LiveConversation
            key={sessionId}
            embedded
            entityId="rev-1"
            sessionId={sessionId}
            projectId="proj-1"
            workspaceId="ws-1"
            running
            stopStateLoading={false}
            sharedReader={false}
            agentId="agent-1"
        />
    </ConversationRoleContext.Provider>
)

const renderBoth = () =>
    act(async () =>
        root.render(
            <Provider store={store}>
                <Conversation sessionId="page-session" role="page" />
                <Conversation sessionId="builder-chat" role="embedded" />
            </Provider>,
        ),
    )

const byId = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const focusIn = (id: string | null) =>
    act(async () => {
        if (id) byId(id)?.focus()
        else (document.activeElement as HTMLElement | null)?.blur()
    })
const press = (init: KeyboardEventInit) =>
    act(async () => {
        ;(document.activeElement ?? document).dispatchEvent(
            new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init}),
        )
    })
const escape = () => press({key: "Escape"})
const altG = () => press({key: "©", code: "KeyG", altKey: true})

describe("run and approval shortcuts with two conversations on screen", () => {
    it("Escape stops only the builder run while the focus is in the builder composer", async () => {
        await renderBoth()
        await focusIn("composer-builder-chat")
        await escape()
        expect(calls.stop.mock.calls).toEqual([["builder-chat"]])
    })

    it("Escape stops only the page run while the focus is in the page conversation", async () => {
        await renderBoth()
        await focusIn("composer-page-session")
        await escape()
        expect(calls.stop.mock.calls).toEqual([["page-session"]])
    })

    it("with the focus in neither conversation, the page conversation owns the keys", async () => {
        await renderBoth()
        await focusIn(null)
        await escape()
        await altG()
        expect(calls.stop.mock.calls).toEqual([["page-session"]])
        expect(calls.approve.mock.calls).toEqual([["page-session"]])
    })

    it("Alt+G approves a gate of the focused conversation only", async () => {
        await renderBoth()
        await focusIn("composer-page-session")
        await altG()
        expect(calls.approve.mock.calls).toEqual([["page-session"]])

        await focusIn("composer-builder-chat")
        await altG()
        expect(calls.approve.mock.calls).toEqual([["page-session"], ["builder-chat"]])
    })
})

describe("a role change", () => {
    const renderOne = (role: ConversationRole) =>
        act(async () =>
            root.render(
                <Provider store={store}>
                    <Conversation sessionId="builder-chat" role={role} />
                </Provider>,
            ),
        )

    it("keeps the mount: the composer text and the scroll position stay", async () => {
        await renderOne("embedded")
        const composer = byId("composer-builder-chat") as HTMLTextAreaElement
        const scroller = byId("scroller") as HTMLDivElement
        composer.value = "make the greeting shorter"
        scroller.scrollTop = 240

        await renderOne("page")

        expect(byId("composer-builder-chat")).toBe(composer)
        expect(composer.value).toBe("make the greeting shorter")
        expect(byId("scroller")).toBe(scroller)
        expect(scroller.scrollTop).toBe(240)
        expect(
            host.querySelector("[data-conversation-role]")?.getAttribute("data-conversation-role"),
        ).toBe("page")
    })

    it("moves the shortcuts with the role", async () => {
        await renderOne("embedded")
        // Focus in neither: an embedded conversation does not take the key.
        await focusIn(null)
        await escape()
        expect(calls.stop).not.toHaveBeenCalled()

        await renderOne("page")
        await escape()
        expect(calls.stop.mock.calls).toEqual([["builder-chat"]])
    })
})
