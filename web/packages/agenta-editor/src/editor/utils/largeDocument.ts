import type {LexicalEditor} from "lexical"

export const LARGE_RICH_TEXT_CHAR_THRESHOLD = 50_000
export const LARGE_RICH_TEXT_LINE_THRESHOLD = 1_200

export function isLargeRichTextDocument(text: string): boolean {
    if (!text) {
        return false
    }

    if (text.length >= LARGE_RICH_TEXT_CHAR_THRESHOLD) {
        return true
    }

    let lineCount = 1
    for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) !== 10) {
            continue
        }

        lineCount += 1
        if (lineCount >= LARGE_RICH_TEXT_LINE_THRESHOLD) {
            return true
        }
    }

    return false
}

export function setEditorLargeDocumentFlag(editor: LexicalEditor, isLargeDocument: boolean): void {
    const rootElement = editor.getRootElement()
    if (!rootElement) {
        return
    }

    rootElement.dataset.agentaLargeDoc = isLargeDocument ? "true" : "false"
}

export function isEditorLargeDocument(editor: LexicalEditor): boolean {
    return editor.getRootElement()?.dataset.agentaLargeDoc === "true"
}
