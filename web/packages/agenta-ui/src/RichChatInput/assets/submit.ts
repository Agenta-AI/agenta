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

/** The three things Enter can do in the composer. */
export type EnterKeyAction = "send" | "newline" | "swallow"

/** Only what `enterKeyAction` reads, so the rule is decidable without a DOM event. */
export interface EnterKeyModifiers {
    shiftKey: boolean
    metaKey: boolean
    ctrlKey: boolean
}

/**
 * What Enter does, given the modifiers held and the keyboard it came from. A soft keyboard has no
 * practical Shift+Enter, so there the roles swap: Enter breaks the line and only the send button
 * sends. `disabled` blocks a send but never a newline — the draft stays writable while a run
 * streams.
 */
export function enterKeyAction(
    modifiers: EnterKeyModifiers,
    {softKeyboard, disabled}: {softKeyboard: boolean; disabled?: boolean},
): EnterKeyAction {
    if (modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey) return "newline"
    if (softKeyboard) return "newline"
    return disabled ? "swallow" : "send"
}
