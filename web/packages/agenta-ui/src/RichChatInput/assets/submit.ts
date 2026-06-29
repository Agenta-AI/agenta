import {$convertToMarkdownString} from "@lexical/markdown"
import {$createParagraphNode, $getRoot, type LexicalEditor} from "lexical"

import {CHAT_TRANSFORMERS} from "./transformers"

/**
 * Serialize the editor to markdown, hand it to `onSubmit`, then reset to an empty
 * paragraph. No-ops (returns false) when the message is blank. Shared by the
 * Cmd/Ctrl+Enter command and the send button so both behave identically.
 */
export function submitEditorAsMarkdown(
    editor: LexicalEditor,
    onSubmit: (markdown: string) => void,
): boolean {
    let markdown = ""
    editor.getEditorState().read(() => {
        markdown = $convertToMarkdownString(CHAT_TRANSFORMERS)
    })
    const trimmed = markdown.trim()
    if (!trimmed) return false

    onSubmit(trimmed)
    editor.update(() => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode())
    })
    return true
}
