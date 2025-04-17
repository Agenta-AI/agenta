/**
 * VerticalNavigationPlugin.tsx
 *
 * This plugin improves vertical navigation in code blocks by:
 * 1. Maintaining cursor horizontal position when moving between lines
 * 2. Handling Alt+Up/Down for line movement
 * 3. Preventing selection from moving out of code blocks
 */
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isRangeSelection,
    $createRangeSelection,
    $setSelection,
    COMMAND_PRIORITY_CRITICAL,
    KEY_ARROW_UP_COMMAND,
    KEY_ARROW_DOWN_COMMAND,
    KEY_DOWN_COMMAND,
    LexicalNode,
    LexicalEditor,
    LexicalCommand,
} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

const PLUGIN_NAME = "VerticalNavigationPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: true})

/**
 * Handles line movement with Alt+Up/Down
 */
function handleShiftLines(
    editor: LexicalEditor,
    command: LexicalCommand<KeyboardEvent>,
    event: KeyboardEvent,
): boolean {
    const isAltKeyPressed = event.altKey
    const arrowIsUp = command === KEY_ARROW_UP_COMMAND

    log("🔄 $handleShiftLines - Entry", {
        command: arrowIsUp ? "KEY_ARROW_UP_COMMAND" : "KEY_ARROW_DOWN_COMMAND",
        altKey: isAltKeyPressed,
    })

    if (!isAltKeyPressed) {
        log("🔄 $handleShiftLines - Not handling non-alt key press")
        return false
    }

    let shouldHandle = false

    editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
            log("🔄 $handleShiftLines - Not a range selection")
            return
        }

        const {anchor, focus} = selection
        const anchorNode = anchor.getNode()
        const focusNode = focus.getNode()
        const anchorOffset = anchor.offset
        const focusOffset = focus.offset

        log("🔄 $handleShiftLines - Selection", {
            anchorNodeKey: anchorNode.getKey(),
            focusNodeKey: focusNode.getKey(),
            anchorOffset,
            focusOffset,
        })

        // Find the CodeLineNode containing the selection
        const codeLineNode = anchorNode.getParents().find($isCodeLineNode)
        if (!codeLineNode) {
            log("🔄 $handleShiftLines - No CodeLineNode found")
            return false
        }

        const previousLine = codeLineNode.getPreviousSibling()
        const nextLine = codeLineNode.getNextSibling()
        const targetLine = arrowIsUp ? previousLine : nextLine

        if (!targetLine) {
            log("🔄 $handleShiftLines - No target line found")
            return false
        }

        log("🔄 $handleShiftLines - Found lines", {
            currentLineKey: codeLineNode.getKey(),
            targetLineKey: targetLine.getKey(),
            direction: arrowIsUp ? "up" : "down",
        })

        if (arrowIsUp && codeLineNode.getPreviousSibling()) {
            log("🔄 $handleShiftLines - Moving line up")
            // Move current line before previous line
            codeLineNode.insertBefore(previousLine)
            event.preventDefault()
            shouldHandle = true
        } else if (!arrowIsUp && codeLineNode.getNextSibling()) {
            log("🔄 $handleShiftLines - Moving line down")
            // Move current line after next line
            codeLineNode.insertAfter(nextLine)
            event.preventDefault()
            shouldHandle = true
        }

        log("🔄 $handleShiftLines - Exit, no action taken")
    })

    return shouldHandle
}

/**
 * Finds the equivalent position in the target line based on current position
 */
function findEquivalentPositionInLine(
    currentLine: LexicalNode,
    targetLine: LexicalNode,
    currentOffset: number,
): {node: LexicalNode; offset: number} {
    // Find all text content in the current line to calculate relative position
    const currentLineContent = currentLine.getTextContent()
    const currentLineLength = currentLineContent.length

    // Calculate the cursor's position relative to the current line
    // First, find all text nodes in the current line
    const currentLineNodes = currentLine.getChildren()
    let currentPositionInLine = 0

    // Calculate position by counting text before the cursor
    let foundCurrentNode = false
    for (const node of currentLineNodes) {
        if (node.getKey() === currentOffset.toString()) {
            // We found the node containing the cursor
            foundCurrentNode = true
            currentPositionInLine += parseInt(currentOffset.toString())
            break
        } else if (!foundCurrentNode) {
            // Add the length of nodes we've passed
            currentPositionInLine += node.getTextContentSize()
        }
    }

    // Get target line information
    const targetLineContent = targetLine.getTextContent()
    const targetLineLength = targetLineContent.length
    const targetLineNodes = targetLine.getChildren()

    // Try to position at the same relative offset
    // If that's not possible, position at the end
    const targetOffset = Math.min(currentPositionInLine, targetLineLength)

    // Find the node and offset within that node for the target position
    let accumulatedLength = 0
    let targetNode = targetLineNodes[targetLineNodes.length - 1] // Default to last node
    let offsetInTargetNode = targetNode ? targetNode.getTextContentSize() : 0

    for (const node of targetLineNodes) {
        const nodeLength = node.getTextContentSize()
        if (accumulatedLength + nodeLength >= targetOffset) {
            // We found the node containing our target position
            targetNode = node
            offsetInTargetNode = targetOffset - accumulatedLength
            break
        }
        accumulatedLength += nodeLength
    }

    return {
        node: targetNode,
        offset: offsetInTargetNode,
    }
}

/**
 * Plugin that improves vertical navigation in code blocks
 */
export function VerticalNavigationPlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event: KeyboardEvent) => {
                // Only handle arrow up and down keys
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                    return false
                }

                log("🎮 Arrow key pressed", event.key)

                const isArrowUp = event.key === "ArrowUp"
                const command = isArrowUp ? KEY_ARROW_UP_COMMAND : KEY_ARROW_DOWN_COMMAND

                const selection = $getSelection()
                if (!$isRangeSelection(selection)) {
                    log("🎮 Not a range selection")
                    return false
                }

                const {anchor} = selection
                const anchorNode = anchor.getNode()

                if (!anchorNode.getParents().some($isCodeBlockNode)) {
                    log("🎮 Not in code block")
                    return false
                }

                log("🎮 Selection info", {
                    anchorNode: anchorNode.getKey(),
                    anchorOffset: anchor.offset,
                    isCollapsed: selection.isCollapsed(),
                    nodeType: anchorNode.getType(),
                })

                // Handle edge cases: prevent selection from moving out of code block
                if (selection.isCollapsed()) {
                    const currentLine = anchorNode.getParents().find($isCodeLineNode)
                    if (!currentLine) return false

                    const targetLine = isArrowUp
                        ? currentLine.getPreviousSibling()
                        : currentLine.getNextSibling()

                    if (!targetLine || !$isCodeLineNode(targetLine)) {
                        // If at the top/bottom of code block, prevent selection from moving out
                        if (
                            (isArrowUp && !currentLine.getPreviousSibling()) ||
                            (!isArrowUp && !currentLine.getNextSibling())
                        ) {
                            log("🎮 At edge of code block, preventing default")
                            event.preventDefault()
                            return true
                        }
                        return false
                    }

                    // Handle Alt+Arrow for line movement
                    if (event.altKey) {
                        log("🎮 Alt+Arrow detected, handling line movement")
                        const result = handleShiftLines(editor, command, event)
                        log("🎮 Line movement result:", result)
                        return result
                    }

                    // Regular arrow navigation - maintain horizontal position
                    log("🎮 Moving to adjacent line")

                    // Find all text content in the current line to calculate relative position
                    const currentLineContent = currentLine.getTextContent()
                    const currentLineLength = currentLineContent.length

                    // Calculate the cursor's position relative to the current line
                    // First, find all text nodes in the current line
                    const currentLineNodes = currentLine.getChildren()
                    let currentPositionInLine = 0

                    // Calculate position by counting text before the cursor
                    for (const node of currentLineNodes) {
                        if (node.getKey() === anchorNode.getKey()) {
                            // We found the node containing the cursor
                            currentPositionInLine += anchor.offset
                            break
                        } else {
                            // Add the length of nodes we've passed
                            currentPositionInLine += node.getTextContentSize()
                        }
                    }

                    log("🎮 Current position in line:", {
                        currentPositionInLine,
                        currentLineLength,
                        currentLineContent,
                    })

                    // Get target line information
                    const targetLineContent = targetLine.getTextContent()
                    const targetLineLength = targetLineContent.length
                    const targetLineNodes = targetLine.getChildren()

                    log("🎮 Target line info:", {
                        targetLineLength,
                        targetLineContent,
                        nodeCount: targetLineNodes.length,
                    })

                    // Try to position at the same relative offset
                    // If that's not possible, position at the end
                    const targetOffset = Math.min(currentPositionInLine, targetLineLength)

                    // Find the node and offset within that node for the target position
                    let accumulatedLength = 0
                    let targetNode = targetLineNodes[targetLineNodes.length - 1] // Default to last node
                    let offsetInTargetNode = targetNode ? targetNode.getTextContentSize() : 0

                    for (const node of targetLineNodes) {
                        const nodeLength = node.getTextContentSize()
                        if (accumulatedLength + nodeLength >= targetOffset) {
                            // We found the node containing our target position
                            targetNode = node
                            offsetInTargetNode = targetOffset - accumulatedLength
                            break
                        }
                        accumulatedLength += nodeLength
                    }

                    if (!targetNode) {
                        log("🎮 No target node found")
                        return false
                    }

                    log("🎮 Setting selection to:", {
                        targetNodeKey: targetNode.getKey(),
                        offsetInTargetNode,
                        targetNodeType: targetNode.getType(),
                    })

                    // Create and set the selection
                    event.preventDefault()
                    const newSelection = $createRangeSelection()
                    newSelection.anchor.set(targetNode.getKey(), offsetInTargetNode, "text")
                    newSelection.focus.set(targetNode.getKey(), offsetInTargetNode, "text")
                    $setSelection(newSelection)
                    return true
                }

                return false
            },
            COMMAND_PRIORITY_CRITICAL,
        )
    }, [editor])

    return null
}

export default VerticalNavigationPlugin
