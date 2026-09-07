import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

export const canRestoreRefusedSend = (editor: RichChatInputHandle | null): boolean =>
    Boolean(editor && editor.getMarkdown() === "")

export const restoreRefusedDraft = (editor: RichChatInputHandle | null, text: string): boolean => {
    if (!editor || !text || !canRestoreRefusedSend(editor)) return false
    editor.setMarkdown(text)
    return true
}

interface RefusedSend<TAttachment> {
    text: string
    stagedFiles?: TAttachment[]
}

interface RefusedSendSlot<TAttachment> {
    current: RefusedSend<TAttachment> | undefined
}

export const restoreRefusedSend = <TAttachment>(
    editor: RichChatInputHandle | null,
    sent: RefusedSend<TAttachment>,
    restoreAttachments: (files: TAttachment[]) => void,
): boolean => {
    if (!canRestoreRefusedSend(editor)) return false
    if (sent.text && !restoreRefusedDraft(editor, sent.text)) return false
    if (sent.stagedFiles?.length) restoreAttachments(sent.stagedFiles)
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
