import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {mergeRegister} from "@lexical/utils"
import {BLUR_COMMAND, COMMAND_PRIORITY_LOW, FOCUS_COMMAND} from "lexical"

interface FocusStatePluginProps {
    onFocusChange: (focused: boolean) => void
}

/** Reports the editor's focus state so the composer can reveal focus-only chrome (shortcut hints). */
export function FocusStatePlugin({onFocusChange}: FocusStatePluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        // Seed from current DOM focus so an autoFocus that fired before this registered isn't missed.
        const root = editor.getRootElement()
        if (root && root.ownerDocument.activeElement === root) onFocusChange(true)

        return mergeRegister(
            editor.registerCommand(
                FOCUS_COMMAND,
                () => {
                    onFocusChange(true)
                    return false
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand(
                BLUR_COMMAND,
                () => {
                    onFocusChange(false)
                    return false
                },
                COMMAND_PRIORITY_LOW,
            ),
        )
    }, [editor, onFocusChange])

    return null
}
