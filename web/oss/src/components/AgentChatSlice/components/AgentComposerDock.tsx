import {useCallback, useEffect, useRef, type RefObject} from "react"

import {CHAT_COLUMN} from "@agenta/chat/assets"
import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {
    ChatComposer,
    MicPermissionNotice,
    RecordingBar,
    RevealCollapse,
    RunningElsewhereStrip,
    VoiceInputButton,
} from "@agenta/chat/components"
import {
    type ConnectionDockState,
    type QueuedMessage,
    type useComposerAttachments,
    type useVoiceComposer,
} from "@agenta/chat/hooks"
import {type getPendingApprovals} from "@agenta/chat/model"
import {chatPanelMaximizedAtom} from "@agenta/chat/state"
import {openAgentConfigSectionAtom} from "@agenta/shared/state"
import {dismissSoftKeyboardAfterSend} from "@agenta/ui/hooks"
import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {HarnessTooltip, SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {Button, LoadingButton} from "@agenta/ui/ui"
import {ArrowRight, Code} from "@phosphor-icons/react"
import {type UIMessage} from "ai"
import {useSetAtom} from "jotai"
import {AnimatePresence, motion} from "motion/react"

import {TEMPLATE_STRIP_MODE} from "@/oss/components/pages/agent-home/assets/constants"
import Reveal from "@/oss/components/pages/agent-home/PlaygroundOnboarding/Reveal"
import TemplateStrip from "@/oss/components/TemplateStrip"
import {STRIP_COPY} from "@/oss/components/TemplateStrip/assets/constants"
import AgentIntentActions from "@/oss/components/TemplateStrip/components/AgentIntentActions"

import {SESSION_SPRING} from "../assets/sessionMotion"
import {useChatSlashCommands} from "../hooks/useChatSlashCommands"
import {type useComposerDraft} from "../hooks/useComposerDraft"
import {type useOnboardingChat} from "../hooks/useOnboardingChat"

import {ComposerSkeleton} from "./AgentChatSkeleton"
import ApprovalDock from "./ApprovalDock"
import ConnectionDock from "./ConnectionDock"
import ConnectModelBanner from "./ConnectModelBanner"
import ContextBudgetIndicator from "./ContextBudgetIndicator"
import QueuedMessages from "./QueuedMessages"
import PermissionsPickerPanel from "./SlashCommand/PermissionsPickerPanel"

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
    showTemplateStrip,
    pendingApprovals,
    onApprovalResponse,
    connects,
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
    /** The agent empty-chat template strip is on (owned by AgentConversation — see its comment). */
    showTemplateStrip: boolean
    pendingApprovals: ReturnType<typeof getPendingApprovals>
    onApprovalResponse: (args: {id: string; approved: boolean; message?: string}) => void
    connects: ConnectionDockState
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
        handleCreateAgent,
        streamIdeBubble,
        ideHandoffActive,
        handleStartOver,
        showBareOnboardingHero,
    } = onboardingChat
    const {setViewingUid, atMax} = attachments
    const {
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

    // A click outside is a deliberate move elsewhere, so it is the one close that must NOT pull
    // focus back. Everything else — apply, Escape, back to commands — returns you to typing.
    const skipFocusRestoreRef = useRef(false)
    const slash = useChatSlashCommands({
        entityId,
        suspended: onboardingActive,
        // Blur only. The palette has already removed the `/…` run it consumed — and ONLY that run,
        // so a `hello /model` keeps its `hello` — which clearing the composer here would destroy.
        // Blur matters because the picker autofocuses its search, and a still-focused editor takes
        // focus back on the next reconcile, which Radix reads as an outside interaction.
        onPickerOpen: useCallback(() => {
            richInputRef.current?.blur()
        }, [richInputRef]),
    })
    // Sending on a touch device dismisses the on-screen keyboard, which returns the page to its
    // full height and puts the transcript back in view — the message you just sent is the thing
    // you want to read next. On desktop the editor keeps focus after Enter so the next message can
    // be typed straight away, so the helper checks the pointer type.
    //
    // It also DEFERS the blur, which is the part that matters: `submitEditorAsMarkdown` clears the
    // editor on the statement after this handler returns, and that reconcile writes a fresh DOM
    // selection, which re-focuses the editor and pops the keyboard straight back up. A blur called
    // inline here is undone before the user sees it.
    const submitMessage = useCallback(
        (text: string) => {
            const result = onSubmit(text)
            dismissSoftKeyboardAfterSend(() => richInputRef.current?.blur())
            return result
        },
        [onSubmit, richInputRef],
    )

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
    // Stable: both panels register document-level listeners keyed on these, so a new identity per
    // render would tear the listeners down and re-add them on every keystroke.
    const closePicker = slash.closePicker
    const dismissPicker = useCallback(
        (reason: "escape" | "outside") => {
            if (reason === "outside") skipFocusRestoreRef.current = true
            closePicker()
        },
        [closePicker],
    )
    // Step back one level. The picker consumed the `/` that opened it, so returning to the palette
    // means putting it back — typing it again is what "back to commands" exists to avoid. Insert
    // rather than setMarkdown: the rest of the message is still there and must stay.
    const backToCommands = useCallback(() => {
        closePicker()
        richInputRef.current?.insertText("/")
    }, [closePicker, richInputRef])
    const openConfigFor = useCallback(
        (section: "model-harness" | "advanced") => {
            closePicker()
            setChatMaximized(false)
            openConfigSection(section)
        },
        [closePicker, openConfigSection, setChatMaximized],
    )
    const openModelHarnessConfig = useCallback(
        () => openConfigFor("model-harness"),
        [openConfigFor],
    )
    // Permission rules live in the Advanced accordion's Permissions group.
    const openPermissionsConfig = useCallback(() => openConfigFor("advanced"), [openConfigFor])

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
                {/* Agent empty-chat strip (S6): docked above the composer. Visibility is decided by
                    AgentConversation, which hands the same flag to the empty state so exactly one of
                    the strip and the starter pills renders. */}
                {showTemplateStrip ? (
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
                    entityId={entityId}
                />
                {/* Parked client-tool interactions (connect): same placement contract as the
                    approval dock — the paused gate can't scroll out of reach, and "Not now"
                    is the escape hatch that resumes the run without connecting. */}
                <ConnectionDock
                    className={CHAT_COLUMN}
                    connects={connects}
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
                <MicPermissionNotice
                    className={CHAT_COLUMN}
                    open={!!micError && !voiceRecorder.active}
                    message={micError}
                    onDismiss={dismissMicError}
                />
                {/* `mb-3` lives here, not on the input, so the recording overlay
                (inset-0) covers the composer box exactly. */}
                <div className="relative mb-3" ref={composerBoxRef}>
                    {slash.picker === "permissions" ? (
                        <div
                            className={`absolute bottom-full left-0 right-0 z-[1050] mb-2 origin-bottom animate-command-panel-in motion-reduce:animate-command-panel-fade ${CHAT_COLUMN}`}
                        >
                            <PermissionsPickerPanel
                                current={slash.currentPermission}
                                options={slash.permissionOptions}
                                onApply={slash.applyPermission}
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
                        searchPlaceholder="Search models"
                        sectionTooltip={<HarnessTooltip />}
                        options={slash.modelGroups}
                        value={slash.currentModel}
                        // The option carries a vault pick's connection slug + kind; `applyModel`
                        // needs it to attach the right connection instead of guessing by model id.
                        onChange={(next, option) => slash.applyModel(next, option)}
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
                    {/* The SHARED composer — the same component mobile renders: lazy Lexical
                        input, paperclip, attachments tray, placeholders. Desktop-only chrome
                        (voice mic, context budget, onboarding actions) rides its slots. */}
                    <ChatComposer
                        inputRef={richInputRef}
                        autoFocus={composer.autoFocusComposer}
                        dictating={dictating}
                        className={CHAT_COLUMN}
                        fallback={<ComposerSkeleton className={CHAT_COLUMN} />}
                        // Onboarding: submit = commit the ephemeral — Enter creates the agent
                        // (matching the composer's "↵ Send" hint).
                        onSubmit={onboardingActive ? () => handleCreateAgent() : submitMessage}
                        disabled={onboardingActive ? ideHandoffActive : modelBlocked}
                        hideSendButton={onboardingActive}
                        placeholder={
                            onboardingActive
                                ? ideHandoffActive
                                    ? "Continue in your IDE from the steps above — or start over."
                                    : STRIP_COPY.describeAgentPlaceholder
                                : modelBlocked
                                  ? "Connect a model to start chatting…"
                                  : undefined
                        }
                        waitingOnUser={hitlPending}
                        initialMarkdown={composer.initialDraft}
                        slashCommands={slash.sections}
                        onChange={composer.handleComposerChange}
                        streaming={busy}
                        onStop={onStop}
                        attachments={attachments}
                        attachmentsBlocked={attachmentsBlocked}
                        composerDisabled={composerDisabled}
                        onViewAttachment={setViewingUid}
                        extraPrefix={
                            <>
                                <VoiceInputButton
                                    inputRef={richInputRef}
                                    onStartAudio={startVoiceMessage}
                                    // During onboarding the composer commits the ephemeral via
                                    // handleCreateAgent, but a voice MESSAGE routes through
                                    // handleSubmit → submit, bypassing that commit. So offer
                                    // dictation only — voice-message returns once the agent exists.
                                    audioSupported={!onboardingActive && voiceRecorder.supported}
                                    audioPending={voiceRecorder.pending}
                                    audioPerceivable={audioPerceivable}
                                    attachmentsFull={atMax}
                                    onDictationError={setDictationError}
                                    onDictatingChange={setDictating}
                                    disabled={onboardingActive ? ideHandoffActive : modelBlocked}
                                />
                                {/* Context-budget meter temporarily hidden from the UI.
                                    Logic is retained — flip `showContextBudget` to re-enable. */}
                                {showContextBudget && !onboardingActive ? (
                                    <ContextBudgetIndicator
                                        messages={messages}
                                        maxTokens={contextMaxTokens}
                                    />
                                ) : null}
                            </>
                        }
                        trailing={
                            onboardingActive ? (
                                ideHandoffActive ? (
                                    <Button
                                        variant="outline"
                                        onClick={handleStartOver}
                                        className="shadow-none"
                                    >
                                        Start over
                                    </Button>
                                ) : TEMPLATE_STRIP_MODE ? (
                                    // Strip era: the SAME action cluster as the home hero composer
                                    // (shared component).
                                    <AgentIntentActions
                                        onCreate={handleCreateAgent}
                                        loading={!!onboarding?.committing}
                                    />
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={streamIdeBubble}
                                            className="shadow-none"
                                        >
                                            <Code size={14} />
                                            Continue in IDE
                                        </Button>
                                        <LoadingButton
                                            loading={!!onboarding?.committing}
                                            onClick={handleCreateAgent}
                                            className="shadow-none"
                                        >
                                            Create agent
                                            <ArrowRight size={14} />
                                        </LoadingButton>
                                    </div>
                                )
                            ) : undefined
                        }
                    />
                    {/* Cross-fades over the composer instead of popping; same spring
                    as the rest of the slice's chrome. */}
                    <AnimatePresence initial={false}>
                        {voiceRecorder.takeoverVisible && (
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
