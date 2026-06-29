import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {COMMAND_PRIORITY_HIGH, INSERT_PARAGRAPH_COMMAND, KEY_ENTER_COMMAND} from "lexical"

import {submitEditorAsMarkdown} from "../assets/submit"

interface SubmitPluginProps {
    onSubmit: (markdown: string) => void
}

/**
 * Plain Enter always sends the message as markdown + clear — even inside a list or code
 * block. Shift+Enter (and Cmd/Ctrl+Enter) is the newline: it dispatches the native
 * INSERT_PARAGRAPH_COMMAND so it stays fully context-aware — a new list item in a list,
 * an exit-to-paragraph from an empty list item, a new line in code, a new paragraph in
 * text — and the caret lands at a block start so markdown shortcuts fire on it.
 */
export function SubmitPlugin({onSubmit}: SubmitPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => {
                // Let the IME keep the Enter that confirms a composition candidate (CJK, etc.) —
                // intercepting it would break text entry for IME users.
                if (!event || !editor.isEditable() || event.isComposing) return false

                // Shift+Enter / Cmd/Ctrl+Enter → native paragraph insert (list-item, exit,
                // code line, or paragraph depending on context).
                if (event.shiftKey || event.metaKey || event.ctrlKey) {
                    event.preventDefault()
                    editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined)
                    return true
                }

                // Plain Enter → always send.
                event.preventDefault()
                submitEditorAsMarkdown(editor, onSubmit)
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor, onSubmit])

    return null
}
