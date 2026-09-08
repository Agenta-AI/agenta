import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

export const canRestoreRefusedSend = (editor: RichChatInputHandle | null): boolean =>
    Boolean(editor && editor.getMarkdown() === "")

export const restoreRefusedDraft = (editor: RichChatInputHandle | null, text: string): boolean => {
    if (!editor || !text || !canRestoreRefusedSend(editor)) return false
    editor.setMarkdown(text)
    // `setMarkdown` returns void and does nothing at all when the handle's internal ref is gone,
    // so the only way to know it took the text is to read it back. Reporting success falsely tells
    // the caller the message is safe in the composer when it is nowhere.
    return editor.getMarkdown() === text
}

interface RefusedSend<TAttachment> {
    text: string
    /** The composer entries the send consumed. These are what `restoreAttachments` can put back. */
    stagedFiles?: TAttachment[]
    /**
     * The attachments the send actually carried. A send can carry file parts with no staged entry
     * behind them (a merged queue edit, a first-run seed handed over from another surface), and
     * those cannot be put back in the tray at all.
     */
    fileParts?: readonly unknown[]
}

interface RefusedSendSlot<TAttachment> {
    current: RefusedSend<TAttachment> | undefined
}

/**
 * Put a refused send back in the composer, and report whether the composer really took ALL of it.
 *
 * The caller drops the echo row on a true, so a false success deletes the only copy of the
 * message. Two cases return false rather than claim a restore:
 *
 * - The send carried attachments the tray cannot take back, because it has no staged entry for
 *   them. Restoring the words alone would delete the files.
 * - There is nothing to restore at all: a file-only send whose staged entries are gone would
 *   otherwise report success while putting nothing anywhere.
 *
 * In both, the flagged row stays as the recovery surface, and it keeps the attachment cards.
 */
export const restoreRefusedSend = <TAttachment>(
    editor: RichChatInputHandle | null,
    sent: RefusedSend<TAttachment>,
    restoreAttachments: (files: TAttachment[]) => void,
): boolean => {
    if (!canRestoreRefusedSend(editor)) return false
    const staged = sent.stagedFiles ?? []
    // Absent `fileParts` means the caller does not track them separately, so the staged entries are
    // the whole of what the send carried.
    const carried = sent.fileParts?.length ?? staged.length
    if (carried > staged.length) return false
    if (!sent.text && staged.length === 0) return false
    if (sent.text && !restoreRefusedDraft(editor, sent.text)) return false
    if (staged.length) restoreAttachments(staged)
    return true
}

export const restoreHeldRefusedSend = <TAttachment>(
    slot: RefusedSendSlot<TAttachment>,
    editor: RichChatInputHandle | null,
    restoreAttachments: (files: TAttachment[]) => void,
): boolean => {
    const sent = slot.current
    if (!sent) return false
    slot.current = undefined
    if (restoreRefusedSend(editor, sent, restoreAttachments)) return true
    slot.current = sent
    return false
}
