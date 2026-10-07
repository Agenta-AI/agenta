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

/** A host returns `false` (synchronously) to refuse a send, which leaves the text in the editor. */
export type SubmitHandler = (markdown: string) => void | boolean | Promise<void | boolean>

/**
 * Serialize the editor to markdown, hand it to `onSubmit`, then reset to an empty
 * paragraph unless the host refused it. A blank message (see `$isBlankMessage`) goes out as ""
 * only when `forceEnabled` says something else carries it (staged attachments or quotes);
 * otherwise it no-ops and returns false. Shared by plain Enter and the send button so both
 * behave identically.
 */
export function submitEditorAsMarkdown(
    editor: LexicalEditor,
    onSubmit: SubmitHandler,
    forceEnabled = false,
): boolean {
    let markdown = ""
    editor.getEditorState().read(() => {
        markdown = $convertToMarkdownString(CHAT_TRANSFORMERS)
    })
    const trimmed = markdown.trim()
    if (!trimmed && !forceEnabled) return false

    if (onSubmit(trimmed) === false) return false
    editor.update(() => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode())
    })
    return true
}
