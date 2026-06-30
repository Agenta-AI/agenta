import {$convertToMarkdownString} from "@lexical/markdown"
import {$createParagraphNode, $getRoot, type LexicalEditor} from "lexical"

import {CHAT_TRANSFORMERS} from "./transformers"

/**
 * The single definition of a "blank" message: the editor serializes to empty/whitespace-only
 * markdown. The send button (enable/disable), plain-Enter, and the submit path all consult this
 * so a draft that looks sendable always is. Must run inside an editor read (it's a `$` reader).
 */
export function $isBlankMessage(): boolean {
    return $convertToMarkdownString(CHAT_TRANSFORMERS).trim().length === 0
}

/**
 * Serialize the editor to markdown, hand it to `onSubmit`, then reset to an empty
 * paragraph. No-ops (returns false) when the message is blank (see `$isBlankMessage`).
 * Shared by plain Enter and the send button so both behave identically.
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
