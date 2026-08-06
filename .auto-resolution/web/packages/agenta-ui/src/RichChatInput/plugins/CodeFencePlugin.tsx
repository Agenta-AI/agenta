import {useEffect} from "react"

import {$createCodeNode} from "@lexical/code"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isParagraphNode,
    $isRangeSelection,
    COMMAND_PRIORITY_CRITICAL,
    KEY_ENTER_COMMAND,
} from "lexical"

// A whole line that is just a fence opener: ``` optionally followed by a bare language token.
const FENCE_OPENER = /^`{3,}[a-z0-9+#-]*$/i

/**
 * Basic code-block support for the chat composer. Pressing Enter on a line that is a lone ``` fence
 * opener turns it into a (plain, no-highlight) code block. Needed because plain Enter is Send and
 * ⌘/Shift+Enter is a newline (both handled by SubmitPlugin), so the markdown CODE transformer's own
 * Enter trigger never fires here. Runs at CRITICAL priority so it wins over SubmitPlugin; anything
 * that isn't a fence opener falls through to the normal send/newline behaviour. (The ``` + space
 * markdown shortcut keeps working too.)
 */
export function CodeFencePlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => {
                if (!editor.isEditable() || (event && event.isComposing)) return false
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
                const block = selection.anchor.getNode().getTopLevelElement()
                if (!$isParagraphNode(block) || !FENCE_OPENER.test(block.getTextContent().trim())) {
                    return false
                }
                event?.preventDefault()
                const codeNode = $createCodeNode()
                block.replace(codeNode)
                codeNode.selectStart()
                return true
            },
            COMMAND_PRIORITY_CRITICAL,
        )
    }, [editor])

    return null
}
