import {useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject} from "react"

import {
    describeAccepted,
    filesToParts,
    jumpGateOpen,
    messageText,
    sideEffectingToolsInRange,
} from "@agenta/chat/assets"
import {getMessageTraceId} from "@agenta/chat/assets"
import {AttachmentDropOverlay, ConnectionFocusProvider} from "@agenta/chat/components"
import {
    stagedFilesToParts,
    useComposerAttachments,
    useAgentChatQueue,
    useSessionLivePreview,
    type QueuedMessage,
} from "@agenta/chat/hooks"
import {
    useAgentModelKeyStatus,
    useConnectionDock,
    useElicitationDock,
    useVoiceComposer,
} from "@agenta/chat/hooks"
import {type SessionRunStatus} from "@agenta/chat/model"
import {
    ignoreStreamRejection,
    isEmptyAssistantTurn,
    isSessionBusyRefusal,
    isVisiblePart,
} from "@agenta/chat/model"
import {getInteractionAvailability, getLivePendingApprovals} from "@agenta/chat/model"
import {withoutSharedSenderAcceptanceMessages} from "@agenta/chat/model"
import {hasSessionChat, sessionMessagesAtom, setSessionStatusAtom} from "@agenta/chat/state"
import {clearSessionFresh} from "@agenta/chat/state"
import {
    contextWindowForModel,
    harnessCapabilitiesAtomFamily,
    modalitiesForModel,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {ContextRail} from "@agenta/entity-ui/drive"
import {DriveSessionProvider} from "@agenta/entity-ui/drive"
import {filesDrawerStagedAtomFamily} from "@agenta/entity-ui/drive"
import {buildRenderMap, isPendingClientToolInteraction} from "@agenta/playground"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {isOverlayOpen} from "@agenta/shared/utils"
import {modal} from "@agenta/ui/app-message"
import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {isAltChord} from "@agenta/ui/shortcuts"
import {type FileUIPart, type UIMessage} from "ai"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {DriveFileLinkProvider} from "@/oss/components/Drives/DriveFileLinkProvider"
import {useSessionFilesPane} from "@/oss/components/Drives/SessionFilesPane"
import {TEMPLATE_STRIP_MODE} from "@/oss/components/pages/agent-home/assets/constants"

import {isAgentFileUploadsEnabled} from "./assets/constants"
import {CONTENT_VISIBILITY_ENABLED} from "./assets/conversationLayout"
import {runWithInFlightSubmit} from "./assets/inFlightSubmit"
import {restoreHeldRefusedSend} from "./assets/refusedMessageRecovery"
import AgentComposerDock from "./components/AgentComposerDock"
import AgentTranscript from "./components/AgentTranscript"
import AgentTurn from "./components/AgentTurn"
import AttachmentViewerDrawer from "./components/AttachmentViewerDrawer"
import {Inspector} from "./components/Inspector/Inspector"
import MessageAttachmentViewer from "./components/MessageAttachmentViewer"
import RightPanelSplit from "./components/RightPanel/RightPanelSplit"
import TranscriptPlaceholder from "./components/TranscriptPlaceholder"
import {useAgentChatSession} from "./hooks/useAgentChatSession"
import {useComposerDraft} from "./hooks/useComposerDraft"
import {useFirstRunSeed} from "./hooks/useFirstRunSeed"
import {useOnboardingChat} from "./hooks/useOnboardingChat"
import {useScrollIntent} from "./hooks/useScrollIntent"
import {useTranscriptScroll} from "./hooks/useTranscriptScroll"
import {useTurnInspector} from "./hooks/useTurnInspector"
import {useVirtuosoTranscript} from "./hooks/useVirtuosoTranscript"
import {deriveSessionRemoteTurnPresentation} from "./state/liveness"
import {useChatScopeKey} from "./state/scope"
import {
    activeSessionIdAtomFamily,
    autoTitleSessionAtomFamily,
    bumpSessionActivityAtomFamily,
    firstUserText,
} from "./state/sessions"
import {focusComposerRequestAtom, matchesSessionRequest} from "./state/uiRequests"

/**
 * One agent conversation for a single session tab. A `useChat` whose transport is fed by the
 * PLAYGROUND request builder (`buildAgentRequest`) — the entity supplies the config/auth/
 * references, the session id is the tab's id and travels to the backend as `session_id`.
 * Messages persist to localStorage (seeded on mount, written when the stream settles) so the
 * tab survives a reload / revision swap.
 *
 * Design decisions baked in (docs/design/agent-workflows/projects/session-chat-registry/decisions.md):
 *  - D9  teardown: release the chat on unmount; it is preserved while its session tab is open.
 *  - DT3 cancelled state: a stopped stream tags its partial bubble "Stopped" + offers Resend.
 *  - DT4 autoscroll: stick to bottom while streaming; pause when scrolled up; "jump to latest".
 *  - DT5 a11y: the message log is an aria-live region; controls are keyboard-operable.
 */

const AgentConversation = ({
    entityId,
    sessionId,
    revealPlayedRef,
}: {
    entityId: string
    sessionId: string
    /** Shared across the panel's session panes: the composer entrance plays only once. */
    revealPlayedRef: MutableRefObject<boolean>
}) => {
    const store = useStore()
    // Workflow artifact id for this conversation — the key for the agent's durable `agent-files`
    // mount, folded into the session drive by the Drive surfaces below (via the drive context).
    const artifactId = useAtomValue(workflowMolecule.selectors.workflowId(entityId))
    const setSessionStatus = useSetAtom(setSessionStatusAtom)
    // Seed once from the persisted store (read imperatively so our own writes don't feed back).
    const [initialMessages] = useState(() =>
        withoutSharedSenderAcceptanceMessages(store.get(sessionMessagesAtom)[sessionId] ?? []),
    )
    const richInputRef = useRef<RichChatInputHandle>(null)

    const composer = useComposerDraft({sessionId, richInputRef, revealPlayedRef})

    // What the transcript should do next (follow / arm a pin / show the pill), shared by the
    // producers below (send, queue release, history adoption) and whichever scroll engine is
    // active. Declared here so every producer can state intent without touching the DOM.
    const scrollIntent = useScrollIntent({initialArmed: initialMessages.length > 0})
    const {showJump} = scrollIntent

    // The chat stream for this tab: transport, useChat, history hydration, persistence,
    // self-commit pickup, stop/kill and teardown.
    const {
        messages,
        status,
        busy,
        error,
        connectionWarning,
        acceptedRunPending,
        turnDeliverySource,
        settleSharedTurn,
        sendMessage,
        regenerate,
        setMessages,
        messagesRef,
        busyRef,
        isHydrating,
        hydratedEmpty,
        stopped,
        stopping,
        setStopped,
        handleStop,
        handleClientToolOutput,
        markLiveGate,
        answerApproval,
        answerApprovals,
        resumeOrphaned,
        isSeen,
        runningElsewhere: livenessRunningElsewhere,
        sharedReaderAdvertised,
        refreshFromRecords,
        setSharedSenderReady,
    } = useAgentChatSession({entityId, sessionId, initialMessages, intent: scrollIntent})
    const {
        messages: previewMessages,
        runningFromSnapshot,
        readerReady,
    } = useSessionLivePreview({
        sessionId,
        sharedReaderAdvertised,
        runningElsewhere: livenessRunningElsewhere,
        sender: true,
        onReadyChange: setSharedSenderReady,
        onExecutionSettled: settleSharedTurn,
        onDisconnect: refreshFromRecords,
    })
    const remoteTurn = deriveSessionRemoteTurnPresentation({
        livenessRunning: livenessRunningElsewhere,
        snapshotRunning: runningFromSnapshot || acceptedRunPending,
        sharedReaderAdvertised,
        readerReady,
        ownedContinuation: acceptedRunPending,
    })
    const transcriptMessages = useMemo(() => {
        const durableMessages = withoutSharedSenderAcceptanceMessages(messages)
        if (turnDeliverySource === "legacy" || previewMessages.length === 0) return durableMessages
        return [...durableMessages, ...previewMessages]
    }, [messages, previewMessages, turnDeliverySource])
    const transcriptBusy =
        busy ||
        remoteTurn.showActivity ||
        (turnDeliverySource !== "legacy" && previewMessages.length > 0)

    // Turn Inspector: open state, the focused turn, and the assistant → turn-number mapping.
    const {
        buildMode,
        inspectorEnabled,
        inspectorOpen,
        inspectedTurn,
        openInspectorTurn,
        turnNumbers,
    } = useTurnInspector({sessionId, messages})

    // Quick Look + Files openers: cards/tiles/rail request via atoms; these resolve against
    // THIS conversation's drive: the link provider makes filename mentions clickable, and the
    // docked Files pane (hosted a level up in AgentChatPanel, beside the whole chat column)
    // shows the grid and the single-file preview — every opener (cards, links, rail, the
    // session bar "«") lands there.
    const quickLookHost = <DriveFileLinkProvider sessionId={sessionId} artifactId={artifactId} />
    const {openPane: openFilesPane} = useSessionFilesPane(sessionId)
    const setFilesStaged = useSetAtom(filesDrawerStagedAtomFamily(sessionId))

    // ── "Run in playground" seam (producer: a trigger drawer's Run-in-playground) ──
    // A trigger fires server-side and never reaches the playground; this lets a user
    // channel a trigger's resolved inputs into the active session. Only the ACTIVE
    // session's conversation consumes the pending run (antd Tabs can keep inactive
    // panes mounted), sends it as a user turn, and clears it. A monotonic nonce lets
    // the same inputs run again; a ref guards double-firing. The consuming effect lives
    // below `useAgentChatQueue` so the run goes through the same `submit` path as a manual
    // send — respecting a pending HITL approval and any queued messages instead of jumping
    // ahead with a raw `sendMessage`.
    const scopeKey = useChatScopeKey()
    const activeSessionId = useAtomValue(activeSessionIdAtomFamily(scopeKey))
    const pendingRun = useAtomValue(simulatedAgentRunAtomFamily(entityId))
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(entityId))

    // Auto-name the session from its first user message so the durable list is labeled everywhere
    // (cross-tab / cross-device) before it's opened. The atom no-ops once the session has a title,
    // so this fires at most once and never overwrites an explicit rename.
    const autoTitleSession = useSetAtom(autoTitleSessionAtomFamily(scopeKey))
    const firstUserMessage = useMemo(() => firstUserText(messages), [messages])
    useEffect(() => {
        if (firstUserMessage) autoTitleSession({id: sessionId, text: firstUserMessage})
    }, [firstUserMessage, sessionId, autoTitleSession])

    // Stamp last-message time when a live turn finishes streaming (issue #5553: order history by
    // last message). Gated on the streaming→settled transition so hydration/restore — which sets
    // messages while `status` stays "ready" — never back-dates an old session to "now".
    const bumpSessionActivity = useSetAtom(bumpSessionActivityAtomFamily(scopeKey))
    const prevStatusRef = useRef(status)
    useEffect(() => {
        if (prevStatusRef.current === "streaming" && status !== "streaming") {
            bumpSessionActivity(sessionId)
        }
        prevStatusRef.current = status
    }, [status, sessionId, bumpSessionActivity])

    // Model connection: is the project vault empty (no key of any kind), the agent not self-managed,
    // and the user never set up a key before? Drives the connect-a-model banner AND disables the
    // composer until connected — see `gateActive` on `useAgentModelKeyStatus` for the full chain.
    const modelKey = useAgentModelKeyStatus(entityId)
    const modelBlocked = modelKey.gateActive

    // Context-window denominator for the token-budget indicator: the SDK model catalog's own
    // `context_window`, delivered on the (global) harness-capabilities document — never hardcoded.
    const harnessCapabilities = useAtomValue(harnessCapabilitiesAtomFamily(""))
    const contextMaxTokens = useMemo(
        () => contextWindowForModel(harnessCapabilities, modelKey.harness, modelKey.model),
        [harnessCapabilities, modelKey.harness, modelKey.model],
    )
    // Feature flag: the context-budget meter is hidden from the composer for now. The
    // component and its logic stay wired up; flip this to `true` to bring the UI back.
    const showContextBudget = false

    const modelModalities = useMemo(
        () => modalitiesForModel(harnessCapabilities, modelKey.harness, modelKey.model),
        [harnessCapabilities, modelKey.harness, modelKey.model],
    )
    // Voice defaults follow the model's audio modality; unknown stays workspace-only, matching
    // the runner's rule.
    const audioPerceivable = Boolean(modelModalities?.includes("audio"))

    // Pending attachments for this session + the whole-panel drop target.
    const attachments = useComposerAttachments({
        sessionId,
        uploadsEnabled: isAgentFileUploadsEnabled(),
    })
    const {
        uploadsEnabled,
        files,
        viewingUid,
        setViewingUid,
        limits,
        atMax,
        attachmentsSettled,
        isDragging,
        addFiles,
        restoreAttachments,
    } = attachments

    // Playground-native onboarding: the hero, Create-agent / Continue-in-IDE, the template strip
    // and the optimistic first turn. Every value is inert outside the onboarding playground.
    const onboardingChat = useOnboardingChat({
        entityId,
        richInputRef,
        messages,
        setMessages,
        setStopped,
        intent: scrollIntent,
    })
    const {onboardingActive, ideHandoffActive} = onboardingChat

    // The composer's voice surface. A finished take either becomes the message outright (empty
    // composer) or joins the tray — `handleSubmit` / `addFiles` are declared around it, so both
    // are reached through the callbacks rather than by ordering the hooks around them.
    const voice = useVoiceComposer({
        richInputRef,
        stagedCount: files.length,
        onAttach: (file) => addFiles([file]),
        onSendVoiceMessage: (file) => handleSubmit("", [file]),
    })
    const {voiceRecorder} = voice

    // While a take is in flight the composer is covered by the recording bar, and a drop landing
    // now could take the last tray slot — which would reject (and destroy) the recording on
    // attach. Guarded at the entry points, not in `addFiles`, because the recorder's own
    // completion goes straight there and must always get through.
    /**
     * Attachments are refused while a take is in flight (the composer is covered, and a late drop
     * could steal the tray slot the recording needs) and while the composer itself is disabled —
     * accepting files into an input you cannot send from is a dead end.
     */
    const composerDisabled = onboardingActive ? ideHandoffActive : modelBlocked
    const attachmentsBlocked = () => !uploadsEnabled || voiceRecorder.active || composerDisabled
    const dropTarget = attachments.bindDropTarget(attachmentsBlocked)

    // First-run seed + its overlay-gated auto-start. `handleSubmit` is declared below, so the
    // seed fires through a ref.
    const handleSubmitRef = useRef<(text: string) => void | Promise<void>>(() => {})
    const {firstRunPrompt} = useFirstRunSeed({
        entityId,
        scopeKey,
        sessionId,
        activeSessionId,
        messagesCount: messages.length,
        modelBlocked,
        handleSubmitRef,
        // Files picked on Home / the overview, where there was no session to upload against.
        onSeedFiles: attachments.addFiles,
    })
    // Agent empty-chat template strip (S6). Computed ONCE here and handed to both surfaces that
    // depend on it — the composer dock renders it, the empty state drops its starter pills for it —
    // so a session that does NOT get the strip (an existing agent's revision, or one still loading)
    // still gets the pills instead of a dead empty state.
    const showTemplateStrip =
        TEMPLATE_STRIP_MODE &&
        !onboardingActive &&
        buildMode &&
        onboardingChat.isFreshAgentRevision &&
        messages.length === 0 &&
        !firstRunPrompt &&
        !onboardingChat.pendingFirstTurn

    const consumedRunNonceRef = useRef<number | null>(null)

    // Send one released queued message. Stable (only depends on `sendMessage`) so the queue's
    // release effect doesn't churn on every token.
    const sendQueued = useCallback(
        (item: QueuedMessage) => {
            scrollIntent.follow()
            // A real send means this session has run — drop the never-run marker so a later
            // cache-cleared reopen hydrates from the server.
            clearSessionFresh(sessionId)
            // Any actual send supersedes a prior user-stop, so clear the marker here (covers the
            // queue-release path; the manual path also clears it in handleSubmit) — otherwise the
            // "Stopped" tag would smear onto the freshly-sent turn.
            setStopped(false)
            sendMessage(
                item.fileParts && item.fileParts.length
                    ? item.text
                        ? {text: item.text, files: item.fileParts}
                        : {files: item.fileParts}
                    : {text: item.text},
            ).catch(ignoreStreamRejection)
        },
        [sendMessage, sessionId],
    )

    // Queue messages typed while a turn is streaming or paused on a HITL approval; released
    // one-by-one once the turn truly settles (never mid-approval). A user stop is the exception —
    // it voids the pending gate, so `stopped` lets a fresh send go immediately (not queue). An
    // orphaned restored resume shape (reload mid-approval-resume) voids it the same way.
    const {
        queued,
        submit,
        removeQueued,
        hitlPending,
        editingId,
        beginEdit,
        cancelEdit,
        commitEdit,
        takeLastSent,
    } = useAgentChatQueue({
        status,
        messages,
        acceptedRunPending,
        stopped,
        resumeOrphaned,
        sendQueued,
        sessionId,
    })

    // Approval responses flow through here (not bare `addToolApprovalResponse`) so a decision made
    // in THIS mount marks the resume as live — a restored approval-requested tail the user answers
    // after a reload genuinely auto-resumes, so the queue's pre-resume hold must apply to it.
    const handleApprovalResponse = useCallback(
        (args: {id: string; approved: boolean; message?: string}) => {
            markLiveGate({kind: "approval", id: args.id})
            // `answerApproval` owns the whole ordered click: the row first, then the part flip that
            // lets the SDK resume. Never flip here — an early flip lets the resume's stale sweep
            // cancel the row being answered.
            // Steer: a denial that carries a redirect answers the gate AND sends the instruction as a
            // follow-up turn. It must be its OWN turn, not bundled into the deny-resume: resuming a
            // parked gate calls `respondPermission(reject)`, which makes the harness CONTINUE the
            // original prompt (run-turn.ts) — so a note fused into that resume gets subordinated to
            // the original intent and ignored. As a separate turn it reliably drives the redirect.
            // (The model still reasons about the bare denial first — the "flail" — because the
            // harness owns the reject continuation and exposes no reject-with-feedback seam; killing
            // that flail needs an upstream ACP change, not an FE one.)
            const steer = args.message?.trim()
            return answerApproval(args.id, args.approved).then(() => {
                // After the answer for the same reason the flip is: a steer starts its own turn.
                if (!args.approved && steer) submit({text: steer})
            })
        },
        [answerApproval, markLiveGate, submit],
    )

    const handleApprovalResponses = useCallback(
        (ids: string[], approved: boolean) => {
            markLiveGate({kind: "approval", id: ids[0]})
            return answerApprovals(ids, approved)
        },
        [answerApprovals, markLiveGate],
    )

    const interactionAvailability = getInteractionAvailability({stopped, stopping, streaming: busy})
    const pendingApprovals = useMemo(
        () => getLivePendingApprovals(messages, {stopped: !interactionAvailability.approvals}),
        [messages, interactionAvailability.approvals],
    )
    // Parked connect interactions on the paused turn → the connect dock owns their actions (the
    // inline rows are passive markers). Gated off while busy (`input-streaming` isn't parked yet)
    // and after a user stop (the run is dead, nothing to settle — matches the queue's stop void).
    // Parked question forms → the docked card owns their actions (the inline rows are markers).
    // Same gate as the connect dock: the stream genuinely ends when an interaction parks, so `busy`
    // is already false by the time the dock should open.
    const elicits = useElicitationDock({
        messages,
        enabled: interactionAvailability.parkedDocks,
        approvalsPending: pendingApprovals.length > 0,
        onOutput: handleClientToolOutput,
    })
    const connects = useConnectionDock({
        messages,
        enabled: interactionAvailability.parkedDocks,
        approvalsPending: pendingApprovals.length > 0,
        elicitationPending: elicits.open,
    })
    // A docked gate holds the jump pill back: same bottom corner, and a paused run has nothing
    // arriving below to jump to.
    const gateOpen = jumpGateOpen({
        approvals: pendingApprovals.length,
        elicitationOpen: false,
        connectionOpen: connects.open,
    })
    // Publish this session's run state (single source of truth: drives the tab bar's status dot
    // AND the Session inspector's live-watcher signal, which derives "streaming" from `running`).
    // Precedence error > awaiting approval > running > idle.
    // `hitlPending` reads only the LAST assistant message, so the moment a new turn starts
    // streaming (or hydration reshapes the transcript) a still-pending interaction in an
    // EARLIER message stops counting — status collapses to idle, the settle stamp lands, and
    // the running-elsewhere strip flickers in the very tab that owns the parked widget
    // (Mahmoud's session e627d80a). Scan the whole transcript: any pending interaction this
    // tab renders means this tab owns the run.
    const anyPendingInteraction = useMemo(
        () =>
            messages.some((message) => {
                if (message.role !== "assistant") return false
                const parts = message.parts ?? []
                const renderMap = buildRenderMap(parts)
                return parts.some((part) => isPendingClientToolInteraction(part, renderMap))
            }),
        [messages],
    )
    const refusedSendRef = useRef<QueuedMessage | undefined>(undefined)
    const restoreRefusedSend = useCallback(
        () => restoreHeldRefusedSend(refusedSendRef, richInputRef.current, restoreAttachments),
        [restoreAttachments],
    )
    // Restore a refused send after the editor's synchronous submit clear.
    useEffect(() => {
        if (!error || !isSessionBusyRefusal(error)) return
        if (!refusedSendRef.current) refusedSendRef.current = takeLastSent()
        requestAnimationFrame(() => {
            restoreRefusedSend()
        })
    }, [error, restoreRefusedSend, takeLastSent])

    const handleComposerChange = useCallback(
        (text: string) => {
            composer.handleComposerChange(text)
            if (!text.trim()) restoreRefusedSend()
        },
        [composer.handleComposerChange, restoreRefusedSend],
    )

    useEffect(() => {
        const status: SessionRunStatus = error
            ? "error"
            : hitlPending || anyPendingInteraction
              ? "awaiting"
              : busy
                ? "running"
                : "idle"
        setSessionStatus({id: sessionId, status})
    }, [error, hitlPending, anyPendingInteraction, busy, sessionId, setSessionStatus])
    // On unmount, retire the dot ONLY if the run went with us. A chat preserved past this mount
    // (route change with the tab still open) is still this browser's run to report, so it keeps its
    // status until it settles — `useAgentChatSession`'s `onFinish` retires it then. The session hook
    // releases the chat in an earlier cleanup, so the registry is already authoritative here.
    useEffect(
        () => () => {
            if (!hasSessionChat(sessionId)) setSessionStatus({id: sessionId, status: "idle"})
        },
        [sessionId, setSessionStatus],
    )

    // Consume a pending "Run in playground" request (declared above) via the queue's `submit`,
    // so it interleaves with HITL approval / queued messages exactly like a manual send.
    useEffect(() => {
        if (!pendingRun || activeSessionId !== sessionId) return
        // A new-session run is handled at the panel level first (it creates + activates a fresh
        // session and clears the flag); this per-session consumer ignores it until then.
        if (pendingRun.newSession) return
        if (consumedRunNonceRef.current === pendingRun.nonce) return
        consumedRunNonceRef.current = pendingRun.nonce
        scrollIntent.follow()
        submit({text: pendingRun.text})
        setPendingRun(null)
    }, [pendingRun, activeSessionId, sessionId, submit, setPendingRun])

    // Run-level shortcuts. They live here, not in the panel's session hook, because only this
    // conversation knows whether a run is in flight and what it is waiting on. Bubble phase, so an
    // open picker or dialog that stops propagation still gets Escape first.
    useEffect(() => {
        if (activeSessionId !== sessionId) return
        const onKey = (e: KeyboardEvent) => {
            // Radix cancels Escape for a layer but still lets it reach us, and it never touches
            // Alt+G, which only the overlay check catches.
            if (e.defaultPrevented || isOverlayOpen()) return
            // An IME user presses Escape to cancel composition, not to stop the run.
            if (e.key === "Escape" && !e.isComposing && busyRef.current) {
                e.preventDefault()
                handleStop()
                return
            }
            // Approve answers ONE gate, never the dock's "Approve all": a mis-press should not
            // grant a tool the user never read.
            if (isAltChord(e) && e.code === "KeyG" && pendingApprovals.length > 0) {
                e.preventDefault()
                handleApprovalResponse({id: pendingApprovals[0].approvalId, approved: true})
            }
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [activeSessionId, sessionId, busyRef, handleStop, pendingApprovals, handleApprovalResponse])

    // A keyboard switch (Alt+1…9 / Alt+Z / Alt+X) lands the caret here. antd mounts a never-visited
    // pane only on activation, so this effect runs on that mount and a first-visit switch focuses
    // too. The frame claims the nonce, not the effect body: StrictMode replays the mount, and
    // claiming it up front would leave the replay with nothing to do.
    const focusRequest = useAtomValue(focusComposerRequestAtom)
    const consumedFocusNonceRef = useRef<number | null>(null)
    useEffect(() => {
        if (!matchesSessionRequest(focusRequest, scopeKey, sessionId)) return
        const {nonce} = focusRequest
        if (consumedFocusNonceRef.current === nonce) return
        requestAnimationFrame(() => {
            if (consumedFocusNonceRef.current === nonce) return
            consumedFocusNonceRef.current = nonce
            richInputRef.current?.focus()
        })
    }, [focusRequest, scopeKey, sessionId])

    // Exactly one scroll engine owns the transcript: Virtuoso when it's enabled in the playground
    // settings, the SC-1..4 DOM engine otherwise (each bails on the other's flag). Both act on the
    // shared `scrollIntent`, so producers never care which is live.
    const virt = useVirtuosoTranscript({
        intent: scrollIntent,
        sessionId,
        messages: transcriptMessages,
        status,
    })
    const useVirtuoso = virt.enabled
    const scroll = useTranscriptScroll({
        intent: scrollIntent,
        messages: transcriptMessages,
        status,
        useVirtuoso,
    })

    const finishSubmit = (
        trimmed: string,
        fileParts: FileUIPart[] | undefined,
        consumedUids: string[],
        stagedFiles: typeof files,
    ) => {
        if (editingId) {
            // A rewrite of a held message: nothing is sent, so the transcript must not move.
            // The input clears itself on submit, so the displaced draft goes back after that.
            const draft = commitEdit({text: trimmed, fileParts, stagedFiles})
            if (draft) requestAnimationFrame(() => richInputRef.current?.setMarkdown(draft))
        } else {
            // Glide to the bottom; the min-h-full active turn makes that show the new question at the
            // top with the answer streaming below. Park during the glide, follow again on settle.
            // Clear any prior "stopped" marker — it's resolved by asking again.
            scrollIntent.armGlide()
            setStopped(false)
            // One path: `submit` sends now or queues behind held messages via the shared release gate.
            submit({text: trimmed, fileParts, stagedFiles})
        }
        // The message left the composer — drop its persisted draft (and any pending capture).
        composer.clearDraft()
        onboardingChat.consumeTemplateProvenance()
        attachments.clearAttachments(consumedUids)
    }

    // A voice take awaits its upload, so the guard keeps a second send from starting meanwhile.
    const inFlightSubmitRef = useRef(false)
    const handleSubmit = (text: string, extraFiles: File[] = []) =>
        runWithInFlightSubmit(inFlightSubmitRef, async () => {
            const trimmed = text.trim()
            if (!trimmed && files.length === 0 && extraFiles.length === 0) return
            if (!attachmentsSettled) return
            const stagedUids = files.map((file) => file.uid)

            if (!uploadsEnabled) {
                // Voice and upload flags are independent; this seam preserves the inline recorder path.
                const inlineFiles = [
                    ...files
                        .map((file) => file.originFileObj as File | undefined)
                        .filter((file): file is File => Boolean(file)),
                    ...extraFiles,
                ]
                let fileParts: FileUIPart[] | undefined
                if (inlineFiles.length) {
                    const {parts, rejections: unreadable} = await filesToParts(inlineFiles)
                    // Hold the send rather than quietly dropping bytes the user staged, and say which
                    // file failed through the same inline channel the other attachment refusals use.
                    if (unreadable.length) {
                        attachments.setRejections(
                            unreadable.map(({name}) => ({
                                name,
                                reason: "couldn't be read — remove it and attach it again",
                            })),
                        )
                        return
                    }
                    fileParts = parts
                }
                finishSubmit(trimmed, fileParts, stagedUids, files)
                return
            }

            // A take sent outright never entered the tray, so it uploads here before the send.
            const uploadedExtras = extraFiles.length
                ? await attachments.uploadExtraFiles(extraFiles)
                : []
            if (!uploadedExtras) return
            const outboundFiles = [...files, ...uploadedExtras]
            const fileParts = outboundFiles.length
                ? stagedFilesToParts(outboundFiles, sessionId)
                : undefined
            finishSubmit(trimmed, fileParts, stagedUids, outboundFiles)
        })

    handleSubmitRef.current = handleSubmit

    const handleRewind = useCallback(
        (message: UIMessage) => {
            const msgs = messagesRef.current
            if (busyRef.current) return
            const idx = msgs.findIndex((m) => m.id === message.id)
            if (idx < 0) return
            const isUser = message.role === "user"
            const sideEffects = sideEffectingToolsInRange(msgs.slice(idx))

            const run = () => {
                if (isUser) {
                    setMessages(msgs.slice(0, idx))
                    richInputRef.current?.setMarkdown(messageText(message))
                    requestAnimationFrame(() => richInputRef.current?.focus())
                } else {
                    regenerate({messageId: message.id}).catch(ignoreStreamRejection)
                }
            }

            if (sideEffects.length > 0) {
                modal.confirm({
                    title: "Rewind past a tool that already ran?",
                    content: `${sideEffects.join(", ")} already executed. Rewinding re-runs the conversation from here but will NOT undo it.`,
                    okText: "Rewind anyway",
                    okButtonProps: {danger: true},
                    cancelText: "Cancel",
                    centered: true,
                    onOk: run,
                })
            } else {
                run()
            }
        },
        [regenerate, setMessages],
    )

    // Group the ACTIVE turn (the last user message + its response) into one wrapper that carries the
    // fill. Keeping the fill on a STABLE element — not hopping it from the user bubble to the assistant
    // bubble when the answer arrives — avoids the mid-stream layout jump.
    const lastUserIndex = (() => {
        for (let i = transcriptMessages.length - 1; i >= 0; i--)
            if (transcriptMessages[i].role === "user") return i
        return -1
    })()
    const activeStart = lastUserIndex >= 0 ? lastUserIndex : transcriptMessages.length
    // The fill = min-h-full on the active turn whenever there's PRIOR conversation above it (so the
    // question can sit at the top). Derived from layout, NOT from `busy` — so it persists when the turn
    // settles instead of being yanked away (which clamped the scroll and jumped the view).
    const reserveActive = activeStart > 0

    // Stable per-session callbacks so <AgentTurn>'s memo holds across streamed commits.
    const handleInspectTurn = useCallback(
        (turn: number) => openInspectorTurn({sessionId, turn}),
        [openInspectorTurn, sessionId],
    )
    const handleResend = useCallback(
        (messageId: string) => {
            if (busyRef.current) return
            const msgs = messagesRef.current
            const idx = msgs.findIndex((m) => m.id === messageId)
            // Same hazard as rewind (#6362 review): regenerating drops the failed assistant
            // turn, including any tool that already ran — a retryable model error can land
            // AFTER a completed write, and the retry would run the write again.
            const sideEffects = idx >= 0 ? sideEffectingToolsInRange(msgs.slice(idx)) : []
            const run = () => {
                setStopped(false)
                regenerate({messageId}).catch(ignoreStreamRejection)
            }
            if (sideEffects.length > 0) {
                modal.confirm({
                    title: "Retry past a tool that already ran?",
                    content: `${sideEffects.join(", ")} already executed. Retrying re-runs this turn but will NOT undo it.`,
                    okText: "Retry anyway",
                    okButtonProps: {danger: true},
                    cancelText: "Cancel",
                    centered: true,
                    onOk: run,
                })
            } else {
                run()
            }
        },
        [regenerate, setStopped],
    )

    const renderMessage = (message: UIMessage, index: number) => {
        const isLast = index === transcriptMessages.length - 1
        const isAssistantTurn = message.role === "assistant"
        const turn = turnNumbers.get(message.id)
        const isInspected = isAssistantTurn && inspectedTurn != null && turn === inspectedTurn
        return (
            <AgentTurn
                key={message.id}
                message={message}
                sessionId={sessionId}
                // New since mount → fade in once. seenIdsRef is marked in an effect after commit,
                // never during render (unsafe under StrictMode's double invoke).
                enter={!isSeen(message.id)}
                isLast={isLast}
                isStreaming={transcriptBusy && isLast}
                precededByEmptyAssistant={
                    index > 0 && isEmptyAssistantTurn(transcriptMessages[index - 1])
                }
                // A user turn borrows its paired assistant trace so the timestamp reflects the run.
                turnTraceId={
                    message.role === "user" && transcriptMessages[index + 1]
                        ? getMessageTraceId(transcriptMessages[index + 1])
                        : undefined
                }
                inspected={isInspected}
                // Whenever the inspector PANEL is open, every assistant turn is click-to-focus —
                // gated on the panel being open, not on a turn already being focused.
                rowInspectable={inspectorOpen && isAssistantTurn}
                showInspect={inspectorEnabled && buildMode && isAssistantTurn}
                turn={turn}
                onInspectTurn={handleInspectTurn}
                showWorking={
                    isLast &&
                    transcriptBusy &&
                    (!isAssistantTurn || message.parts.some(isVisiblePart))
                }
                // Paused on the user (never concurrently with showWorking — hitlPending implies not
                // busy): keeps the turn from reading as finished while the queue holds sends.
                showWaiting={isLast && isAssistantTurn && !busy && hitlPending}
                showStopped={stopped && isLast && isAssistantTurn}
                resendDisabled={busy || acceptedRunPending}
                onResend={handleResend}
                onRewind={handleRewind}
                onClientToolOutput={handleClientToolOutput}
                // Content-visibility on settled rows — gated by CONTENT_VISIBILITY_ENABLED
                // (currently off) and never under Virtuoso (it windows + corrupts measurement).
                offscreenSkip={CONTENT_VISIBILITY_ENABLED && !useVirtuoso && index < activeStart}
            />
        )
    }

    return (
        // Ambient drive session: in-thread file cards + rail resolve files against THIS
        // conversation without prop-threading through the message tree.
        <DriveSessionProvider sessionId={sessionId} artifactId={artifactId}>
            {/* Wraps transcript AND dock: a parked "Connect to X below" row links to X's card. */}
            <ConnectionFocusProvider connects={connects}>
                {/* The whole conversation ACCEPTS a drop; only the composer shows it (below).
                Aiming at a 100px dock to attach a file is a needless demand. */}
                <div
                    className="ag-canvas relative flex h-full min-h-0 w-full flex-row"
                    {...dropTarget}
                >
                    {/* Themed confirm dialogs (rewind-past-a-tool) mount through this holder. */}
                    {quickLookHost}
                    {/* Previews a SENT attachment; the tray's own drawer is below. */}
                    <MessageAttachmentViewer />
                    {uploadsEnabled ? (
                        <AttachmentViewerDrawer
                            uploads={files}
                            openUid={viewingUid}
                            onClose={() => setViewingUid(null)}
                        />
                    ) : null}
                    {/* Resizable [chat | right panel] split. The panel (turn inspector OR session content)
                pushes the chat aside rather than overlaying it, and collapses to 0 when closed. */}
                    <RightPanelSplit
                        open={inspectorOpen}
                        // Same bar inset as the transcript column: the Inspector is a separate split pane,
                        // so it needs its own top padding to clear the absolute session bar in build mode
                        // (the context rail deliberately does NOT get it, so it never rides the transition).
                        panel={
                            <div className="box-border h-full pt-[var(--agent-bar-inset,0px)] motion-safe:transition-[padding-top] motion-safe:duration-[240ms] motion-safe:ease-[cubic-bezier(0.4,0,0.2,1)]">
                                <Inspector sessionId={sessionId} />
                            </div>
                        }
                    >
                        <div className="flex h-full min-h-0 w-full min-w-0">
                            {/* Top padding tracks the session bar (--agent-bar-inset, published by
                            AgentChatPanel and inherited here): the transcript eases down under the
                            absolute bar in build and reclaims the space in chat. It lives on the
                            TRANSCRIPT COLUMN alone — not a shared ancestor — so the context rail
                            beside it keeps a fixed top and doesn't ride the transition upward.
                            box-border so the padding fits inside h-full (preflight is off).
                            NO column gap: the transcript's bottom fade is meant to dissolve content
                            into the composer edge, and a gap between them left a dead band of canvas
                            that read as the transcript being cut short. Docked chrome below carries
                            its own `mb-2`, so nothing here depended on the gap for separation. */}
                            <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col box-border pt-[var(--agent-bar-inset,0px)] motion-safe:transition-[padding-top] motion-safe:duration-[240ms] motion-safe:ease-[cubic-bezier(0.4,0,0.2,1)]">
                                {/* Stream errors are surfaced inline on the failing turn (red error bubble with the
                real reason), stamped in the effect above — no separate top-level banner. */}
                                <AgentTranscript
                                    messages={transcriptMessages}
                                    activeStart={activeStart}
                                    reserveActive={reserveActive}
                                    renderMessage={renderMessage}
                                    virt={virt}
                                    scroll={scroll}
                                    showJump={showJump}
                                    gateOpen={gateOpen}
                                    placeholder={
                                        <TranscriptPlaceholder
                                            entityId={entityId}
                                            sessionId={sessionId}
                                            pendingFirstTurn={onboardingChat.pendingFirstTurn}
                                            pendingFirstMessage={onboardingChat.pendingFirstMessage}
                                            onboardingActive={onboardingActive}
                                            browseAll={onboardingChat.onboarding?.browseAll}
                                            isHydrating={isHydrating}
                                            hydratedEmpty={hydratedEmpty}
                                            firstRunPrompt={firstRunPrompt}
                                            showTemplateStrip={showTemplateStrip}
                                            canStart={!modelBlocked}
                                            onStart={handleSubmit}
                                            onPrefill={(text: string) =>
                                                richInputRef.current?.setMarkdown(text)
                                            }
                                            onRewind={handleRewind}
                                            onClientToolOutput={handleClientToolOutput}
                                        />
                                    }
                                />

                                {/* The highlight is the composer alone: lighting the whole
                                transcript to accept a file the composer will hold read as the
                                page itself being the target. */}
                                <div className="relative">
                                    <AttachmentDropOverlay
                                        active={isDragging}
                                        atMax={atMax}
                                        hint={
                                            atMax
                                                ? `Remove one to add another (${limits.maxCount} max)`
                                                : `${describeAccepted(limits)} · up to ${limits.maxCount} files`
                                        }
                                    />
                                    <AgentComposerDock
                                        entityId={entityId}
                                        messages={messages}
                                        busy={busy}
                                        showRunningElsewhere={remoteTurn.showStrip}
                                        connectionWarning={connectionWarning}
                                        hitlPending={hitlPending}
                                        queue={{
                                            queued,
                                            removeQueued,
                                            editingId,
                                            beginEdit,
                                            cancelEdit,
                                        }}
                                        modelKey={{...modelKey, entityId}}
                                        modelBlocked={modelBlocked}
                                        contextMaxTokens={contextMaxTokens}
                                        showContextBudget={showContextBudget}
                                        showTemplateStrip={showTemplateStrip}
                                        pendingApprovals={pendingApprovals}
                                        onApprovalResponse={handleApprovalResponse}
                                        onApprovalResponses={handleApprovalResponses}
                                        connects={connects}
                                        elicits={elicits}
                                        onClientToolOutput={handleClientToolOutput}
                                        onSubmit={handleSubmit}
                                        onStop={handleStop}
                                        stopping={stopping}
                                        richInputRef={richInputRef}
                                        composer={{...composer, handleComposerChange}}
                                        attachments={attachments}
                                        onboardingChat={onboardingChat}
                                        voice={voice}
                                        audioPerceivable={audioPerceivable}
                                        composerDisabled={composerDisabled}
                                        attachmentsBlocked={attachmentsBlocked}
                                    />
                                </div>
                            </div>
                            {/* Chat-mode context rail (spec E1): docked right of the transcript, Files
                            pinned on top. Always mounted so hide/show SLIDES (width transition) —
                            hidden in build mode and while the Turn/Session panel owns the right
                            edge. */}
                            <ContextRail
                                sessionId={sessionId}
                                busy={busy}
                                hidden={buildMode || inspectorOpen}
                                onOpenFiles={openFilesPane}
                                onStageFiles={
                                    uploadsEnabled ? (files) => setFilesStaged(files) : undefined
                                }
                            />
                        </div>
                    </RightPanelSplit>
                </div>
            </ConnectionFocusProvider>
        </DriveSessionProvider>
    )
}

export default AgentConversation
