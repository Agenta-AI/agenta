import {useRef, type MutableRefObject} from "react"

import {
    ChatComposer,
    MicPermissionNotice,
    RecordingBar,
    VoiceInputButton,
} from "@agenta/chat/components"
import {stagedFilesToParts, useComposerAttachments, useVoiceComposer} from "@agenta/chat/hooks"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
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
    sessionId,
    onSend,
    disabled = false,
    waitingOnUser = false,
    streaming = false,
    onStop,
    inputRef,
}: {
    sessionId: string
    onSend: (input: {text: string; parts?: FileUIPart[]}) => void | Promise<void>
    /** No resolvable agent yet, or the screen is still hydrating. */
    disabled?: boolean
    /** The run is parked on the user (pending approval) — sends will queue. */
    waitingOnUser?: boolean
    /** A run is streaming from this device — the send button becomes Stop. */
    streaming?: boolean
    onStop?: () => void
    /** Lets the host write into the input — a rewind puts the rewound message back to edit. */
    inputRef?: MutableRefObject<RichChatInputHandle | null>
}) => {
    const attachments = useComposerAttachments({sessionId})
    const ownInputRef = useRef<RichChatInputHandle | null>(null)
    const richInputRef = inputRef ?? ownInputRef
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
            attachments.clearAttachments(staged.map((file) => file.uid))
        } catch {
            // Nothing consumes this promise (RichChatInput's submit is fire-and-forget), so an
            // uncaught rejection would leave the user with no message, no error, and no idea a
            // send even failed. Keep the attachments staged, put the text back, and say so
            // through the composer's own inline channel.
            richInputRef.current?.setMarkdown(text)
            attachments.setRejections([{name: "Message", reason: "wasn't sent — try again."}])
            attachments.setAttachmentsOpen(true)
        }
    }

    const voice = useVoiceComposer({
        richInputRef,
        stagedCount: attachments.files.length,
        onAttach: (file) => attachments.addFiles([file]),
        onSendVoiceMessage: (file) => void submit("", [file]),
    })
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

    // A drop or paste landing mid-take could take the tray slot the recording needs, and an
    // unusable composer is a dead end for a file.
    const attachmentsBlocked = () => voiceRecorder.active || disabled

    return (
        <div className="bg-background shrink-0 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <ContentRail>
                {voiceEnabled ? (
                    <MicPermissionNotice
                        open={!!micError && !voiceRecorder.active}
                        message={micError}
                        onDismiss={dismissMicError}
                    />
                ) : null}
                <div className="relative">
                    <ChatComposer
                        inputRef={richInputRef}
                        onSubmit={submit}
                        attachments={attachments}
                        attachmentsBlocked={attachmentsBlocked}
                        disabled={disabled}
                        composerDisabled={disabled}
                        dictating={voiceEnabled && dictating}
                        waitingOnUser={waitingOnUser}
                        streaming={streaming}
                        onStop={onStop}
                        extraPrefix={
                            voiceEnabled ? (
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
                                    disabled={disabled}
                                />
                            ) : null
                        }
                    />
                    <AnimatePresence initial={false}>
                        {voiceEnabled && voiceRecorder.takeoverVisible ? (
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
