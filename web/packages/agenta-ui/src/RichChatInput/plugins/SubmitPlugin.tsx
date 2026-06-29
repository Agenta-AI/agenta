import {useEffect} from "react"

import {$isCodeNode} from "@lexical/code"
import {$isListItemNode} from "@lexical/list"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$findMatchingParent} from "@lexical/utils"
import {
    $getSelection,
    $isRangeSelection,
    COMMAND_PRIORITY_HIGH,
    INSERT_LINE_BREAK_COMMAND,
    KEY_ENTER_COMMAND,
} from "lexical"

import {submitEditorAsMarkdown} from "../assets/submit"

interface SubmitPluginProps {
    onSubmit: (markdown: string) => void
}

/**
 * Enter-to-send with newline escape hatches:
 *  - Shift+Enter or Cmd/Ctrl+Enter → insert a newline (never send).
 *  - Plain Enter inside a list item or code block → continue the structure.
 *  - Plain Enter elsewhere → submit as markdown + clear.
 */
export function SubmitPlugin({onSubmit}: SubmitPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => {
                if (!event || !editor.isEditable()) return false

                // Shift+Enter → native line break (let rich-text handle it).
                if (event.shiftKey) return false

                // Cmd/Ctrl+Enter → explicit line break (rich-text wouldn't otherwise).
                if (event.metaKey || event.ctrlKey) {
                    event.preventDefault()
                    editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false)
                    return true
                }

                // Plain Enter inside a list/code block continues the structure.
                let inStructure = false
                editor.getEditorState().read(() => {
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return
                    const node = selection.anchor.getNode()
                    inStructure = Boolean(
                        $findMatchingParent(node, (n) => $isListItemNode(n) || $isCodeNode(n)) ||
                        $isListItemNode(node) ||
                        $isCodeNode(node),
                    )
                })
                if (inStructure) return false

                event.preventDefault()
                submitEditorAsMarkdown(editor, onSubmit)
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor, onSubmit])

    return null
}
