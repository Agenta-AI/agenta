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
    LexicalEditor,
    LexicalCommand,
} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"
import {$fixCodeBlockIndentation} from "../utils/indentationUtils"

const PLUGIN_NAME = "VerticalNavigationPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: false})

/**
 * Handles line movement with Alt+Up/Down
 */
function $handleShiftLines(
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

    const selection = $getSelection()
    if (!$isRangeSelection(selection)) {
        log("🔄 $handleShiftLines - Not a range selection")
        return false
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

    // Helper to get all selected CodeLineNodes (collapsed or not)
    let anchorIdx = -1
    let focusIdx = -1
    function getSelectedCodeLineNodes(selection: any) {
        const anchorNode = selection.anchor.getNode()
        const focusNode = selection.focus.getNode()
        const anchorLine = anchorNode.getParents().find($isCodeLineNode)
        const focusLine = focusNode.getParents().find($isCodeLineNode)
        if (!anchorLine || !focusLine) return []
        // Ensure order
        const parent = anchorLine.getParent()
        if (!parent) return []
        const lines = parent.getChildren().filter($isCodeLineNode)
        anchorIdx = lines.indexOf(anchorLine)
        focusIdx = lines.indexOf(focusLine)
        if (anchorIdx === -1 || focusIdx === -1) return []
        const [from, to] = anchorIdx <= focusIdx ? [anchorIdx, focusIdx] : [focusIdx, anchorIdx]
        return lines.slice(from, to + 1)
    }

    const selectedLines = getSelectedCodeLineNodes(selection)
    if (selectedLines.length === 0) {
        log("🔄 $handleShiftLines - No selected lines found")
        return false
    }

    // Determine block move boundaries
    const parent = selectedLines[0].getParent()

    // Helper to log indentation state for debugging
    function logIndentationState(label: string, block: any) {
        if (!block) return
        const lines = block.getChildren().filter($isCodeLineNode)
        log(
            label,
            lines.map((l: any, idx: number) => ({
                line: idx,
                text: l.getTextContent(),
                indent: (l.getTextContent().match(/^(\s*)/)?.[1] || "")
                    .replace(/ /g, "·")
                    .replace(/\t/g, "→"),
            })),
        )
    }
    if (!parent) return false
    const allLines = parent.getChildren().filter($isCodeLineNode)
    const firstIdx = allLines.indexOf(selectedLines[0])
    const lastIdx = allLines.indexOf(selectedLines[selectedLines.length - 1])

    // Determine target
    if (arrowIsUp && firstIdx === 0) {
        log("🔄 $handleShiftLines - At top, cannot move up")
        return false
    }
    if (!arrowIsUp && lastIdx === allLines.length - 1) {
        log("🔄 $handleShiftLines - At bottom, cannot move down")
        return false
    }

    // Remove all selected lines from parent
    $setSelection(null)
    for (const line of selectedLines) {
        line.remove()
    }

    // Insert at new position
    if (arrowIsUp) {
        // Insert before the line above (using sibling method)
        allLines[firstIdx - 1].insertBefore(selectedLines[0])
        for (let i = 1; i < selectedLines.length; i++) {
            selectedLines[i - 1].insertAfter(selectedLines[i])
        }
    } else {
        // Insert after the line below (using sibling method)
        allLines[lastIdx + 1].insertAfter(selectedLines[selectedLines.length - 1])
        for (let i = selectedLines.length - 2; i >= 0; i--) {
            selectedLines[i + 1].insertBefore(selectedLines[i])
        }
    }

    // Restore selection to moved lines, preserving anchor/focus
    // Find new anchor/focus lines by relative position
    const newAllLines = parent.getChildren().filter($isCodeLineNode)
    const newFirstIdx = arrowIsUp ? firstIdx - 1 : firstIdx + 1
    const newLastIdx = arrowIsUp ? lastIdx - 1 : lastIdx + 1
    const newAnchorIdx =
        selection.anchor.type === "text"
            ? anchorIdx <= focusIdx
                ? newFirstIdx
                : newLastIdx
            : newFirstIdx
    const newFocusIdx =
        selection.focus.type === "text"
            ? anchorIdx <= focusIdx
                ? newLastIdx
                : newFirstIdx
            : newLastIdx
    const newAnchorLine = newAllLines[newAnchorIdx]
    const newFocusLine = newAllLines[newFocusIdx]
    // Try to restore anchor/focus to same child node key and offset if possible
    const newSelection = $createRangeSelection()
    // Find anchor/focus node in new line (by key if possible)
    function findNodeInLine(line: any, origKey: string, origOffset: number) {
        const children = line.getChildren()
        let node = children.find((n: any) => n.getKey && n.getKey() === origKey)
        if (!node) node = children[0]
        let offset = origOffset
        if (offset > node.getTextContentSize()) offset = node.getTextContentSize()
        return {node, offset}
    }
    const anchorInfo = findNodeInLine(newAnchorLine, anchorNode.getKey(), anchorOffset)
    const focusInfo = findNodeInLine(newFocusLine, focusNode.getKey(), focusOffset)
    newSelection.anchor.set(anchorInfo.node.getKey(), anchorInfo.offset, "text")
    newSelection.focus.set(focusInfo.node.getKey(), focusInfo.offset, "text")
    $setSelection(newSelection)
    event.preventDefault()
    shouldHandle = true

    // Log indentation before fix
    logIndentationState("Indentation BEFORE auto-fix", parent)
    // Auto-fix indentation for the parent code block
    $fixCodeBlockIndentation(parent)
    // Log indentation after fix
    logIndentationState("Indentation AFTER auto-fix", parent)

    return shouldHandle
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

                const {anchor, focus} = selection
                const anchorNode = focus.getNode()

                if (!anchorNode.getParents().some($isCodeBlockNode)) {
                    log("🎮 Not in code block")
                    return false
                }

                log("🎮 Selection info", {
                    anchorNode: anchorNode.getKey(),
                    anchorOffset: focus.offset,
                    isCollapsed: selection.isCollapsed(),
                    nodeType: anchorNode.getType(),
                })

                // Handle edge cases: prevent selection from moving out of code block

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
                    const result = $handleShiftLines(editor, command, event)
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
                        currentPositionInLine += focus.offset
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
                if (event.shiftKey) {
                    newSelection.anchor.set(anchor.getNode().getKey(), anchor.offset, "text")
                    newSelection.focus.set(targetNode.getKey(), offsetInTargetNode, "text")
                } else {
                    newSelection.anchor.set(targetNode.getKey(), offsetInTargetNode, "text")
                    newSelection.focus.set(targetNode.getKey(), offsetInTargetNode, "text")
                }
                $setSelection(newSelection)
                return true

                return false
            },
            COMMAND_PRIORITY_CRITICAL,
        )
    }, [editor])

    return null
}

export default VerticalNavigationPlugin
