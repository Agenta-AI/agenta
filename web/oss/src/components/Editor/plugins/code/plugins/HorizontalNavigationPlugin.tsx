/**
 * HorizontalNavigationPlugin.tsx
 *
 * This plugin improves horizontal navigation in code blocks by handling:
 * 1. Skipping zero-width characters when navigating with arrow keys
 * 2. Properly handling tab nodes and other decorator nodes
 * 3. Ensuring smooth navigation between adjacent nodes
 */
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isRangeSelection,
    $createRangeSelection,
    $setSelection,
    COMMAND_PRIORITY_CRITICAL,
    KEY_ARROW_LEFT_COMMAND,
    KEY_ARROW_RIGHT_COMMAND,
    LexicalNode,
    $isTabNode,
} from "lexical"

import {$isCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

const PLUGIN_NAME = "HorizontalNavigationPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: true})

/**
 * Finds the next valid position for cursor placement
 * Skips zero-width characters and handles special nodes
 */
function $findNextValidPosition(
    node: LexicalNode,
    offset: number,
    direction: "left" | "right",
): {node: LexicalNode; offset: number} | null {
    // If we're at a tab node, handle it specially
    if ($isTabNode(node)) {
        log("Tab node detected", {nodeKey: node.getKey(), direction, offset})

        const sel = $getSelection()
        if (!$isRangeSelection(sel)) return null
        sel.modify("move", direction === "left", "character")
        const newSel = $getSelection()

        return {
            node: newSel?.anchor?.getNode() || node,
            offset: newSel?.anchor?.offset || offset,
        }

        // if (direction === "right") {
        //     // Moving right from a tab node, ALWAYS go to next node
        //     // regardless of current offset within the tab
        //     const sel = $getSelection()
        //     if (!$isRangeSelection(sel)) return null
        //     sel.modify("move", direction === "left", "character")
        //     const newSel = $getSelection()
        //     log("Right to the tab node", {
        //         nodeKey: newSel.anchor.getNode(),
        //         direction,
        //         offset: newSel.anchor.offset,
        //     })
        //     return {
        //         node: newSel?.anchor?.getNode() || node,
        //         offset: newSel?.anchor?.offset || offset,
        //     }
        //     // const nextSibling = node.getNextSibling()
        //     // if (nextSibling) {
        //     //     return {node: nextSibling, offset: 0}
        //     // }
        // } else if (direction === "left") {
        //     // If we're already at the beginning of the tab, go to previous node
        //     if (offset === 0) {
        //         const prevSibling = node.getPreviousSibling()
        //         if (prevSibling) {
        //             return {node: prevSibling, offset: prevSibling.getTextContentSize()}
        //         }
        //     } else {
        //         // If we're in the middle of the tab, go to the beginning
        //         return {node, offset: 0}
        //     }
        // }

        // If at tab node, just stay where we are - tab is a valid position
        return {node, offset}
    }

    // Handle CodeHighlightNode with zero-width space or empty content
    if ($isCodeHighlightNode(node)) {
        const text = node.getTextContent()
        const char = text[offset]
        if (!char) {
            const sel = $getSelection()
            if (!$isRangeSelection(sel)) return null
            sel.modify("move", direction === "left", "character")
            const newSel = $getSelection()
            const target = newSel?.anchor?.getNode()
            const _char = target?.getTextContent()[newSel?.anchor?.offset || 0]
            const targetText = target.getTextContent()

            const textBefore = target?.getTextContent().slice(0, offset)

            if (textBefore === "\u200B" && !char) {
                return $findNextValidPosition(target, newSel?.anchor?.offset, direction)
            }

            if (newSel) {
                return {
                    node: newSel.anchor.getNode(),
                    offset: newSel.anchor.offset,
                }
            }
        } else if (char === "\u200B") {
            const sel = $getSelection()
            if (!$isRangeSelection(sel)) return null
            sel.modify("move", direction === "left", "character")
            const newSel = $getSelection()
            const target = newSel?.anchor?.getNode()
            const _char = target?.getTextContent()[newSel?.anchor?.offset || 0]
            if (_char === "\u200B") {
                return $findNextValidPosition(node, 0, direction)
            }
            if (!newSel) {
                const nextSibling = node.getNextSibling()
                if (nextSibling) {
                    return $findNextValidPosition(node, 0, direction)
                }
            }
            return $findNextValidPosition(
                newSel?.anchor?.getNode(),
                newSel?.anchor?.offset,
                direction,
            )
        }

        return {node: node, offset: offset + (direction === "left" ? -1 : 1)}
        // Handle empty nodes or nodes with zero-width space
        // if (text === "" || text.includes("\u200B")) {
        //     log("Zero-width space detected", {
        //         nodeKey: node.getKey(),
        //         text,
        //         offset,
        //         direction,
        //     })

        //     // Handle empty nodes or nodes with only zero-width space
        //     if (text === "" || text === "\u200B") {
        //         // If the node only contains a zero-width space
        //         if (direction === "right") {
        //             // Try to find next sibling
        //             const nextSibling = node.getNextSibling()
        //             if (nextSibling) {
        //                 return {node: nextSibling, offset: 0}
        //             }

        //             // If no next sibling, try to find next line
        //             const parentLine = node.getParent()
        //             if ($isCodeLineNode(parentLine)) {
        //                 const nextLine = parentLine.getNextSibling()
        //                 if (nextLine) {
        //                     const firstChild = nextLine.getFirstChild()
        //                     if (firstChild) {
        //                         return {node: firstChild, offset: 0}
        //                     }
        //                 }
        //             }
        //         } else if (direction === "left") {
        //             // Try to find previous sibling
        //             const prevSibling = node.getPreviousSibling()
        //             if (prevSibling) {
        //                 // If previous sibling is a tab node, move to it
        //                 return {node: prevSibling, offset: prevSibling.getTextContentSize()}
        //             }

        //             // If no previous sibling, try to find previous line
        //             const parentLine = node.getParent()
        //             if ($isCodeLineNode(parentLine)) {
        //                 const prevLine = parentLine.getPreviousSibling()
        //                 if (prevLine) {
        //                     // Get the last child of the previous line
        //                     const children = prevLine.getChildren()
        //                     if (children.length > 0) {
        //                         const lastChild = children[children.length - 1]
        //                         return {node: lastChild, offset: lastChild.getTextContentSize()}
        //                     }
        //                 }
        //             }
        //         }
        //     } else {
        //         // Node contains zero-width space and other content
        //         // Find positions of zero-width spaces
        //         const zeroWidthPositions: number[] = []
        //         for (let i = 0; i < text.length; i++) {
        //             if (text[i] === "\u200B") {
        //                 zeroWidthPositions.push(i)
        //             }
        //         }

        //         if (direction === "right") {
        //             // Find the next non-zero-width position
        //             for (let i = offset; i < text.length; i++) {
        //                 if (!zeroWidthPositions.includes(i) && i > offset) {
        //                     return {node, offset: i}
        //                 }
        //             }

        //             // If we're at the end, try next node
        //             const nextSibling = node.getNextSibling()
        //             if (nextSibling) {
        //                 return {node: nextSibling, offset: 0}
        //             }
        //         } else if (direction === "left") {
        //             // Find the previous non-zero-width position
        //             for (let i = offset - 1; i >= 0; i--) {
        //                 if (!zeroWidthPositions.includes(i)) {
        //                     return {node, offset: i}
        //                 }
        //             }

        //             // If we're at the beginning, try previous node
        //             const prevSibling = node.getPreviousSibling()
        //             if (prevSibling) {
        //                 // If previous sibling is a tab node, move to it with offset 0
        //                 if ($isTabNode(prevSibling)) {
        //                     log("Moving to tab node", {
        //                         from: node.getKey(),
        //                         to: prevSibling.getKey(),
        //                     })
        //                     return {node: prevSibling, offset: 0}
        //                 }
        //                 return {node: prevSibling, offset: prevSibling.getTextContentSize()}
        //             }
        //         }
        //     }
        // }
    }

    // If we didn't find a better position, return null to let default behavior happen
    return null
}

/**
 * Plugin that improves horizontal navigation in code blocks
 */
export function HorizontalNavigationPlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        // Handle left arrow key
        const removeLeftHandler = editor.registerCommand(
            KEY_ARROW_LEFT_COMMAND,
            (event) => {
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                    return false
                }

                const anchorNode = selection.anchor.getNode()
                const offset = selection.anchor.offset

                const fixSelection = (targetNode, targetOffset) => {
                    const targetContent = targetNode.getTextContent()[targetOffset]

                    if (targetContent === "\u200B") {
                        const nextCharInNode = targetNode.getTextContent()[targetOffset - 1]
                        if (nextCharInNode && nextCharInNode !== "\u200B") {
                            targetOffset -= 1
                        } else {
                            const nextNode = targetNode.getPreviousSibling()
                            if (nextNode) {
                                targetNode = nextNode
                                targetOffset = nextNode.getTextContentSize()
                            } else {
                                const lineNode = anchorNode
                                    .getParents()
                                    .find($isCodeLineNode) as CodeLineNode
                                const nextLineNode = lineNode?.getPreviousSibling() as CodeLineNode
                                if (nextLineNode) {
                                    const firstChild = nextLineNode.getLastChild()
                                    if (firstChild) {
                                        targetNode = firstChild
                                        targetOffset = firstChild.getTextContentSize()
                                    }
                                    return fixSelection(firstChild, 0)
                                }
                            }
                        }
                    }

                    return {targetNode, targetOffset}
                }

                log("Left arrow pressed", {
                    nodeKey: anchorNode.getKey(),
                    nodeType: anchorNode.getType(),
                    offset,
                    text: anchorNode.getTextContent(),
                })

                // Check if we're at the beginning of a line and need to move to the previous line
                if (offset === 0 && !anchorNode.getPreviousSibling()) {
                    log("Left arrow pressed 1")
                    const parentLine = anchorNode.getParent()
                    if ($isCodeLineNode(parentLine)) {
                        const prevLine = parentLine.getPreviousSibling()
                        if (prevLine) {
                            const children = prevLine.getChildren()
                            if (children.length > 0) {
                                const lastChild = children[children.length - 1]
                                event.preventDefault()

                                const newSelection = $createRangeSelection()
                                newSelection.anchor.set(
                                    lastChild.getKey(),
                                    lastChild.getTextContentSize(),
                                    "text",
                                )
                                newSelection.focus.set(
                                    lastChild.getKey(),
                                    lastChild.getTextContentSize(),
                                    "text",
                                )
                                $setSelection(newSelection)

                                log("Moving to end of previous line", {
                                    fromLine: parentLine.getKey(),
                                    toLine: prevLine.getKey(),
                                    toNode: lastChild.getKey(),
                                })

                                return true
                            }
                        }
                    }
                }

                // Check for zero-width characters when navigating left
                if ($isCodeHighlightNode(anchorNode)) {
                    const content = anchorNode.getTextContent()

                    log("Left arrow pressed 2", {offset, content})
                    // If we're at offset 1 and there's a zero-width character at position 0, skip it
                    if (offset === 1 && content.charAt(0) === "\u200B") {
                        log("Left arrow pressed 3")
                        // Try to move to the previous node
                        const prevSibling = anchorNode.getPreviousSibling()
                        if (prevSibling) {
                            event.preventDefault()

                            let targetOffset = $isTabNode(prevSibling)
                                ? 0
                                : prevSibling.getTextContentSize()
                            const prevContent = prevSibling.getTextContent()

                            // Check if the previous node ends with a zero-width character
                            if (prevContent.endsWith("\u200B") && targetOffset > 0) {
                                targetOffset -= 1
                            }

                            log("Skipping zero-width character when moving left", {
                                from: anchorNode.getKey(),
                                to: prevSibling.getKey(),
                                targetOffset,
                            })

                            const selection = $createRangeSelection()
                            selection.anchor.set(prevSibling.getKey(), targetOffset, "text")
                            selection.focus.set(prevSibling.getKey(), targetOffset, "text")
                            $setSelection(selection)

                            return true
                        }
                    }
                }

                const newPosition = $findNextValidPosition(anchorNode, offset, "left")
                log("LEFT ARROW PRESSED 3", newPosition)
                if (newPosition) {
                    event.preventDefault()

                    // Check if the target node has a zero-width character at the target offset
                    const targetOffset = newPosition.offset
                    const targetNode = newPosition.node

                    const newOffsets = fixSelection(targetNode, targetOffset)

                    log("Set new left position", {
                        newOffsets,
                        newPosition,
                        originalOffset: newPosition.offset,
                        originalNode: newPosition.node.getKey(),
                    })

                    $setSelection(null)

                    // Then create and set a new selection
                    const selection = $createRangeSelection()
                    selection.anchor.set(
                        newOffsets.targetNode.getKey(),
                        newOffsets.targetOffset,
                        "text",
                    )
                    selection.focus.set(
                        newOffsets.targetNode.getKey(),
                        newOffsets.targetOffset,
                        "text",
                    )
                    $setSelection(selection)

                    // // Check if the target node has a zero-width character at the target offset
                    // let targetOffset = newPosition.offset
                    // let targetNode = newPosition.node
                    // const targetContent = targetNode.getTextContent()

                    // // If we're moving to a node with zero-width characters
                    // if (targetContent.includes("\u200B")) {
                    //     // If we're at the beginning and it starts with a zero-width character
                    //     if (targetOffset === 0 && targetContent.startsWith("\u200B")) {
                    //         // Skip all leading zero-width characters
                    //         while (
                    //             targetOffset < targetContent.length &&
                    //             targetContent[targetOffset] === "\u200B"
                    //         ) {
                    //             targetOffset += 1
                    //         }

                    //         // If we skipped all content in this node, try to move to the next node
                    //         if (targetOffset >= targetContent.length) {
                    //             const nextSibling = targetNode.getNextSibling()
                    //             if (nextSibling) {
                    //                 targetNode = nextSibling
                    //                 targetOffset = 0
                    //                 const nextContent = nextSibling.getTextContent()

                    //                 // Skip any leading zero-width chars in the next node
                    //                 while (
                    //                     targetOffset < nextContent.length &&
                    //                     nextContent[targetOffset] === "\u200B"
                    //                 ) {
                    //                     targetOffset += 1
                    //                 }

                    //                 log(
                    //                     "Left: Moved to next sibling after skipping zero-width chars",
                    //                     {
                    //                         from: newPosition.node.getKey(),
                    //                         to: nextSibling.getKey(),
                    //                         offset: targetOffset,
                    //                     },
                    //                 )
                    //             }
                    //         } else {
                    //             log("Left: Skipped leading zero-width chars", {
                    //                 node: targetNode.getKey(),
                    //                 newOffset: targetOffset,
                    //             })
                    //         }
                    //     } else if (
                    //         targetOffset > 0 &&
                    //         targetContent[targetOffset - 1] === "\u200B"
                    //     ) {
                    //         // If we're just after a zero-width character, try to find a better position
                    //         // Move back until we find a non-zero-width character
                    //         while (
                    //             targetOffset > 0 &&
                    //             targetContent[targetOffset - 1] === "\u200B"
                    //         ) {
                    //             targetOffset -= 1
                    //         }

                    //         // If we went all the way to the beginning, check the previous sibling
                    //         if (targetOffset === 0) {
                    //             const prevSibling = targetNode.getPreviousSibling()
                    //             if (prevSibling) {
                    //                 targetNode = prevSibling
                    //                 const prevContent = prevSibling.getTextContent()
                    //                 targetOffset = prevContent.length

                    //                 // Skip any trailing zero-width chars in the previous node
                    //                 while (
                    //                     targetOffset > 0 &&
                    //                     prevContent[targetOffset - 1] === "\u200B"
                    //                 ) {
                    //                     targetOffset -= 1
                    //                 }

                    //                 log(
                    //                     "Left: Moved to previous sibling after skipping zero-width chars",
                    //                     {
                    //                         from: newPosition.node.getKey(),
                    //                         to: prevSibling.getKey(),
                    //                         offset: targetOffset,
                    //                     },
                    //                 )
                    //             }
                    //         } else {
                    //             log("Left: Skipped trailing zero-width chars", {
                    //                 node: targetNode.getKey(),
                    //                 newOffset: targetOffset,
                    //             })
                    //         }
                    //     }
                    // }

                    // const selection = $createRangeSelection()
                    // selection.anchor.set(targetNode.getKey(), targetOffset, "text")
                    // selection.focus.set(targetNode.getKey(), targetOffset, "text")
                    // $setSelection(selection)

                    // log("Set new left position", {
                    //     nodeKey: targetNode.getKey(),
                    //     targetNode,
                    //     offset: targetOffset,
                    //     originalOffset: newPosition.offset,
                    //     originalNode: newPosition.node.getKey(),
                    // })

                    return true
                }

                return false
            },
            COMMAND_PRIORITY_CRITICAL,
        )

        // Handle right arrow key
        const removeRightHandler = editor.registerCommand(
            KEY_ARROW_RIGHT_COMMAND,
            (event) => {
                event.preventDefault()

                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                    return false
                }

                const anchorNode = selection.anchor.getNode()
                const offset = selection.anchor.offset

                const fixSelection = (targetNode, targetOffset) => {
                    const targetContent = targetNode.getTextContent()[targetOffset]

                    if (targetContent === "\u200B") {
                        const nextCharInNode = targetNode.getTextContent()[targetOffset + 1]
                        if (nextCharInNode && nextCharInNode !== "\u200B") {
                            targetOffset += 1
                        } else {
                            const nextNode = targetNode.getNextSibling()
                            if (nextNode) {
                                targetNode = nextNode
                                targetOffset = 0
                            } else {
                                const lineNode = anchorNode
                                    .getParents()
                                    .find($isCodeLineNode) as CodeLineNode
                                const nextLineNode = lineNode?.getNextSibling() as CodeLineNode
                                if (nextLineNode) {
                                    const firstChild = nextLineNode.getFirstChild()
                                    if (firstChild) {
                                        targetNode = firstChild
                                        targetOffset = 0
                                    }
                                    return fixSelection(firstChild, 0)
                                }
                            }
                        }
                    }

                    return {targetNode, targetOffset}
                }

                // Special handling for tab nodes to ensure consistent behavior
                if ($isTabNode(anchorNode)) {
                    // Check if we're at the end of the tab
                    // For tabs, we want to move to the next node when pressing right arrow
                    // regardless of the current offset
                    const x = $findNextValidPosition(anchorNode, offset, "right")
                    log("Tab node: Moving to next node", {
                        from: anchorNode.getKey(),
                        to: x.node.getKey(),
                        // newOffsets,
                    })

                    // Force a complete editor update cycle
                    // editor.update(() => {
                    //     // First clear any existing selection
                    // })
                    $setSelection(null)

                    // Then create and set a new selection
                    const selection = $createRangeSelection()
                    selection.anchor.set(x.node.getKey(), x.offset, "text")
                    selection.focus.set(x.node.getKey(), x.offset, "text")
                    $setSelection(selection)

                    return true

                    // const nextSibling = anchorNode.getNextSibling()
                    // if (nextSibling) {
                    //     // Always move to the next sibling first, even if it's empty
                    //     // This allows users to position their cursor after the tab
                    //     const targetNode = nextSibling
                    //     const targetOffset = 0

                    //     // We need to use editor.update to ensure the selection change takes effect
                    //     // editor.update(() => {
                    //     // })
                    //     // Get the corrected target node and offset
                    //     // const newOffsets = fixSelection(targetNode, targetOffset)
                    // }
                }

                // Special handling for nodes with zero-width characters
                if ($isCodeHighlightNode(anchorNode)) {
                    const content = anchorNode.getTextContent()

                    // Check if this node contains a zero-width character
                    if (content.includes("\u200B")) {
                        // If we're at the beginning and moving right, skip past the zero-width character
                        if (offset === 0 && content.startsWith("\u200B")) {
                            event.preventDefault()

                            // If there's more content after the zero-width, move past it
                            if (content.length > 1) {
                                const selection = $createRangeSelection()
                                selection.anchor.set(anchorNode.getKey(), 1, "text")
                                selection.focus.set(anchorNode.getKey(), 1, "text")
                                $setSelection(selection)
                                // editor.update(() => {
                                // })

                                log("Skipping zero-width character", {
                                    node: anchorNode.getKey(),
                                    content: content,
                                })

                                return true
                            } else {
                                // If it's only a zero-width character, try to move to the next node or line
                                const nextSibling = anchorNode.getNextSibling()
                                if (nextSibling) {
                                    // editor.update(() => {
                                    // })
                                    const selection = $createRangeSelection()
                                    selection.anchor.set(nextSibling.getKey(), 0, "text")
                                    selection.focus.set(nextSibling.getKey(), 0, "text")
                                    $setSelection(selection)

                                    log("Skipping zero-width node", {
                                        from: anchorNode.getKey(),
                                        to: nextSibling.getKey(),
                                    })

                                    return true
                                } else {
                                    // Try to move to the next line
                                    const parentLine = anchorNode.getParent()
                                    if ($isCodeLineNode(parentLine)) {
                                        const nextLine = parentLine.getNextSibling()
                                        if (nextLine && nextLine.getChildren().length > 0) {
                                            const lineChildren = nextLine.getChildren()

                                            // Find the first node that isn't just a zero-width character
                                            let targetNode = lineChildren[0]
                                            let targetOffset = 0

                                            // If the first node is a zero-width character and there are other nodes,
                                            // try to find a better node to navigate to
                                            if (lineChildren.length > 1) {
                                                const firstNodeContent = targetNode.getTextContent()
                                                if (
                                                    firstNodeContent === "\u200B" ||
                                                    firstNodeContent === ""
                                                ) {
                                                    // Check other nodes in the line
                                                    for (let i = 1; i < lineChildren.length; i++) {
                                                        const node = lineChildren[i]
                                                        const content = node.getTextContent()

                                                        // If this node has visible content, use it
                                                        if (
                                                            content !== "\u200B" &&
                                                            content !== ""
                                                        ) {
                                                            targetNode = node
                                                            targetOffset = 0
                                                            break
                                                        }
                                                    }
                                                }
                                            }

                                            log(
                                                "Skipping zero-width node and moving to next line",
                                                {
                                                    from: anchorNode.getKey(),
                                                    to: targetNode.getKey(),
                                                    lineChildCount: lineChildren.length,
                                                    targetContent: targetNode.getTextContent(),
                                                },
                                            )

                                            // Use editor.update to ensure the selection change is properly applied
                                            // editor.update(() => {
                                            // })
                                            const selection = $createRangeSelection()
                                            selection.anchor.set(
                                                targetNode.getKey(),
                                                targetOffset,
                                                "text",
                                            )
                                            selection.focus.set(
                                                targetNode.getKey(),
                                                targetOffset,
                                                "text",
                                            )
                                            $setSelection(selection)

                                            return true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                const newPosition = $findNextValidPosition(anchorNode, offset, "right")
                if (newPosition) {
                    event.preventDefault()

                    // Check if the target node has a zero-width character at the target offset
                    const targetOffset = newPosition.offset
                    const targetNode = newPosition.node

                    const newOffsets = fixSelection(targetNode, targetOffset)

                    log("Set new right position", {
                        newOffsets,
                        newPosition,
                        originalOffset: newPosition.offset,
                        originalNode: newPosition.node.getKey(),
                    })

                    // editor.update(() => {
                    //     // First clear any existing selection
                    // })
                    $setSelection(null)

                    // Then create and set a new selection
                    const selection = $createRangeSelection()
                    selection.anchor.set(
                        newOffsets.targetNode.getKey(),
                        newOffsets.targetOffset,
                        "text",
                    )
                    selection.focus.set(
                        newOffsets.targetNode.getKey(),
                        newOffsets.targetOffset,
                        "text",
                    )
                    $setSelection(selection)

                    return true
                }

                return false
            },
            COMMAND_PRIORITY_CRITICAL,
        )

        return () => {
            removeLeftHandler()
            removeRightHandler()
        }
    }, [editor])

    return null
}

export default HorizontalNavigationPlugin
