import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

export const canRestoreRefusedSend = (editor: RichChatInputHandle | null): boolean =>
    Boolean(editor && editor.getMarkdown() === "")

/**
 * Turns of the microtask queue an editor that does not acknowledge its writes gets to commit the
 * text before we call it a failure. The real editor resolves `setMarkdown` once the write is
 * committed, so this only covers a handle that returns nothing (a test stub, an older adapter).
 */
const PLACEMENT_CONFIRM_TICKS = 12

/**
 * Write the text and wait for the composer to actually hold it.
 *
 * "The composer took it" is the editor's own acknowledgement — `setMarkdown` resolves once Lexical
 * has committed the write — and then ONE read-back. Inferring it from a synchronous read is how a
 * refused message ended up in the transcript AND the composer at the same time: the read answered
 * "no" for a placement that was on its way, the caller kept the flagged row, and the text arrived
 * a moment later, so the user could send it twice (staging, `66ed5a6c57`, then #6697). Reporting
 * success without reading back at all is the opposite failure and loses the message.
 */
export const restoreRefusedDraft = async (
    editor: RichChatInputHandle | null,
    text: string,
): Promise<boolean> => {
    if (!editor || !text || !canRestoreRefusedSend(editor)) return false
    await editor.setMarkdown(text)
    for (let tick = 0; tick < PLACEMENT_CONFIRM_TICKS; tick += 1) {
        if (editor.getMarkdown() === text) return true
        await Promise.resolve()
    }
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
 * Put a refused send back in the composer, and report whether the composer took it.
 *
 * The caller drops the echo row on a true, so a false success deletes the only copy of the
 * message. Two cases therefore return false rather than claim a restore:
 *
 * - The send carried attachments the tray cannot take back, because it has no staged entry for
 *   them. Restoring the words alone would delete the files.
 * - There is nothing to restore at all: a file-only send whose staged entries are gone would
 *   otherwise report success while putting nothing anywhere.
 *
 * The first only applies to a caller that HAS somewhere else to put the message. `partial` says
 * this caller does not: its echo row is already gone, so placing the words is better than placing
 * nothing, and refusing would leave the message in no visible place at all.
 */
export const restoreRefusedSend = async <TAttachment>(
    editor: RichChatInputHandle | null,
    sent: RefusedSend<TAttachment>,
    restoreAttachments: (files: TAttachment[]) => void,
    {partial = false}: {partial?: boolean} = {},
): Promise<boolean> => {
    if (!canRestoreRefusedSend(editor)) return false
    const staged = sent.stagedFiles ?? []
    // Absent `fileParts` means the caller does not track them separately, so the staged entries are
    // the whole of what the send carried.
    const carried = sent.fileParts?.length ?? staged.length
    if (!partial && carried > staged.length) return false
    if (!sent.text && staged.length === 0) return false
    if (sent.text && !(await restoreRefusedDraft(editor, sent.text))) return false
    if (staged.length) restoreAttachments(staged)
    return true
}

/**
 * The early-rejection path: the send promise rejected, which already dropped the echo row, so the
 * composer is the ONLY place this message can be. Hence `partial` — there is no row to leave it
 * on, and a refusal here would leave it nowhere.
 */
export const restoreHeldRefusedSend = async <TAttachment>(
    slot: RefusedSendSlot<TAttachment>,
    editor: RichChatInputHandle | null,
    restoreAttachments: (files: TAttachment[]) => void,
): Promise<boolean> => {
    const sent = slot.current
    if (!sent) return false
    // Cleared before the await, so a second caller arriving while the composer commits does not
    // place the same message twice. It goes back if the composer turns out not to have taken it.
    slot.current = undefined
    if (await restoreRefusedSend(editor, sent, restoreAttachments, {partial: true})) return true
    slot.current = sent
    return false
}
