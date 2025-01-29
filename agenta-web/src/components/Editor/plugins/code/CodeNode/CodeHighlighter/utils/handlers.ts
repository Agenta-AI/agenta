/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * This file is adapted from Meta's Lexical project:
 * https://github.com/facebook/lexical
 */

import {
    $createTabNode,
    $getSelection,
    $isLineBreakNode,
    $isRangeSelection,
    $isTabNode,
    INDENT_CONTENT_COMMAND,
    KEY_ARROW_UP_COMMAND,
    LexicalCommand,
    LineBreakNode,
    MOVE_TO_START,
    OUTDENT_CONTENT_COMMAND,
    TabNode,
    TextNode,
} from "lexical"
import {
    $isCodeHighlightNode,
    CodeHighlightNode,
    getFirstCodeNodeOfLine,
    getLastCodeNodeOfLine,
} from "../../CodeHighlightNode"
import {$isCodeLineNode} from "../../CodeLineNode"
import {$isSelectionInCode} from "./selection"
import {getEndOfCodeInLine, getStartOfCodeInLine} from "./helpers"

export function $handleTab(shiftKey: boolean): null | LexicalCommand<void> {
    const selection = $getSelection()
    if (!$isSelectionInCode(selection)) {
        return null
    }
    return shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND
}

export function $handleMultilineIndent(type: LexicalCommand<void>): boolean {
    const selection = $getSelection()
    if (!$isSelectionInCode(selection)) {
        return false
    }
    const nodes = selection?.getNodes() || []
    nodes.forEach((node) => {
        if ($isCodeLineNode(node)) {
            node.getChildren().forEach((child) => {
                if (child instanceof TextNode) {
                    if (type === INDENT_CONTENT_COMMAND) {
                        child.insertBefore($createTabNode())
                    } else if (type === OUTDENT_CONTENT_COMMAND) {
                        const text = child.getTextContent()
                        if (text.startsWith("\t")) {
                            child.setTextContent(text.slice(1))
                        }
                    }
                }
            })
        }
    })
    return true
}

export function $handleShiftLines(
    type: LexicalCommand<KeyboardEvent>,
    event: KeyboardEvent,
): boolean {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) {
        return false
    }

    const {anchor, focus} = selection
    const anchorOffset = anchor.offset
    const focusOffset = focus.offset
    const arrowIsUp = type === KEY_ARROW_UP_COMMAND

    if (!$isSelectionInCode(selection)) {
        return false
    }

    if (!event.altKey) {
        if (selection.isCollapsed()) {
            const codeNode = anchor.getNode().getParentOrThrow()
            if (arrowIsUp && anchorOffset === 0 && anchor.getNode().getPreviousSibling() === null) {
                const codeNodeSibling = codeNode.getPreviousSibling()
                if (codeNodeSibling === null) {
                    codeNode.selectPrevious()
                    event.preventDefault()
                    return true
                }
            } else if (
                !arrowIsUp &&
                anchorOffset === anchor.getNode().getTextContentSize() &&
                anchor.getNode().getNextSibling() === null
            ) {
                const codeNodeSibling = codeNode.getNextSibling()
                if (codeNodeSibling === null) {
                    codeNode.selectNext()
                    event.preventDefault()
                    return true
                }
            }
        }
        return false
    }

    let start: CodeHighlightNode | TabNode | LineBreakNode | null = null
    let end: CodeHighlightNode | TabNode | LineBreakNode | null = null
    const anchorNode = anchor.getNode()
    const focusNode = focus.getNode()
    if (
        $isCodeHighlightNode(anchorNode) ||
        $isTabNode(anchorNode) ||
        $isLineBreakNode(anchorNode)
    ) {
        start = getFirstCodeNodeOfLine(anchorNode)
    }
    if ($isCodeHighlightNode(focusNode) || $isTabNode(focusNode) || $isLineBreakNode(focusNode)) {
        end = getLastCodeNodeOfLine(focusNode)
    }

    if (start == null || end == null) {
        return false
    }

    const range = start.getNodesBetween(end)
    for (let i = 0; i < range.length; i++) {
        const node = range[i]
        if (!$isCodeHighlightNode(node) && !$isTabNode(node) && !$isLineBreakNode(node)) {
            return false
        }
    }

    event.preventDefault()
    event.stopPropagation()

    const linebreak = arrowIsUp ? start.getPreviousSibling() : end.getNextSibling()
    if (!$isLineBreakNode(linebreak)) {
        return true
    }
    const sibling = arrowIsUp ? linebreak.getPreviousSibling() : linebreak.getNextSibling()
    if (sibling == null) {
        return true
    }

    const maybeInsertionPoint =
        $isCodeHighlightNode(sibling) || $isTabNode(sibling) || $isLineBreakNode(sibling)
            ? arrowIsUp
                ? getFirstCodeNodeOfLine(sibling)
                : getLastCodeNodeOfLine(sibling)
            : null
    let insertionPoint = maybeInsertionPoint != null ? maybeInsertionPoint : sibling
    linebreak.remove()
    range.forEach((node) => node.remove())
    if (type === KEY_ARROW_UP_COMMAND) {
        range.forEach((node) => insertionPoint.insertBefore(node))
        insertionPoint.insertBefore(linebreak)
    } else {
        insertionPoint.insertAfter(linebreak)
        insertionPoint = linebreak
        range.forEach((node) => {
            insertionPoint.insertAfter(node)
            insertionPoint = node
        })
    }

    if (anchorNode instanceof TextNode && focusNode instanceof TextNode) {
        selection.setTextNodeRange(anchorNode, anchorOffset, focusNode, focusOffset)
    }

    return true
}

export function $handleMoveTo(type: LexicalCommand<KeyboardEvent>, event: KeyboardEvent): boolean {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) {
        return false
    }

    const {focus} = selection
    const focusNode = focus.getNode()
    const isMoveToStart = type === MOVE_TO_START

    if (!$isSelectionInCode(selection)) {
        return false
    }

    if (isMoveToStart) {
        const start = getStartOfCodeInLine(focusNode as CodeHighlightNode | TabNode, focus.offset)
        if (start !== null) {
            const {node, offset} = start
            if ($isLineBreakNode(node)) {
                node.selectNext(0, 0)
            } else {
                selection.setTextNodeRange(node, offset, node, offset)
            }
        } else {
            focusNode.getParentOrThrow().selectStart()
        }
    } else {
        const node = getEndOfCodeInLine(focusNode as CodeHighlightNode | TabNode)
        node.select()
    }

    event.preventDefault()
    event.stopPropagation()

    return true
}
