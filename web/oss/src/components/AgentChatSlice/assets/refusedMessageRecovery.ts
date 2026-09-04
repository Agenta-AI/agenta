import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

export const canRestoreRefusedSend = (editor: RichChatInputHandle | null): boolean =>
    Boolean(editor && editor.getMarkdown() === "")

export const restoreRefusedDraft = (editor: RichChatInputHandle | null, text: string): boolean => {
    if (!editor || !text || !canRestoreRefusedSend(editor)) return false
    editor.setMarkdown(text)
    return true
}
