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
    $isTabNode,
    MOVE_TO_START,
    MOVE_TO_END,
    KEY_DOWN_COMMAND,
} from "lexical"

import {$isCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

import {isSkippableToken, $findNextValidPosition} from "./horizontalNavigationUtils"

const PLUGIN_NAME = "HorizontalNavigationPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: false})

export function HorizontalNavigationPlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        const moveStartHandler = editor.registerCommand(
            MOVE_TO_START,
            (event) => {
                log("MOVE TO START", event)
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                    return false
                }
                const anchorNode = selection.anchor.getNode()
                // Find containing code line
                let lineNode = anchorNode
                while (lineNode && !$isCodeLineNode(lineNode)) {
                    lineNode = lineNode.getParent()
                }
                if (!lineNode || !$isCodeLineNode(lineNode)) return false
                const children = lineNode.getChildren()
                // Find first non-tab child
                let firstContentNode = null
                const tabNodes = []
                for (const child of children) {
                    if ($isTabNode(child)) {
                        tabNodes.push(child)
                    } else {
                        firstContentNode = child
                        break
                    }
                }
                if (firstContentNode && typeof firstContentNode.getKey === "function") {
                    // Place caret at start of first content node
                    const sel = $createRangeSelection()
                    sel.anchor.set(firstContentNode.getKey(), 0, "text")
                    sel.focus.set(firstContentNode.getKey(), 0, "text")
                    $setSelection(sel)
                    return true
                } else if (tabNodes.length > 0) {
                    // Only tabs: place caret at end of last tab
                    const lastTabNode = tabNodes[tabNodes.length - 1]
                    const sel = lastTabNode.selectEnd()
                    $setSelection(sel)
                    return true
                } else {
                    // Empty line: select start of line node
                    const sel = lineNode.selectStart()
                    $setSelection(sel)
                    return true
                }
            },
            COMMAND_PRIORITY_CRITICAL,
        )
        const moveEndHandler = editor.registerCommand(
            MOVE_TO_END,
            (event) => {
                log("MOVE TO END", event)
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                    return false
                }
                const anchorNode = selection.anchor.getNode()
                // Find containing code line
                let lineNode = anchorNode
                while (lineNode && !$isCodeLineNode(lineNode)) {
                    lineNode = lineNode.getParent()
                }
                if (!lineNode || !$isCodeLineNode(lineNode)) return false
                const children = lineNode.getChildren()
                // Find last non-tab child
                let lastContentNode = null
                const tabNodes = []
                for (let i = children.length - 1; i >= 0; i--) {
                    const child = children[i]
                    if ($isTabNode(child)) {
                        tabNodes.push(child)
                    } else if (!lastContentNode) {
                        lastContentNode = child
                    }
                }
                if (lastContentNode && typeof lastContentNode.getKey === "function") {
                    // Place caret at end of last content node
                    const sel = $createRangeSelection()
                    let endOffset = 0
                    if (typeof lastContentNode.getTextContentSize === "function") {
                        endOffset = lastContentNode.getTextContentSize()
                    } else if (typeof lastContentNode.getTextContent === "function") {
                        endOffset = lastContentNode.getTextContent().length
                    }
                    sel.anchor.set(lastContentNode.getKey(), endOffset, "text")
                    sel.focus.set(lastContentNode.getKey(), endOffset, "text")
                    $setSelection(sel)
                    return true
                } else if (tabNodes.length > 0) {
                    // Only tabs: place caret at end of last tab
                    const lastTabNode = tabNodes[0] // since we pushed from the end
                    const sel = lastTabNode.selectEnd()
                    $setSelection(sel)
                    return true
                } else {
                    // Empty line: select start of line node
                    const sel = lineNode.selectStart()
                    $setSelection(sel)
                    return true
                }
            },
            COMMAND_PRIORITY_CRITICAL,
        )
        const keyDownHandler = editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event) => {
                if (["ArrowRight", "ArrowLeft"].includes(event.key) && event.altKey) {
                    log("KEY_DOWN_COMMAND", event)
                    event.preventDefault()
                    // --- Alt+Arrow navigation logic ---
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return false

                    // Use focus for direction (caret for collapsed, focus for selection)
                    const node = selection.focus.getNode()
                    let lineNode = node
                    while (lineNode && !$isCodeLineNode(lineNode)) {
                        lineNode = lineNode.getParent()
                    }
                    if (!lineNode || !$isCodeLineNode(lineNode)) return false
                    const children = lineNode.getChildren()
                    if (children.length === 0) return false

                    // Find current token and offset
                    const tokenIdx = children.findIndex((child) => child.getKey() === node.getKey())
                    const offset = selection.focus.offset
                    // Helper: is at start or end of token
                    const nodeTextLength =
                        typeof node.getTextContentSize === "function"
                            ? node.getTextContentSize()
                            : typeof node.getTextContent === "function"
                              ? node.getTextContent().length
                              : 0
                    let isAtTokenStart = offset === 0
                    let isAtTokenEnd = offset === nodeTextLength

                    // Special handling for string tokens
                    let isStringToken = false
                    if ($isCodeHighlightNode(node)) {
                        const tokenType =
                            typeof node.getType === "function" ? node.getType() : undefined
                        const text = node.getTextContent()
                        isStringToken =
                            tokenType === "string" ||
                            (text.startsWith('"') && text.endsWith('"')) ||
                            (text.startsWith("'") && text.endsWith("'"))
                        if (isStringToken && text.length > 1) {
                            // If caret is just after opening quote, treat as start
                            if (offset === 1) isAtTokenStart = true
                            // If caret is just before closing quote, treat as end
                            if (offset === text.length - 1) isAtTokenEnd = true
                        }
                    }

                    // Directional logic
                    let targetNode = node
                    let targetOffset = offset
                    let found = false

                    if (event.key === "ArrowLeft") {
                        // Move to start of current token, or previous token
                        if (!isAtTokenStart) {
                            targetOffset = 0
                            found = true
                        } else {
                            // Find previous non-skippable token
                            for (let i = tokenIdx - 1; i >= 0; i--) {
                                if (!isSkippableToken(children[i])) {
                                    targetNode = children[i]
                                    targetOffset = 0
                                    found = true
                                    break
                                }
                            }
                            // If at start of line, try previous line
                            if (!found && tokenIdx === 0) {
                                const prevLine = lineNode.getPreviousSibling()
                                if (
                                    prevLine &&
                                    $isCodeLineNode(prevLine) &&
                                    prevLine.getChildren().length > 0
                                ) {
                                    const prevChildren = prevLine.getChildren()
                                    let lastIdx = prevChildren.length - 1
                                    while (
                                        lastIdx >= 0 &&
                                        isSkippableToken(prevChildren[lastIdx])
                                    ) {
                                        lastIdx--
                                    }
                                    if (lastIdx >= 0) {
                                        targetNode = prevChildren[lastIdx]
                                        targetOffset = 0
                                        found = true
                                    }
                                }
                            }
                        }
                    } else if (event.key === "ArrowRight") {
                        // Move to end of current token, or next token
                        if (!isAtTokenEnd) {
                            targetOffset = nodeTextLength
                            found = true
                        } else {
                            // Find next non-skippable token
                            for (let i = tokenIdx + 1; i < children.length; i++) {
                                if (!isSkippableToken(children[i])) {
                                    targetNode = children[i]
                                    targetOffset = 0
                                    found = true
                                    break
                                }
                            }
                            // If at end of line, try next line
                            if (!found && tokenIdx === children.length - 1) {
                                const nextLine = lineNode.getNextSibling()
                                if (
                                    nextLine &&
                                    $isCodeLineNode(nextLine) &&
                                    nextLine.getChildren().length > 0
                                ) {
                                    const nextChildren = nextLine.getChildren()
                                    let firstIdx = 0
                                    while (
                                        firstIdx < nextChildren.length &&
                                        isSkippableToken(nextChildren[firstIdx])
                                    ) {
                                        firstIdx++
                                    }
                                    if (firstIdx < nextChildren.length) {
                                        targetNode = nextChildren[firstIdx]
                                        targetOffset = 0
                                        found = true
                                    }
                                }
                            }
                        }
                    }

                    // Token-aware caret placement
                    if ($isCodeHighlightNode(targetNode)) {
                        const tokenType =
                            typeof targetNode.getType === "function"
                                ? targetNode.getType()
                                : undefined
                        const text = targetNode.getTextContent()
                        // If token is a string (by type or by quotes)
                        const isStringToken =
                            tokenType === "string" ||
                            (text.startsWith('"') && text.endsWith('"')) ||
                            (text.startsWith("'") && text.endsWith("'"))
                        if (isStringToken && text.length > 1) {
                            if (event.key === "ArrowLeft") {
                                // Place just after opening quote
                                targetOffset = 1
                            } else if (event.key === "ArrowRight") {
                                // Place just before closing quote
                                targetOffset = text.length - 1
                                if (targetOffset < 1) targetOffset = 1
                            }
                        } else if (isStringToken && text.length === 1) {
                            // Only quote, place after
                            targetOffset = 1
                        }
                    }

                    // Set selection
                    const sel = $createRangeSelection()
                    sel.anchor.set(targetNode.getKey(), targetOffset, "text")
                    sel.focus.set(targetNode.getKey(), targetOffset, "text")
                    $setSelection(sel)
                    return true
                }
                return false
            },
            COMMAND_PRIORITY_CRITICAL,
        )

        // LEFT ARROW
        const removeLeftHandler = editor.registerCommand(
            KEY_ARROW_LEFT_COMMAND,
            (event) => {
                event.preventDefault()
                const selection = $getSelection()
                if (!$isRangeSelection(selection)) {
                    return false
                }

                if (event.shiftKey) {
                    const anchorNode = selection.focus.getNode()
                    const offset = selection.focus.offset
                    const newPosition = $findNextValidPosition(anchorNode, offset, "left")

                    if (newPosition) {
                        // selection.focus.set(newPosition.node.getKey(), newPosition.offset, "text")
                        const newSelection = $createRangeSelection()
                        // return true
                        newSelection.anchor.set(
                            selection.anchor.getNode().getKey(),
                            selection.anchor.offset,
                            "text",
                        )
                        newSelection.focus.set(
                            newPosition.node.getKey(),
                            newPosition.offset,
                            "text",
                        )
                        $setSelection(newSelection)
                        log("Set new left selection position", {
                            nodeKey: newPosition.node.getKey(),
                            offset: newPosition.offset,
                        })
                    }
                    return true
                } else {
                    const anchorNode = selection.anchor.getNode()
                    const offset = selection.anchor.offset
                    log("Left arrow pressed", {
                        nodeKey: anchorNode.getKey(),
                        nodeType: anchorNode.getType(),
                        offset,
                        text: anchorNode.getTextContent(),
                    })
                    const newPosition = $findNextValidPosition(anchorNode, offset, "left")
                    log("LEFT ARROW newPosition", newPosition)
                    if (newPosition) {
                        const newSelection = $createRangeSelection()
                        newSelection.anchor.set(
                            newPosition.node.getKey(),
                            newPosition.offset,
                            "text",
                        )
                        newSelection.focus.set(
                            newPosition.node.getKey(),
                            newPosition.offset,
                            "text",
                        )
                        $setSelection(newSelection)
                        log("Set new left position", {
                            nodeKey: newPosition.node.getKey(),
                            offset: newPosition.offset,
                        })

                        return true
                    }
                }

                return false
            },
            COMMAND_PRIORITY_CRITICAL,
        )

        // RIGHT ARROW
        const removeRightHandler = editor.registerCommand(
            KEY_ARROW_RIGHT_COMMAND,
            (event) => {
                log("Right arrow pressed", event)
                event.preventDefault()
                const selection = $getSelection()
                if (!$isRangeSelection(selection)) {
                    return false
                }
                const anchorNode = selection.anchor.getNode()
                const offset = selection.anchor.offset
                log("Right arrow pressed", {
                    nodeKey: anchorNode.getKey(),
                    nodeType: anchorNode.getType(),
                    offset,
                    text: anchorNode.getTextContent(),
                })

                if (event.shiftKey) {
                    const anchorNode = selection.focus.getNode()
                    const offset = selection.focus.offset
                    const newPosition = $findNextValidPosition(anchorNode, offset, "right")

                    if (newPosition) {
                        // selection.focus.set(newPosition.node.getKey(), newPosition.offset, "text")
                        const newSelection = $createRangeSelection()
                        // return true
                        newSelection.anchor.set(
                            selection.anchor.getNode().getKey(),
                            selection.anchor.offset,
                            "text",
                        )
                        newSelection.focus.set(
                            newPosition.node.getKey(),
                            newPosition.offset,
                            "text",
                        )
                        $setSelection(newSelection)
                        log("Set new right selection position", {
                            nodeKey: newPosition.node.getKey(),
                            offset: newPosition.offset,
                        })
                    }
                    return true
                } else {
                    const newPosition = $findNextValidPosition(anchorNode, offset, "right")
                    log("RIGHT ARROW newPosition", newPosition)
                    if (newPosition) {
                        // Validate node/offset before setting selection
                        let valid = true
                        if (
                            typeof newPosition.offset !== "number" ||
                            !newPosition.node ||
                            typeof newPosition.node.getKey !== "function"
                        ) {
                            valid = false
                        }
                        // Additional: check if offset is in range for text nodes
                        if ($isCodeHighlightNode(newPosition.node)) {
                            const text = newPosition.node.getTextContent()
                            if (newPosition.offset < 0 || newPosition.offset > text.length) {
                                valid = false
                            }
                        }
                        log("About to set selection", {
                            valid,
                            nodeKey: newPosition.node.getKey(),
                            offset: newPosition.offset,
                            nodeType: newPosition.node.getType(),
                        })
                        if (valid) {
                            $setSelection(null)
                            const newSelection = $createRangeSelection()
                            newSelection.anchor.set(
                                newPosition.node.getKey(),
                                newPosition.offset,
                                "text",
                            )
                            newSelection.focus.set(
                                newPosition.node.getKey(),
                                newPosition.offset,
                                "text",
                            )
                            $setSelection(newSelection)
                            // Extra: log the state immediately after
                            const sel = $getSelection()
                            log("Selection after set", {
                                anchorKey: sel?.anchor?.key,
                                anchorOffset: sel?.anchor?.offset,
                                focusKey: sel?.focus?.key,
                                focusOffset: sel?.focus?.offset,
                                type: sel?.type,
                            })
                            log("Set new right position", {
                                nodeKey: newPosition.node.getKey(),
                                offset: newPosition.offset,
                            })
                            event.preventDefault()
                            return true
                        } else {
                            log("Invalid navigation target", newPosition)
                        }
                    }
                }
                return false
            },
            COMMAND_PRIORITY_CRITICAL,
        )

        return () => {
            removeLeftHandler()
            removeRightHandler()
            moveStartHandler()
            moveEndHandler()
            keyDownHandler()
        }
    }, [editor])

    return null
}

export default HorizontalNavigationPlugin
