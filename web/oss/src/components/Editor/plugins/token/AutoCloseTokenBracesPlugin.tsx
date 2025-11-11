import {useEffect} from "react"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isRangeSelection,
    KEY_DOWN_COMMAND,
    KEY_BACKSPACE_COMMAND,
    COMMAND_PRIORITY_NORMAL,
    TextNode,
    ElementNode,
    $createTextNode,
    $isElementNode,
} from "lexical"
import {$isTokenNode} from "./TokenNode"
import {$isTokenInputNode} from "./TokenInputNode"
import {navigateCursor} from "./assets/selectionUtils"

/**
 * Plugin that auto inserts and removes curly brace pairs.
 *
 * - Typing `{` inserts `{}` and positions the cursor inside.
 * - Typing `{` again inside an existing pair results in `{{}}`.
 * - Pressing backspace when the cursor sits between `{` and `}`
 *   removes the pair in a single action.
 */
export function AutoCloseTokenBracesPlugin(): null {
    const [editor] = useLexicalComposerContext()

    // Handle auto creating token pairs
    useEffect(() => {
        return editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event: KeyboardEvent) => {
                if (event.key !== "{") return false

                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

                const anchor = selection.anchor
                const node = anchor.getNode()

                // Handle case when editor is empty or at start of text node
                if (!(node instanceof TextNode)) {
                    if ($isElementNode(node)) {
                        event.preventDefault()

                        const newTextNode = $createTextNode("{}")
                        node.append(newTextNode)

                        navigateCursor({nodeKey: newTextNode.getKey(), offset: 1})
                        return true
                    }
                    return false
                }

                const offset = anchor.offset
                const text = node.getTextContent()

                event.preventDefault()
                const newText = text.slice(0, offset) + "{}" + text.slice(offset)
                node.setTextContent(newText)

                navigateCursor({nodeKey: node.getKey(), offset: offset + 1})
                return true
            },
            COMMAND_PRIORITY_NORMAL,
        )
    }, [editor])

    // Handle auto removing token pairs when click backspace
    useEffect(() => {
        return editor.registerCommand(
            KEY_BACKSPACE_COMMAND,
            (event: KeyboardEvent) => {
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

                const anchor = selection.anchor
                const node = anchor.getNode()
                if (!(node instanceof TextNode)) return false

                const offset = anchor.offset
                const text = node.getTextContent()
                if (offset === 0) return false

                const charBefore = text[offset - 1]
                const charAfter = text[offset]
                if (charBefore === "{" && charAfter === "}") {
                    event.preventDefault()
                    const newText = text.slice(0, offset - 1) + text.slice(offset + 1)
                    node.setTextContent(newText)

                    navigateCursor({nodeKey: node.getKey(), offset: offset - 1})
                    return true
                }

                return false
            },
            COMMAND_PRIORITY_NORMAL,
        )
    }, [editor])

    // Handle auto moving cursor to the end of token when arrow right/left is pressed
    useEffect(() => {
        return editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event: KeyboardEvent) => {
                // Only handle arrow keys
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "}")
                    return false
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

                const node = selection.anchor.getNode()
                const isInsideToken = $isTokenNode(node) || $isTokenInputNode(node)

                if (isInsideToken) {
                    const text = node.getTextContent()
                    const cursorPosition = selection.anchor.offset

                    // Handle right arrow at the end of token
                    if (event.key === "ArrowRight" && cursorPosition >= text.length - 2) {
                        event.preventDefault()

                        // Move cursor to after the token
                        const nextSibling = node.getNextSibling()
                        if (nextSibling) {
                            const nextText = nextSibling.getTextContent()

                            navigateCursor({nodeKey: nextSibling.getKey(), offset: 1})
                        } else {
                            // If no next sibling, create a text node and move cursor there
                            const newTextNode = $createTextNode("")
                            node.insertAfter(newTextNode)

                            navigateCursor({nodeKey: newTextNode.getKey(), offset: 0})
                        }
                        return true
                    }

                    // Handle left arrow at the start of token
                    if (event.key === "ArrowLeft" && cursorPosition <= 2) {
                        event.preventDefault()

                        // Move cursor to before the token
                        const prevSibling = node.getPreviousSibling()
                        if (prevSibling) {
                            const prevText = prevSibling.getTextContent()
                            navigateCursor({nodeKey: prevSibling.getKey(), offset: prevText.length})
                        } else {
                            // If no previous sibling, create a text node and move cursor there
                            const newTextNode = $createTextNode("")
                            node.insertBefore(newTextNode)

                            navigateCursor({nodeKey: newTextNode.getKey(), offset: 0})
                        }
                        return true
                    }

                    // Handle '}' key press inside token
                    if (event.key === "}" && $isTokenNode(node)) {
                        event.preventDefault()

                        let text = node.getTextContent()
                        const cursorPos = selection.anchor.offset

                        // Check if we need to add a new closing brace
                        if (cursorPos === text.length) {
                            // At the end of the token, add a new '}'
                            node.setTextContent(text + "}")
                            navigateCursor({
                                nodeKey: node.getKey(),
                                offset: cursorPos + 1,
                            })
                        } else {
                            const nextBracePos = text.indexOf("}", cursorPos)

                            if (nextBracePos !== -1) {
                                navigateCursor({
                                    nodeKey: node.getKey(),
                                    offset: nextBracePos + 1,
                                })
                            } else {
                                navigateCursor({
                                    nodeKey: node.getKey(),
                                    offset: text.length,
                                })
                            }
                        }

                        return true
                    }
                }
                return false
            },
            COMMAND_PRIORITY_NORMAL,
        )
    }, [editor])

    return null
}
