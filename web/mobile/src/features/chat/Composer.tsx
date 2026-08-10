import {useRef} from "react"

import {ChatComposer} from "@agenta/chat/components"
import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import type {FileUIPart} from "ai"

import {ContentRail} from "@/components/ContentRail"

/**
 * The mobile composer shell — the SAME `ChatComposer` the desktop dock renders (lazy rich
 * input, paperclip, attachments tray, queue-aware placeholder), pinned in the screen footer.
 * This wrapper owns only mobile chrome (the safe-area bar + content rail) and the send
 * transport: staged attachments upload to the sessions attachment store and ride the send as
 * reference file parts, exactly like desktop.
 */
export const Composer = ({
    sessionId,
    onSend,
    disabled = false,
    waitingOnUser = false,
    streaming = false,
    onStop,
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
}) => {
    const attachments = useComposerAttachments({sessionId})
    // Only so a failed send can put the message back — the editor clears itself on submit,
    // and nothing else would ever return the typed text.
    const inputRef = useRef<RichChatInputHandle | null>(null)

    const submit = async (text: string) => {
        const staged = attachments.files
        try {
            // `stagedFilesToParts` THROWS on a file whose upload hasn't settled — reachable via
            // Enter, which the send button's `sendDisabled` guard doesn't cover.
            const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
            await onSend({text, parts})
            attachments.clearAttachments(staged.map((file) => file.uid))
        } catch {
            // Nothing consumes this promise (RichChatInput's submit is fire-and-forget), so an
            // uncaught rejection would leave the user with no message, no error, and no idea a
            // send even failed. Keep the attachments staged, put the text back, and say so
            // through the composer's own inline channel — the same rejections strip the desktop
            // uses when a staged file can't ride the send.
            inputRef.current?.setMarkdown(text)
            attachments.setRejections([{name: "Message", reason: "wasn't sent — try again."}])
            attachments.setAttachmentsOpen(true)
        }
    }

    return (
        <div className="bg-background shrink-0 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <ContentRail>
                <ChatComposer
                    inputRef={inputRef}
                    onSubmit={submit}
                    attachments={attachments}
                    disabled={disabled}
                    waitingOnUser={waitingOnUser}
                    streaming={streaming}
                    onStop={onStop}
                />
            </ContentRail>
        </div>
    )
}
