import {type RefObject, Suspense, lazy, useCallback, useEffect, useRef} from "react"

import {openAgentConfigSectionAtom} from "@agenta/shared/state"
import {HeightCollapse} from "@agenta/ui"
import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {ArrowRight, Code, Paperclip} from "@phosphor-icons/react"
import {type UIMessage} from "ai"
import {Button, Tooltip} from "antd"
import {useSetAtom} from "jotai"
import {AnimatePresence, motion} from "motion/react"

import {TEMPLATE_STRIP_MODE} from "@/oss/components/pages/agent-home/assets/constants"
import Reveal from "@/oss/components/pages/agent-home/PlaygroundOnboarding/Reveal"
import TemplateStrip from "@/oss/components/TemplateStrip"
import {STRIP_COPY} from "@/oss/components/TemplateStrip/assets/constants"
import AgentIntentActions from "@/oss/components/TemplateStrip/components/AgentIntentActions"

import {CHAT_COLUMN} from "../assets/conversationLayout"
import {SESSION_SPRING} from "../assets/sessionMotion"
import {type QueuedMessage} from "../hooks/useAgentChatQueue"
import {useChatSlashCommands} from "../hooks/useChatSlashCommands"
import {type useComposerAttachments} from "../hooks/useComposerAttachments"
import {type useComposerDraft} from "../hooks/useComposerDraft"
import {type useOnboardingChat} from "../hooks/useOnboardingChat"
import {type useVoiceComposer} from "../hooks/useVoiceComposer"
import {chatPanelMaximizedAtom} from "../state/panelLayout"

import {ComposerSkeleton} from "./AgentChatSkeleton"
import ApprovalDock, {type getPendingApprovals} from "./ApprovalDock"
import type {ClientToolOutputHandler} from "./clientTools"
import ComposerAttachments from "./ComposerAttachments"
import ConnectModelBanner from "./ConnectModelBanner"
import ContextBudgetIndicator from "./ContextBudgetIndicator"
import InteractionDock, {type getPendingConnectInteraction} from "./InteractionDock"
import MicPermissionNotice from "./MicPermissionNotice"
import QueuedMessages from "./QueuedMessages"
import RecordingBar from "./RecordingBar"
import RevealCollapse from "./RevealCollapse"
import RunningElsewhereStrip from "./RunningElsewhereStrip"
import HarnessPickerPanel from "./SlashCommand/HarnessPickerPanel"
import PermissionsPickerPanel from "./SlashCommand/PermissionsPickerPanel"
import VoiceInputButton from "./VoiceInputButton"

// The composer carries Lexical — the heaviest dependency of this chunk — out of the
// conversation's synchronous mount; React.lazy (not next/dynamic) so the imperative handle
// ref forwards. Its fallback is the same ComposerSkeleton the frame reserves for this slot.
const RichChatInput = lazy(() =>
    import("@agenta/ui/rich-chat-input").then((m) => ({default: m.RichChatInput})),
)

/**
 * Everything below the transcript: the held-message queue, the connect-model banner, the HITL
 * approval and interaction docks, the template strips, the voice surface, and the composer itself.
 * The docks live in this block (not inline in the transcript) so a paused gate can never scroll out
 * of reach.
 */
const AgentComposerDock = ({
    entityId,
    messages,
    busy,
    runningElsewhere,
    hitlPending,
    queue,
    modelKey,
    modelBlocked,
    contextMaxTokens,
    showContextBudget,
    buildMode,
    firstRunPrompt,
    pendingApprovals,
    onApprovalResponse,
    onViewTrace,
    pendingInteraction,
    onClientToolOutput,
    onSubmit,
    onStop,
    richInputRef,
    composer,
    attachments,
    onboardingChat,
    voice,
    audioPerceivable,
    composerDisabled,
    attachmentsBlocked,
}: {
    entityId: string
    messages: UIMessage[]
    busy: boolean
    /** The backend reports a live run for this session that this browser is not driving. */
    runningElsewhere: boolean
    hitlPending: boolean
    queue: {
        queued: QueuedMessage[]
        removeQueued: (id: string) => void
        clearQueue: () => void
    }
    modelKey: React.ComponentProps<typeof ConnectModelBanner>
    modelBlocked: boolean
    contextMaxTokens: number | null
    showContextBudget: boolean
    buildMode: boolean
    firstRunPrompt: string | null
    pendingApprovals: ReturnType<typeof getPendingApprovals>
    onApprovalResponse: (args: {id: string; approved: boolean; message?: string}) => void
    onViewTrace?: () => void
    pendingInteraction: ReturnType<typeof getPendingConnectInteraction>
    onClientToolOutput: ClientToolOutputHandler
    onSubmit: (text: string) => void | Promise<void>
    onStop: () => void
    richInputRef: RefObject<RichChatInputHandle | null>
    composer: ReturnType<typeof useComposerDraft>
    attachments: ReturnType<typeof useComposerAttachments>
    onboardingChat: ReturnType<typeof useOnboardingChat>
    voice: ReturnType<typeof useVoiceComposer>
    /** Whether the selected model can take audio in; `null` where the catalog does not say. */
    audioPerceivable: boolean | null
    /** The composer itself is unusable (IDE hand-off / no model key). */
    composerDisabled: boolean
    /** Read at event time — attachments are refused right now (a take in flight, or the above). */
    attachmentsBlocked: () => boolean
}) => {
    const {
        onboarding,
        onboardingActive,
        chromeHidden,
        selectedTemplateKey,
        handleStripPick,
        isFreshAgentRevision,
        pendingFirstTurn,
        handleCreateAgent,
        streamIdeBubble,
        ideHandoffActive,
        handleStartOver,
        showBareOnboardingHero,
    } = onboardingChat
    const {
        uploadsEnabled,
        files,
        rejections,
        setRejections,
        attachmentsOpen,
        setAttachmentsOpen,
        setViewingUid,
        limits,
        atMax,
        attachmentsSettled,
        uploadBlockReason,
        addFiles,
        removeFile,
        uploads,
    } = attachments
    const {
        voiceEnabled,
        voiceRecorder,
        voiceWillSend,
        startVoiceMessage,
        dictating,
        setDictating,
        setDictationError,
        micError,
        dismissMicError,
    } = voice

    // The `/` palette and its two pickers. Both pickers anchor to the composer box below, so they
    // sit exactly where the palette was — one place the user looks.
    const composerBoxRef = useRef<HTMLDivElement | null>(null)
    const openConfigSection = useSetAtom(openAgentConfigSectionAtom)
    const setChatMaximized = useSetAtom(chatPanelMaximizedAtom)
    const clearDraft = composer.clearDraft
    const clearComposerCommand = useCallback(() => {
        richInputRef.current?.clear()
        clearDraft()
    }, [clearDraft, richInputRef])
    // A click outside is a deliberate move elsewhere, so it is the one close that must NOT pull
    // focus back. Everything else — apply, Escape, back to commands — returns you to typing.
    const skipFocusRestoreRef = useRef(false)
    const slash = useChatSlashCommands({
        entityId,
        suspended: onboardingActive,
        // The command has served its purpose once the picker is up; leaving it behind just reads
        // as text the user now has to delete before typing a message. Blur first — the picker
        // autofocuses its search, and a still-focused editor takes focus back on the next
        // reconcile, which Radix reads as an outside interaction and dismisses on.
        onPickerOpen: useCallback(() => {
            richInputRef.current?.blur()
            richInputRef.current?.clear()
            clearDraft()
        }, [clearDraft, richInputRef]),
    })
    // Restoring focus can only happen AFTER the picker unmounts: a focus() call in the handler is
    // undone when the still-focused panel (or Radix popover) leaves the DOM.
    const hadPickerRef = useRef(slash.picker)
    useEffect(() => {
        const had = hadPickerRef.current
        hadPickerRef.current = slash.picker
        if (!had || slash.picker) return
        if (skipFocusRestoreRef.current) {
            skipFocusRestoreRef.current = false
            return
        }
        richInputRef.current?.focus()
    }, [richInputRef, slash.picker])
    const dismissPicker = (reason: "escape" | "outside") => {
        if (reason === "outside") skipFocusRestoreRef.current = true
        slash.closePicker()
    }
    // Step back one level. The picker consumed the `/` that opened it, so returning to the palette
    // means putting it back — typing it again is what "back to commands" exists to avoid.
    const backToCommands = () => {
        slash.closePicker()
        richInputRef.current?.setMarkdown("/")
    }
    const openConfigFor = (section: "model-harness" | "advanced") => {
        slash.closePicker()
        setChatMaximized(false)
        openConfigSection(section)
    }
    const openModelHarnessConfig = () => openConfigFor("model-harness")
    // Permission rules live in the Advanced accordion's Permissions group.
    const openPermissionsConfig = () => openConfigFor("advanced")

    return (
        <>
            {/* Queue sits BETWEEN the messages and the composer, so showing it never shifts the
                composer (and the editor) upward. Streaming itself is signalled by the composer's
                send button (it becomes a spinning Stop button), so there's no "Streaming…" row. */}
            <RevealCollapse open={queue.queued.length > 0} className={CHAT_COLUMN}>
                <div className="flex items-center gap-2 px-3 pb-2">
                    <QueuedMessages
                        queued={queue.queued}
                        onRemove={queue.removeQueued}
                        onClear={queue.clearQueue}
                        held={hitlPending}
                    />
                </div>
            </RevealCollapse>

            {/* Rich markdown composer (Lexical). Enter sends; attachments via header/prefix slots.
                Wrapper `px-3` keeps the session-bar gutter; the input centers on CHAT_COLUMN so it
                aligns with the (also centered) message column when the panel is wide. The persistent
                HITL approval dock lives in this same block (above the input) — always mounted so it
                animates in/out, and inside the composer region so the paused gate can't scroll out
                of reach and its collapse adds no gap to the surrounding column. */}
            {/* The whole composer fades + rises in ONCE on mount (Reveal), so the input joins the
                empty-state/hero entrance instead of popping. Mount-only: it never remounts across the
                onboarding→chat transitions, so this never reintroduces layout shift on state changes. */}
            <Reveal className="px-3" enabled={composer.playComposerEntrance}>
                {/* Agent empty-chat strip (S6): docked above the composer, unmounts once a
                    message exists or a first-run prompt is pending. Build-mode + fresh-agent
                    only — never in maximized chat mode, and gone for good after any commit. */}
                {TEMPLATE_STRIP_MODE &&
                !onboardingActive &&
                buildMode &&
                isFreshAgentRevision &&
                messages.length === 0 &&
                !firstRunPrompt &&
                !pendingFirstTurn ? (
                    <div className={`${CHAT_COLUMN} mb-3`}>
                        <TemplateStrip
                            surface="agent-chat"
                            selectedTemplateKey={selectedTemplateKey}
                            onPick={handleStripPick}
                            surfaceColorVar="--ag-surface-chat"
                        />
                    </div>
                ) : null}
                {/* Always mounted so it animates in/out (RevealCollapse) instead of popping. Pre-commit
                    onboarding SUPPRESSES it — the provider-key check is deferred until the agent is
                    committed (Create-agent then runs the connect→unlock→auto-send flow on the real agent). */}
                <div className={CHAT_COLUMN}>
                    <ConnectModelBanner {...modelKey} suppressed={chromeHidden} />
                </div>
                {/* Sits with the other docked strips so a session running in another browser reads
                    as busy instead of frozen (#5530). */}
                {runningElsewhere && !chromeHidden ? (
                    <RunningElsewhereStrip className={CHAT_COLUMN} />
                ) : null}
                <ApprovalDock
                    className={CHAT_COLUMN}
                    approvals={pendingApprovals}
                    onApprovalResponse={onApprovalResponse}
                    onViewTrace={onViewTrace}
                    entityId={entityId}
                />
                {/* Parked client-tool interactions (connect): same placement contract as the
                    approval dock — the paused gate can't scroll out of reach, and "Not now"
                    is the escape hatch that resumes the run without connecting. */}
                <InteractionDock
                    className={CHAT_COLUMN}
                    pending={pendingInteraction}
                    onOutput={onClientToolOutput}
                />
                {/* Owner call: a template pick must not shift the composer, so no chip renders here
                    (unlike the home surface) — the strip card's own selected state is the
                    "which template" indicator; the composer text is the only other feedback. */}
                {/* Onboarding strip: docked directly above the composer (mb-3 gap), mirroring the
                    agent-chat strip's rhythm — hero stays top-aligned above the flex space, and
                    the strip + composer read as one bottom-anchored cluster. */}
                {showBareOnboardingHero ? (
                    <div className={`${CHAT_COLUMN} mb-3`}>
                        <TemplateStrip
                            surface="onboarding"
                            selectedTemplateKey={selectedTemplateKey}
                            onPick={handleStripPick}
                            surfaceColorVar="--ag-surface-chat"
                        />
                    </div>
                ) : null}
                {/* Composer region hydrates independently (Lexical chunk); the fallback is the
                    same skeleton the pane-level gates render for this slot, so the box never
                    changes shape — the editor just materializes inside it. */}
                {voiceEnabled ? (
                    <MicPermissionNotice
                        className={CHAT_COLUMN}
                        open={!!micError && !voiceRecorder.active}
                        message={micError}
                        onDismiss={dismissMicError}
                    />
                ) : null}
                {/* `mb-3` lives here, not on the input, so the recording overlay
                (inset-0) covers the composer box exactly. */}
                <div className="relative mb-3" ref={composerBoxRef}>
                    {/* Drilled into from the palette: same anchor, so the panel replaces the menu
                        in place rather than opening somewhere else on screen. */}
                    {slash.picker === "harness" ? (
                        // `origin-bottom`: the panel is docked to the composer's top edge, so it
                        // grows out of that edge rather than from its own middle.
                        <div
                            className={`absolute bottom-full left-0 right-0 z-[1050] mb-2 origin-bottom animate-command-panel-in motion-reduce:animate-command-panel-fade ${CHAT_COLUMN}`}
                        >
                            <HarnessPickerPanel
                                harnessIds={slash.harnessIds}
                                capabilities={slash.capabilities}
                                currentHarness={slash.currentHarness}
                                currentModel={slash.currentModel}
                                onApply={(kind) => {
                                    slash.applyHarness(kind)
                                    clearComposerCommand()
                                }}
                                onDismiss={dismissPicker}
                                onBackToCommands={backToCommands}
                                onOpenConfig={openModelHarnessConfig}
                            />
                        </div>
                    ) : null}
                    {slash.picker === "permissions" ? (
                        <div
                            className={`absolute bottom-full left-0 right-0 z-[1050] mb-2 origin-bottom animate-command-panel-in motion-reduce:animate-command-panel-fade ${CHAT_COLUMN}`}
                        >
                            <PermissionsPickerPanel
                                current={slash.currentPermission}
                                onApply={(policy) => {
                                    slash.applyPermission(policy)
                                    richInputRef.current?.focus()
                                }}
                                onDismiss={dismissPicker}
                                onBackToCommands={backToCommands}
                                onOpenConfig={openPermissionsConfig}
                            />
                        </div>
                    ) : null}
                    {/* The catalog picker itself — controlled open, no trigger of its own. */}
                    <SelectLLMProviderBase
                        open={slash.picker === "model"}
                        onOpenChange={(next) => {
                            if (!next) slash.closePicker()
                        }}
                        onDismissOutside={() => {
                            skipFocusRestoreRef.current = true
                        }}
                        onStepBack={backToCommands}
                        anchorRef={composerBoxRef}
                        hideTrigger
                        showGroup
                        showSearch
                        options={slash.modelGroups}
                        value={slash.currentModel}
                        onChange={(next) => {
                            slash.applyModel(next)
                            clearComposerCommand()
                        }}
                        searchSuffix="/model"
                        panelFooter={
                            <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--ag-colorTextTertiary)]">
                                <span>Changes this agent&apos;s draft config.</span>
                                <button
                                    type="button"
                                    onClick={openModelHarnessConfig}
                                    className="cursor-pointer border-none bg-transparent p-0 text-[10.5px] text-[var(--ag-colorPrimary)]"
                                >
                                    Open config →
                                </button>
                                <button
                                    type="button"
                                    onClick={backToCommands}
                                    className="ml-auto flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-[10.5px] text-[var(--ag-colorTextTertiary)]"
                                >
                                    <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-[3px] bg-[var(--ag-colorFillTertiary)] px-1 font-mono text-[9.5px] font-medium text-[var(--ag-colorTextSecondary)]">
                                        ←
                                    </span>
                                    back to commands
                                </button>
                            </div>
                        }
                    />
                    <Suspense fallback={<ComposerSkeleton className={CHAT_COLUMN} />}>
                        <RichChatInput
                            ref={richInputRef}
                            autoFocus={composer.autoFocusComposer}
                            dictating={voiceEnabled && dictating}
                            className={CHAT_COLUMN}
                            // Onboarding: submit = commit the ephemeral — Enter creates the agent
                            // (matching the composer's "↵ Send" hint); ⌘/Shift+Enter inserts newlines
                            // for longer descriptions.
                            onSubmit={onboardingActive ? () => handleCreateAgent() : onSubmit}
                            disabled={onboardingActive ? ideHandoffActive : modelBlocked}
                            hideSendButton={onboardingActive}
                            placeholder={
                                onboardingActive
                                    ? ideHandoffActive
                                        ? "Continue in your IDE from the steps above — or start over."
                                        : STRIP_COPY.describeAgentPlaceholder
                                    : modelBlocked
                                      ? "Connect a model to start chatting…"
                                      : hitlPending
                                        ? "The agent is waiting for your response — new messages will be queued"
                                        : "Ask the agent… (Enter to send, ⌘/Ctrl+Enter for newline)"
                            }
                            initialMarkdown={composer.initialDraft}
                            slashCommands={slash.sections}
                            onChange={composer.handleComposerChange}
                            onPasteFile={(pasted) => {
                                if (!attachmentsBlocked()) addFiles(Array.from(pasted))
                            }}
                            sendForceEnabled={files.length > 0 && attachmentsSettled}
                            sendDisabled={files.length > 0 && !attachmentsSettled}
                            sendDisabledReason={uploadBlockReason}
                            streaming={busy}
                            onStop={onStop}
                            prefix={
                                // Left cluster of the composer toolbar: voice mic + the (gated)
                                // attach button + the context token-budget readout, filling the
                                // otherwise-empty left space next to the attachments icon.
                                <div className="flex items-center gap-2">
                                    {voiceEnabled ? (
                                        <VoiceInputButton
                                            inputRef={richInputRef}
                                            onStartAudio={startVoiceMessage}
                                            // During onboarding the composer commits the
                                            // ephemeral via handleCreateAgent, but a voice
                                            // MESSAGE routes through handleSubmit → submit,
                                            // bypassing that commit. So offer dictation
                                            // only (it just fills the description text) —
                                            // voice-message returns once the agent exists.
                                            audioSupported={
                                                !onboardingActive && voiceRecorder.supported
                                            }
                                            audioPending={voiceRecorder.pending}
                                            audioPerceivable={audioPerceivable}
                                            attachmentsFull={atMax}
                                            onDictationError={setDictationError}
                                            onDictatingChange={setDictating}
                                            disabled={
                                                onboardingActive ? ideHandoffActive : modelBlocked
                                            }
                                        />
                                    ) : null}
                                    {/* Gate the attach button until inline file parts are supported. */}
                                    <Tooltip
                                        title={
                                            !uploadsEnabled
                                                ? "Attach files coming soon"
                                                : atMax
                                                  ? `Up to ${limits.maxCount} files`
                                                  : "Attach files"
                                        }
                                    >
                                        <Button
                                            type="text"
                                            icon={<Paperclip size={16} />}
                                            // Paste, drop and voice all attach
                                            // already; leaving the obvious control
                                            // dead was the odd one out. Gated with
                                            // them on the composer being usable.
                                            disabled={!uploadsEnabled || composerDisabled}
                                            onClick={() => setAttachmentsOpen((open) => !open)}
                                            aria-label="Attach files"
                                        />
                                    </Tooltip>
                                    {/* Context-budget meter temporarily hidden from the UI.
                                    Logic is retained — flip `showContextBudget` to re-enable.
                                    Only meaningful in a real conversation, so still gated on
                                    onboarding (no turns / no usage yet). */}
                                    {showContextBudget && !onboardingActive ? (
                                        <ContextBudgetIndicator
                                            messages={messages}
                                            maxTokens={contextMaxTokens}
                                        />
                                    ) : null}
                                </div>
                            }
                            header={
                                <HeightCollapse open={attachmentsOpen || files.length > 0}>
                                    <ComposerAttachments
                                        files={files}
                                        rejections={rejections}
                                        limits={limits}
                                        onAdd={addFiles}
                                        onRemove={removeFile}
                                        onDismissRejections={() => setRejections([])}
                                        onView={uploadsEnabled ? setViewingUid : undefined}
                                        onRetry={uploads.retry}
                                        canRetry={uploads.canRetry}
                                    />
                                </HeightCollapse>
                            }
                            trailing={
                                onboardingActive ? (
                                    ideHandoffActive ? (
                                        <Button onClick={handleStartOver} className="!shadow-none">
                                            Start over
                                        </Button>
                                    ) : TEMPLATE_STRIP_MODE ? (
                                        // Strip era: the SAME action cluster as the home hero composer
                                        // (shared component), with the one-click copy + toast handoff.
                                        <AgentIntentActions
                                            onCreate={handleCreateAgent}
                                            loading={!!onboarding?.committing}
                                        />
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                icon={<Code size={14} />}
                                                onClick={streamIdeBubble}
                                                className="!shadow-none"
                                            >
                                                Continue in IDE
                                            </Button>
                                            <Button
                                                type="primary"
                                                icon={<ArrowRight size={14} />}
                                                iconPosition="end"
                                                loading={!!onboarding?.committing}
                                                onClick={handleCreateAgent}
                                                className="!shadow-none"
                                            >
                                                Create agent
                                            </Button>
                                        </div>
                                    )
                                ) : undefined
                            }
                        />
                    </Suspense>
                    {/* Cross-fades over the composer instead of popping; same spring
                    as the rest of the slice's chrome. */}
                    <AnimatePresence initial={false}>
                        {voiceEnabled && voiceRecorder.takeoverVisible && (
                            <motion.div
                                key="recording"
                                initial={{opacity: 0, y: 4}}
                                animate={{opacity: 1, y: 0}}
                                exit={{opacity: 0, y: 4}}
                                transition={SESSION_SPRING}
                                className="pointer-events-none absolute inset-0 flex justify-center"
                            >
                                <RecordingBar
                                    recorder={voiceRecorder}
                                    willSend={voiceWillSend}
                                    className={`${CHAT_COLUMN} h-full`}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </Reveal>
        </>
    )
}

export default AgentComposerDock
