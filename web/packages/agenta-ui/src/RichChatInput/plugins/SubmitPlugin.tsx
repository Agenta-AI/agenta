import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {COMMAND_PRIORITY_HIGH, INSERT_PARAGRAPH_COMMAND, KEY_ENTER_COMMAND} from "lexical"

import {hasCoarsePointer} from "../../hooks/useVisualViewport"
import {enterKeyAction, submitEditorAsMarkdown} from "../assets/submit"

interface SubmitPluginProps {
    onSubmit: (markdown: string) => void
    disabled?: boolean
}

/**
 * On a physical keyboard plain Enter always sends the message as markdown + clear — even inside a
 * list or code block — and Shift+Enter (or Cmd/Ctrl+Enter) is the newline. On a touch device the
 * two swap: a soft keyboard offers no practical Shift+Enter, so Enter breaks the line and the send
 * button sends. `enterKeyAction` holds that rule.
 *
 * A newline dispatches the native INSERT_PARAGRAPH_COMMAND so it stays fully context-aware — a new
 * list item in a list, an exit-to-paragraph from an empty list item, a new line in code, a new
 * paragraph in text — and the caret lands at a block start so markdown shortcuts fire on it.
 */
export function SubmitPlugin({onSubmit, disabled}: SubmitPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => {
                // Let the IME keep the Enter that confirms a composition candidate (CJK, etc.) —
                // intercepting it would break text entry for IME users.
                if (!event || !editor.isEditable() || event.isComposing) return false

                // Read the pointer per keystroke: a tablet gains and loses a hardware keyboard
                // without remounting the composer.
                const action = enterKeyAction(event, {
                    softKeyboard: hasCoarsePointer(),
                    disabled,
                })

                event.preventDefault()
                if (action === "newline") {
                    editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined)
                } else if (action === "send") {
                    submitEditorAsMarkdown(editor, onSubmit)
                }
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [disabled, editor, onSubmit])

    return null
}
