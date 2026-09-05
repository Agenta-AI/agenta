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
