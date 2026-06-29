import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND} from "lexical"

import {submitEditorAsMarkdown} from "../assets/submit"

interface SubmitPluginProps {
    onSubmit: (markdown: string) => void
}

/**
 * Plain Enter always sends the message as markdown + clear — even inside a list or code
 * block. Shift+Enter (and Cmd/Ctrl+Enter) is the newline: it splits the current block via
 * insertParagraph, which is context-aware — a new list item inside a list, a new line in
 * code, a new paragraph in plain text — and lands the caret at a block start so block
 * markdown shortcuts ("- ", "1. ", "> ", "```") fire on it.
 */
export function SubmitPlugin({onSubmit}: SubmitPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => {
                if (!event || !editor.isEditable()) return false

                // Shift+Enter / Cmd/Ctrl+Enter → newline (context-aware block split).
                if (event.shiftKey || event.metaKey || event.ctrlKey) {
                    event.preventDefault()
                    editor.update(() => {
                        const selection = $getSelection()
                        if ($isRangeSelection(selection)) selection.insertParagraph()
                    })
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
