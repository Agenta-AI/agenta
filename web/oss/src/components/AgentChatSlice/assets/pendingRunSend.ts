import {restoreRefusedDraft} from "@agenta/chat/assets"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

/**
 * Send one run-this-turn request (a trigger's Run in playground, Save as template) and settle it.
 *
 * The request is settled whether the send is admitted or refused: its nonce is already spent, so
 * nothing re-sends it, and a request left pending keeps its producer disabled with no way to retry.
 * On a refusal the text goes back only into an empty composer, because this run never came from
 * it and a draft the user is typing there wins. The "wasn't sent" row reports the refusal either way.
 */
export async function sendPendingRun({
    text,
    submit,
    editor,
    reportRefusal,
    settle,
}: {
    text: string
    submit: (input: {text: string}) => unknown
    editor: RichChatInputHandle | null
    reportRefusal: (error: unknown) => void
    settle: () => void
}): Promise<void> {
    try {
        await submit({text})
    } catch (error: unknown) {
        void restoreRefusedDraft(editor, text)
        reportRefusal(error)
    }
    settle()
}
