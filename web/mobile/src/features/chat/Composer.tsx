import {useCallback, useEffect, useRef, type MutableRefObject} from "react"

import {describeAccepted} from "@agenta/chat/assets"
import {
    AttachmentDropOverlay,
    ChatComposer,
    MicPermissionNotice,
    PermissionsPickerPanel,
    RecordingBar,
    VoiceInputButton,
} from "@agenta/chat/components"
import {
    stagedFilesToParts,
    useChatSlashCommands,
    useComposerAttachments,
    useComposerDraft,
    useVoiceComposer,
} from "@agenta/chat/hooks"
import {dismissSoftKeyboardAfterSend} from "@agenta/ui/hooks"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {HarnessTooltip, SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import type {FileUIPart} from "ai"
import {AnimatePresence, motion} from "motion/react"

import {ContentRail} from "@/components/ContentRail"
import {useMotionPresets} from "@/lib/motion/presets"

/**
 * The mobile composer shell — the SAME `ChatComposer` the desktop dock renders (lazy rich
 * input, paperclip, attachments tray, queue-aware placeholder), pinned in the screen footer.
 * This wrapper owns only mobile chrome (the safe-area bar + content rail) and the send
 * transport: staged attachments upload to the sessions attachment store and ride the send as
 * reference file parts, exactly like desktop.
 *
 * Voice rides the same slots the desktop dock uses — the mic in `extraPrefix`, the recording
 * takeover over the input, the permission notice above it — so dictation and voice messages
 * behave identically on both surfaces and stay behind one per-user setting.
 */
export const Composer = ({
    entityId,
    sessionId,
    onSend,
    disabled = false,
    waitingOnUser = false,
    streaming = false,
    stopping = false,
    onStop,
    inputRef,
    placeholder,
}: {
    /** The agent revision the `/` palette reads and writes (model, permissions, skills). */
    entityId: string
    sessionId: string
    onSend: (input: {text: string; parts?: FileUIPart[]}) => void | Promise<void>
    /** No resolvable agent yet, or the screen is still hydrating. */
    disabled?: boolean
    /** The run is parked on the user (pending approval) — sends will queue. */
    waitingOnUser?: boolean
    /** A run is streaming from this device — the send button becomes Stop. */
    streaming?: boolean
    /** The durable Stop request has not settled yet. */
    stopping?: boolean
    onStop?: () => void
    /** Lets the host write into the input — a rewind puts the rewound message back to edit. */
    inputRef?: MutableRefObject<RichChatInputHandle | null>
    /** Full placeholder override — used when the composer is gated (no model key). */
    placeholder?: string
}) => {
    const attachments = useComposerAttachments({sessionId})
    const ownInputRef = useRef<RichChatInputHandle | null>(null)
    const richInputRef = inputRef ?? ownInputRef
    // A tab switch is a route change here, so the whole composer unmounts — the per-session
    // draft is what carries unsent text across it.
    const draft = useComposerDraft({sessionId, richInputRef})

    // The `/` palette and its two pickers, anchored to the composer box so they open where the
    // palette was. No `/new` row: the session rail's `+` is the only way to start one here.
    const composerBoxRef = useRef<HTMLDivElement>(null)
    // A tap outside is a deliberate move elsewhere — the one close that must not pull focus back.
    const skipFocusRestoreRef = useRef(false)
    const slash = useChatSlashCommands({
        entityId,
        // The picker autofocuses itself; a still-focused Lexical editor takes focus back on the
        // next reconcile, which Radix reads as an outside interaction and dismisses on.
        onPickerOpen: useCallback(() => {
            richInputRef.current?.blur()
        }, [richInputRef]),
    })
    // Focus can only return AFTER the picker unmounts — a focus() in the handler is undone when
    // the still-focused panel leaves the DOM.
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
    // Stable: both panels register document-level listeners keyed on these.
    const closePicker = slash.closePicker
    const dismissPicker = useCallback(
        (reason: "escape" | "outside") => {
            if (reason === "outside") skipFocusRestoreRef.current = true
            closePicker()
        },
        [closePicker],
    )
    // The picker consumed the `/` that opened it, so stepping back puts it back. Insert, not
    // setMarkdown: the rest of the message is still there.
    const backToCommands = useCallback(() => {
        closePicker()
        richInputRef.current?.insertText("/")
    }, [closePicker, richInputRef])
    const sending = useRef(false)
    const presets = useMotionPresets()

    /**
     * `extraFiles` are takes that never entered the tray (a voice message sent outright), so
     * they upload here before the send — the same seam the desktop dock uses.
     */
    const submit = async (text: string, extraFiles: File[] = []) => {
        // Enter and the send button (and a voice take completing) can all fire while an upload
        // is still in flight; a second pass would re-send the same staged tray.
        if (sending.current) return
        sending.current = true
        // The message is written; anything still coming in belongs to no draft.
        voice.endDictation()
        // Close the on-screen keyboard. It covered the transcript while you typed, and the reply
        // to the message you just sent is the thing you want to see next. The helper defers the
        // blur past the editor's own clear, whose reconcile would otherwise re-focus the input and
        // pop the keyboard straight back up.
        dismissSoftKeyboardAfterSend(() => richInputRef.current?.blur())
        try {
            await runSubmit(text, extraFiles)
        } finally {
            sending.current = false
        }
    }

    const runSubmit = async (text: string, extraFiles: File[] = []) => {
        const staged = attachments.files
        const uploadedExtras = extraFiles.length
            ? await attachments.uploadExtraFiles(extraFiles)
            : []
        // A failed upload adopts the take into the tray; hold the send so nothing is lost.
        if (!uploadedExtras) return
        const outbound = [...staged, ...uploadedExtras]
        try {
            // `stagedFilesToParts` THROWS on a file whose upload hasn't settled — reachable via
            // Enter, which the send button's `sendDisabled` guard doesn't cover.
            const parts = outbound.length > 0 ? stagedFilesToParts(outbound, sessionId) : undefined
            await onSend({text, parts})
            draft.clearDraft()
            attachments.clearAttachments(staged.map((file) => file.uid))
        } catch {
            // Nothing consumes this promise (RichChatInput's submit is fire-and-forget), so an
            // uncaught rejection would leave the user with no message, no error, and no idea a
            // send even failed. Keep the attachments staged, put the text back, and say so
            // through the composer's own inline channel.
            richInputRef.current?.setMarkdown(text)
            attachments.setRejections([{name: "Message", reason: "wasn't sent — try again."}])
        }
    }

    const voice = useVoiceComposer({
        richInputRef,
        stagedCount: attachments.files.length,
        onAttach: (file) => attachments.addFiles([file]),
        onSendVoiceMessage: (file) => void submit("", [file]),
    })
    const {
        voiceRecorder,
        voiceWillSend,
        startVoiceMessage,
        dictationStopRef,
        dictating,
        setDictating,
        setDictationError,
        micError,
        dismissMicError,
    } = voice

    // A drop or paste landing mid-take could take the tray slot the recording needs, and an
    // unusable composer is a dead end for a file.
    const attachmentsBlocked = () => voiceRecorder.active || disabled

    // Desktop accepts a drop anywhere on the canvas and highlights only the composer. Mobile owns
    // no element above itself, so it reaches for the shared `.ag-canvas` root and binds there —
    // the overlay still paints over the composer alone.
    const dropHostRef = useRef<HTMLDivElement>(null)
    const dropHandlersRef = useRef(attachments.bindDropTarget(attachmentsBlocked))
    dropHandlersRef.current = attachments.bindDropTarget(attachmentsBlocked)
    useEffect(() => {
        const host = dropHostRef.current?.closest(".ag-canvas")
        if (!host) return
        const enter = (e: Event) => dropHandlersRef.current.onDragEnter(e as never)
        const over = (e: Event) => dropHandlersRef.current.onDragOver(e as never)
        const leave = (e: Event) => dropHandlersRef.current.onDragLeave(e as never)
        const drop = (e: Event) => dropHandlersRef.current.onDrop(e as never)
        host.addEventListener("dragenter", enter)
        host.addEventListener("dragover", over)
        host.addEventListener("dragleave", leave)
        host.addEventListener("drop", drop)
        return () => {
            host.removeEventListener("dragenter", enter)
            host.removeEventListener("dragover", over)
            host.removeEventListener("dragleave", leave)
            host.removeEventListener("drop", drop)
        }
    }, [])

    return (
        <div className="bg-background shrink-0 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <ContentRail>
                <MicPermissionNotice
                    open={!!micError && !voiceRecorder.active}
                    message={micError}
                    onDismiss={dismissMicError}
                />
                <div ref={dropHostRef} className="relative">
                    <AttachmentDropOverlay
                        active={attachments.isDragging}
                        atMax={attachments.atMax}
                        hint={
                            attachments.atMax
                                ? `Remove one to add another (${attachments.limits.maxCount} max)`
                                : describeAccepted(attachments.limits)
                        }
                    />
                    <div ref={composerBoxRef} className="relative">
                        <AnimatePresence initial={false}>
                            {slash.picker === "permissions" ? (
                                <motion.div
                                    key="permissions"
                                    variants={presets.crossfade}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    className="absolute inset-x-0 bottom-full z-50 mb-2"
                                >
                                    <PermissionsPickerPanel
                                        current={slash.currentPermission}
                                        options={slash.permissionOptions}
                                        onApply={slash.applyPermission}
                                        onDismiss={dismissPicker}
                                        onBackToCommands={backToCommands}
                                    />
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                        {/* The catalog picker: controlled open, no trigger, sized to the composer. */}
                        <SelectLLMProviderBase
                            open={slash.picker === "model"}
                            onOpenChange={(next) => {
                                if (!next) closePicker()
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
                            onChange={(next, option) => slash.applyModel(next, option)}
                            searchSuffix="/model"
                            panelFooter={
                                <div className="text-muted-foreground flex items-center gap-1.5 text-[10.5px]">
                                    <span>Changes this agent&apos;s draft config.</span>
                                    <button
                                        type="button"
                                        onClick={backToCommands}
                                        className="text-muted-foreground ml-auto cursor-pointer border-none bg-transparent p-0 text-[10.5px]"
                                    >
                                        ← back to commands
                                    </button>
                                </div>
                            }
                        />
                        <ChatComposer
                            inputRef={richInputRef}
                            onSubmit={submit}
                            attachments={attachments}
                            attachmentsBlocked={attachmentsBlocked}
                            initialMarkdown={draft.initialDraft}
                            onChange={draft.handleComposerChange}
                            slashCommands={slash.sections}
                            disabled={disabled}
                            composerDisabled={disabled}
                            dictating={dictating}
                            placeholder={placeholder}
                            waitingOnUser={waitingOnUser}
                            streaming={streaming}
                            stopping={stopping}
                            onStop={onStop}
                            extraPrefix={
                                <VoiceInputButton
                                    inputRef={richInputRef}
                                    onStartAudio={startVoiceMessage}
                                    audioSupported={voiceRecorder.supported}
                                    audioPending={voiceRecorder.pending}
                                    // This surface reads no model catalog, so it does not claim
                                    // the agent can or cannot hear — the menu stays neutral.
                                    audioPerceivable={null}
                                    attachmentsFull={attachments.atMax}
                                    onDictationError={setDictationError}
                                    onDictatingChange={setDictating}
                                    stopRef={dictationStopRef}
                                    disabled={disabled}
                                />
                            }
                        />
                    </div>
                    <AnimatePresence initial={false}>
                        {voiceRecorder.takeoverVisible ? (
                            <motion.div
                                key="recording"
                                variants={presets.crossfade}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                className="pointer-events-none absolute inset-0 flex justify-center"
                            >
                                <RecordingBar
                                    recorder={voiceRecorder}
                                    willSend={voiceWillSend}
                                    className="h-full w-full"
                                />
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </div>
            </ContentRail>
        </div>
    )
}
