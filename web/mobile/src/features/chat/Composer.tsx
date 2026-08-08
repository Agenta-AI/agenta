import {ChatComposer} from "@agenta/chat/components"
import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
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

    const submit = async (text: string) => {
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        await onSend({text, parts})
        attachments.clearAttachments(staged.map((file) => file.uid))
    }

    return (
        <div className="bg-background shrink-0 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <ContentRail>
                <ChatComposer
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
