import {createLogger} from "@agenta/shared/utils"
import {
    $createRangeSelection,
    $getSelection,
    $isRangeSelection,
    $setSelection,
    COMMAND_PRIORITY_HIGH,
    KEY_ARROW_DOWN_COMMAND,
    KEY_ARROW_UP_COMMAND,
    KEY_DOWN_COMMAND,
    type ElementNode,
    type LexicalCommand,
    type LexicalEditor,
    type LexicalNode,
    type RangeSelection,
} from "lexical"

import {$isCodeBlockNode} from "../../nodes/CodeBlockNode"
import {$isCodeLineNode, type CodeLineNode} from "../../nodes/CodeLineNode"
import {$fixCodeBlockIndentation} from "../../utils/indentationUtils"
import {getNodeAtOffset} from "../../utils/navigation"
import {$getAllCodeLines, $getNextCodeLine, $getPreviousCodeLine} from "../../utils/segmentUtils"

const PLUGIN_NAME = "VerticalNavigationPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: true})
const DEBUG_LOGS = false

function $handleShiftLines(command: LexicalCommand<KeyboardEvent>, event: KeyboardEvent): boolean {
    const isAltKeyPressed = event.altKey
    const arrowIsUp = command === KEY_ARROW_UP_COMMAND

    DEBUG_LOGS &&
        log("🔄 $handleShiftLines - Entry", {
            command: arrowIsUp ? "KEY_ARROW_UP_COMMAND" : "KEY_ARROW_DOWN_COMMAND",
            altKey: isAltKeyPressed,
        })

    if (!isAltKeyPressed) {
        DEBUG_LOGS && log("🔄 $handleShiftLines - Not handling non-alt key press")
        return false
    }

    let shouldHandle = false

    const selection = $getSelection()
    if (!$isRangeSelection(selection)) {
        DEBUG_LOGS && log("🔄 $handleShiftLines - Not a range selection")
        return false
    }

    const {anchor, focus} = selection
    const anchorNode = anchor.getNode()
    const focusNode = focus.getNode()
    const anchorOffset = anchor.offset
    const focusOffset = focus.offset

    DEBUG_LOGS &&
        log("🔄 $handleShiftLines - Selection", {
            anchorNodeKey: anchorNode.getKey(),
            focusNodeKey: focusNode.getKey(),
            anchorOffset,
            focusOffset,
        })

    let anchorIdx = -1
    let focusIdx = -1
    function getSelectedCodeLineNodes(rangeSelection: RangeSelection) {
        const anchorNode = rangeSelection.anchor.getNode()
        const focusNode = rangeSelection.focus.getNode()
        const anchorLine = anchorNode.getParents().find($isCodeLineNode)
        const focusLine = focusNode.getParents().find($isCodeLineNode)
        if (!anchorLine || !focusLine) return []
        const parent = anchorLine.getParent()
        if (!parent) return []
        const codeBlock = anchorLine.getParents().find($isCodeBlockNode)
        const lines = codeBlock ? $getAllCodeLines(codeBlock) : []
        anchorIdx = lines.indexOf(anchorLine)
        focusIdx = lines.indexOf(focusLine)
        if (anchorIdx === -1 || focusIdx === -1) return []
        const [from, to] = anchorIdx <= focusIdx ? [anchorIdx, focusIdx] : [focusIdx, anchorIdx]
        return lines.slice(from, to + 1)
    }

    const selectedLines = getSelectedCodeLineNodes(selection)
    if (selectedLines.length === 0) {
        DEBUG_LOGS && log("🔄 $handleShiftLines - No selected lines found")
        return false
    }

    const parent = selectedLines[0].getParent()

    function logIndentationState(label: string, block: ElementNode | null) {
        if (!block || !$isCodeBlockNode(block)) return
        const lines = $getAllCodeLines(block)
        DEBUG_LOGS &&
            log(
                label,
                lines.map((line, idx: number) => ({
                    line: idx,
                    text: line.getTextContent(),
                    indent: (line.getTextContent().match(/^(\s*)/)?.[1] || "")
                        .replace(/ /g, "·")
                        .replace(/\t/g, "→"),
                })),
            )
    }
    if (!parent) return false
    const codeBlockForShift = selectedLines[0].getParents().find($isCodeBlockNode)
    const allLines = codeBlockForShift ? $getAllCodeLines(codeBlockForShift) : []
    const firstIdx = allLines.indexOf(selectedLines[0])
    const lastIdx = allLines.indexOf(selectedLines[selectedLines.length - 1])

    if (arrowIsUp && firstIdx === 0) {
        DEBUG_LOGS && log("🔄 $handleShiftLines - At top, cannot move up")
        return false
    }
    if (!arrowIsUp && lastIdx === allLines.length - 1) {
        DEBUG_LOGS && log("🔄 $handleShiftLines - At bottom, cannot move down")
        return false
    }

    $setSelection(null)
    for (const line of selectedLines) {
        line.remove()
    }

    if (arrowIsUp) {
        allLines[firstIdx - 1].insertBefore(selectedLines[0])
        for (let i = 1; i < selectedLines.length; i++) {
            selectedLines[i - 1].insertAfter(selectedLines[i])
        }
    } else {
        allLines[lastIdx + 1].insertAfter(selectedLines[selectedLines.length - 1])
        for (let i = selectedLines.length - 2; i >= 0; i--) {
            selectedLines[i + 1].insertBefore(selectedLines[i])
        }
    }

    const newAllLines = codeBlockForShift ? $getAllCodeLines(codeBlockForShift) : []
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
    const newSelection = $createRangeSelection()
    function findNodeInLine(line: LexicalNode, origKey: string, origOffset: number) {
        const children = (line as ElementNode).getChildren()
        let node: LexicalNode | undefined = children.find((child) => child.getKey() === origKey)
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

    logIndentationState("Indentation BEFORE auto-fix", parent)
    $fixCodeBlockIndentation(parent)
    logIndentationState("Indentation AFTER auto-fix", parent)

    DEBUG_LOGS &&
        log(
            `🔄 [VerticalNavigationPlugin] Line movement completed - validation will be handled automatically`,
        )

    return shouldHandle
}

export function registerVerticalNavigationCommands(editor: LexicalEditor): () => void {
    return editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                return false
            }

            DEBUG_LOGS && log("🎮 Arrow key pressed", event.key)

            const isArrowUp = event.key === "ArrowUp"
            const command = isArrowUp ? KEY_ARROW_UP_COMMAND : KEY_ARROW_DOWN_COMMAND

            const selection = $getSelection()
            if (!$isRangeSelection(selection)) {
                DEBUG_LOGS && log("🎮 Not a range selection")
                return false
            }

            const {anchor, focus} = selection
            const anchorNode = focus.getNode()

            if (!anchorNode.getParents().some($isCodeBlockNode)) {
                DEBUG_LOGS && log("🎮 Not in code block")
                return false
            }

            DEBUG_LOGS &&
                log("🎮 Selection info", {
                    anchorNode: anchorNode.getKey(),
                    anchorOffset: focus.offset,
                    isCollapsed: selection.isCollapsed(),
                    nodeType: anchorNode.getType(),
                })

            const currentLine = anchorNode.getParents().find($isCodeLineNode)
            if (!currentLine) return false

            const isLineFolded = (line: CodeLineNode): boolean => {
                // Check DOM element for fold visibility. The `folded` class is
                // toggled directly on the DOM (bypassing Lexical state) for
                // performance, so we check the class rather than `line.isHidden()`.
                const element = editor.getElementByKey(line.getKey())
                return element ? element.classList.contains("folded") : line.isHidden()
            }

            const getUnfoldedLine = (
                line: LexicalNode | null,
                direction: "up" | "down",
            ): CodeLineNode | null => {
                if (!line || !$isCodeLineNode(line)) return null
                const target =
                    direction === "up" ? $getPreviousCodeLine(line) : $getNextCodeLine(line)

                if (target && !isLineFolded(target)) return target
                return getUnfoldedLine(target, direction)
            }

            const targetLine = isArrowUp
                ? getUnfoldedLine(currentLine, "up")
                : getUnfoldedLine(currentLine, "down")

            if (!targetLine || !$isCodeLineNode(targetLine)) return false

            if (event.metaKey) {
                DEBUG_LOGS && log("🎮 Cmd+Arrow detected, handling document navigation")
                event.preventDefault()

                const codeBlock = currentLine.getParents().find($isCodeBlockNode)
                if (!codeBlock) return false

                const allLines = $getAllCodeLines(codeBlock)
                if (allLines.length === 0) return false

                const destinationLine = isArrowUp ? allLines[0] : allLines[allLines.length - 1]
                if (!destinationLine) return false

                const targetNodes = destinationLine.getChildren()
                if (targetNodes.length === 0) return false

                let targetNode
                let targetOffset
                if (isArrowUp) {
                    targetNode = targetNodes[0]
                    targetOffset = 0
                } else {
                    const lastNode = targetNodes[targetNodes.length - 1]
                    targetNode = lastNode
                    targetOffset = lastNode.getTextContentSize()
                }

                const newSelection = $createRangeSelection()
                if (event.shiftKey) {
                    newSelection.anchor.set(anchor.getNode().getKey(), anchor.offset, "text")
                    newSelection.focus.set(targetNode.getKey(), targetOffset, "text")
                } else {
                    newSelection.anchor.set(targetNode.getKey(), targetOffset, "text")
                    newSelection.focus.set(targetNode.getKey(), targetOffset, "text")
                }

                $setSelection(newSelection)
                DEBUG_LOGS &&
                    log("🎮 Document navigation completed", {
                        direction: isArrowUp ? "top" : "bottom",
                        targetNodeKey: targetNode.getKey(),
                        targetOffset,
                        shiftKey: event.shiftKey,
                    })
                return true
            }

            if (event.altKey) {
                DEBUG_LOGS && log("🎮 Alt+Arrow detected, handling line movement")
                const result = $handleShiftLines(command, event)
                DEBUG_LOGS && log("🎮 Line movement result:", result)
                return result
            }

            DEBUG_LOGS && log("🎮 Moving to adjacent line")

            const currentLineContent = currentLine.getTextContent()
            const currentLineLength = currentLineContent.length
            const currentLineNodes = currentLine.getChildren()
            let currentPositionInLine = 0

            for (const node of currentLineNodes) {
                if (node.getKey() === anchorNode.getKey()) {
                    currentPositionInLine += focus.offset
                    break
                } else {
                    currentPositionInLine += node.getTextContentSize()
                }
            }

            DEBUG_LOGS &&
                log("🎮 Current position in line:", {
                    currentPositionInLine,
                    currentLineLength,
                    currentLineContent,
                })

            const targetLineContent = targetLine.getTextContent()
            const targetLineLength = targetLineContent.length
            const targetLineNodes = targetLine.getChildren()

            DEBUG_LOGS &&
                log("🎮 Target line info:", {
                    targetLineLength,
                    targetLineContent,
                    nodeCount: targetLineNodes.length,
                })

            const targetOffset = Math.min(currentPositionInLine, targetLineLength)

            const {node: targetNode, innerOffset: offsetInTargetNode} = getNodeAtOffset(
                targetLine,
                targetOffset,
            )

            if (!targetNode) {
                DEBUG_LOGS && log("🎮 No target node found")
                return false
            }

            DEBUG_LOGS &&
                log("🎮 Setting selection to:", {
                    targetNodeKey: targetNode.getKey(),
                    offsetInTargetNode,
                    targetNodeType: targetNode.getType(),
                })

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
        },
        COMMAND_PRIORITY_HIGH,
    )
}
