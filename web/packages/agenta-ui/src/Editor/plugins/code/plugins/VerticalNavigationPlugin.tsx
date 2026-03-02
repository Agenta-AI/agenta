/**
 * VerticalNavigationPlugin.tsx
 *
 * This plugin improves vertical navigation in code blocks by:
 * 1. Maintaining cursor horizontal position when moving between lines
 * 2. Handling Alt+Up/Down for line movement
 * 3. Handling Cmd+Up/Down (macOS) for document navigation (jump to top/bottom)
 * 4. Preventing selection from moving out of code blocks
 * 5. Supporting Shift+Cmd+Up/Down for selection extension to document boundaries
 */
import {useEffect} from "react"

import {createLogger} from "@agenta/shared/utils"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isRangeSelection,
    $createRangeSelection,
    $setSelection,
    COMMAND_PRIORITY_HIGH,
    KEY_ARROW_UP_COMMAND,
    KEY_ARROW_DOWN_COMMAND,
    KEY_DOWN_COMMAND,
    LexicalEditor,
    LexicalCommand,
    RangeSelection,
    LexicalNode,
    ElementNode,
} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"
import {$fixCodeBlockIndentation} from "../utils/indentationUtils"
import {getNodeAtOffset} from "../utils/navigation"

const PLUGIN_NAME = "VerticalNavigationPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: true})

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
    function getSelectedCodeLineNodes(selection: RangeSelection) {
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
    function logIndentationState(label: string, block: ElementNode | null) {
        if (!block) return
        const lines = block.getChildren().filter($isCodeLineNode)
        log(
            label,
            lines.map((l, idx: number) => ({
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
    function findNodeInLine(line: LexicalNode, origKey: string, origOffset: number) {
        const children = (line as ElementNode).getChildren()
        let node: LexicalNode | undefined = children.find((n) => n.getKey() === origKey)
        if (!node) node = children[0]
        let offset = origOffset
        if (node && offset > node.getTextContentSize()) offset = node.getTextContentSize()
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

    // Trigger validation after line movement to update error indicators
    // This ensures that validation errors are repositioned to match the moved lines
    const textContent = parent.getTextContent()

    if (textContent.length > 3) {
        // Clean the text content by removing empty lines for validation
        const originalLines = textContent.split("\n")
        const cleanedLines: string[] = []
        const cleanedToOriginalLineMap = new Map<number, number>()

        originalLines.forEach((line: string, originalIndex: number) => {
            if (line.trim() !== "") {
                cleanedLines.push(line)
                const cleanedLineNumber = cleanedLines.length
                const originalLineNumber = originalIndex + 1
                cleanedToOriginalLineMap.set(cleanedLineNumber, originalLineNumber)
            }
        })

        log(
            `🔄 [VerticalNavigationPlugin] Line movement completed - validation will be handled automatically`,
        )
    }

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

                const getUnfoldedLine = (
                    line: LexicalNode | null,
                    direction: "up" | "down",
                ): CodeLineNode | null => {
                    if (!line) return null
                    const target =
                        direction === "up" ? line.getPreviousSibling() : line.getNextSibling()

                    if (target && $isCodeLineNode(target) && !target.isHidden()) return target
                    return getUnfoldedLine(target, direction)
                }

                const targetLine = isArrowUp
                    ? getUnfoldedLine(currentLine, "up")
                    : getUnfoldedLine(currentLine, "down")

                if (!targetLine || !$isCodeLineNode(targetLine)) return false

                // Handle Cmd+Arrow (metaKey) for document navigation (VSCode-like)
                if (event.metaKey) {
                    log("🎮 Cmd+Arrow detected, handling document navigation")
                    event.preventDefault()

                    // Find the code block containing the current line
                    const codeBlock = currentLine.getParents().find($isCodeBlockNode)
                    if (!codeBlock) return false

                    // Get all lines in the code block
                    const allLines = codeBlock.getChildren().filter($isCodeLineNode)
                    if (allLines.length === 0) return false

                    // Determine target line (first or last)
                    const targetLine = isArrowUp ? allLines[0] : allLines[allLines.length - 1]
                    if (!targetLine) return false

                    // Position cursor at beginning or end of target line
                    const targetNodes = targetLine.getChildren()
                    if (targetNodes.length === 0) return false

                    let targetNode, targetOffset
                    if (isArrowUp) {
                        // Go to beginning of first line
                        targetNode = targetNodes[0]
                        targetOffset = 0
                    } else {
                        // Go to end of last line
                        const lastNode = targetNodes[targetNodes.length - 1]
                        targetNode = lastNode
                        targetOffset = lastNode.getTextContentSize()
                    }

                    // Create and set the selection
                    const newSelection = $createRangeSelection()
                    if (event.shiftKey) {
                        // Extend selection from current position to target
                        newSelection.anchor.set(anchor.getNode().getKey(), anchor.offset, "text")
                        newSelection.focus.set(targetNode.getKey(), targetOffset, "text")
                    } else {
                        // Move cursor to target position
                        newSelection.anchor.set(targetNode.getKey(), targetOffset, "text")
                        newSelection.focus.set(targetNode.getKey(), targetOffset, "text")
                    }

                    $setSelection(newSelection)
                    log("🎮 Document navigation completed", {
                        direction: isArrowUp ? "top" : "bottom",
                        targetNodeKey: targetNode.getKey(),
                        targetOffset,
                        shiftKey: event.shiftKey,
                    })
                    return true
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
                // const isTargetLineFolded = targetLine?.isCollapsed()

                // if (isTargetLineFolded) {

                //     // editor.dispatchCommand(KEY_DOWN_COMMAND, event)
                //     // return true
                // }
                const targetLineContent = targetLine?.getTextContent()
                const targetLineLength = targetLineContent?.length
                const targetLineNodes = targetLine?.getChildren()

                log("🎮 Target line info:", {
                    targetLineLength,
                    targetLineContent,
                    nodeCount: targetLineNodes.length,
                })

                // Try to position at the same relative offset
                // If that's not possible, position at the end
                const targetOffset = Math.min(currentPositionInLine, targetLineLength)

                // Resolve node + inner offset via helper (O(children) worst-case but no manual loop here)
                const {node: targetNode, innerOffset: offsetInTargetNode} = getNodeAtOffset(
                    targetLine,
                    targetOffset,
                )

                if (!targetNode) {
                    log("🎮 No target node found")
                    return false
                }

                log("🎮 Setting selection to:", {
                    targetNodeKey: targetNode.getKey(),
                    offsetInTargetNode,
                    targetNodeType: targetNode!.getType(),
                })

                // Create and set the selection
                event.preventDefault()
                const newSelection = $createRangeSelection()
                if (event.shiftKey) {
                    newSelection.anchor.set(anchor.getNode().getKey(), anchor.offset, "text")
                    newSelection.focus.set(targetNode.getKey(), offsetInTargetNode, "text")
                } else {
                    newSelection.anchor.set(targetNode!.getKey(), offsetInTargetNode, "text")
                    newSelection.focus.set(targetNode.getKey(), offsetInTargetNode, "text")
                }
                $setSelection(newSelection)
                return true

                return false
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor])

    return null
}

export default VerticalNavigationPlugin
