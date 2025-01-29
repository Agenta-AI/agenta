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
    $getNodeByKey,
    $getSelection,
    $isLineBreakNode,
    $isRangeSelection,
    $isTextNode,
    BaseSelection,
    NodeKey,
} from "lexical"
import {$isCodeNode} from "../../CodeNode"
import {$isCodeLineNode} from "../../CodeLineNode"

export function $isSelectionInCode(selection: null | BaseSelection): boolean {
    if (!$isRangeSelection(selection)) {
        return false
    }
    const anchorNode = selection.anchor.getNode()
    const focusNode = selection.focus.getNode()

    if (anchorNode.is(focusNode) && $isCodeNode(anchorNode)) {
        return true
    }
    const anchorParent = anchorNode.getParent()
    return $isCodeNode(anchorParent) && anchorParent.is(focusNode.getParent())
}

// Wrapping update function into selection retainer, that tries to keep cursor at the same
// position as before.
export function $updateAndRetainSelection(nodeKey: NodeKey, updateFn: () => boolean): void {
    const node = $getNodeByKey(nodeKey)
    if (!$isCodeNode(node) || !node.isAttached()) {
        return
    }
    const selection = $getSelection()
    // If it's not range selection (or null selection) there's no need to change it,
    // but we can still run highlighting logic
    if (!$isRangeSelection(selection)) {
        updateFn()
        return
    }

    const anchor = selection.anchor
    const anchorOffset = anchor.offset
    const selectionParentLine = anchor.getNode().getParent()

    if (!$isCodeLineNode(selectionParentLine)) {
        return
    }

    const isNewLineAnchor =
        anchor.type === "element" &&
        $isLineBreakNode(selectionParentLine.getChildAtIndex(anchorOffset - 1))
    let textOffset = 0

    // Calculating previous text offset (all text node prior to anchor + anchor own text offset)
    if (!isNewLineAnchor) {
        const anchorNode = anchor.getNode()
        textOffset =
            anchorOffset +
            anchorNode.getPreviousSiblings().reduce((offset, _node) => {
                return offset + _node.getTextContentSize()
            }, 0)
    }

    const hasChanges = updateFn()
    if (!hasChanges) {
        return
    }

    // Non-text anchors only happen for line breaks, otherwise
    // selection will be within text node (code highlight node)
    if (isNewLineAnchor) {
        anchor.getNode().select(anchorOffset, anchorOffset)
        return
    }

    // If it was non-element anchor then we walk through child nodes
    // and looking for a position of original text offset
    selectionParentLine.getChildren().some((_node) => {
        const isText = $isTextNode(_node)
        if (isText || $isLineBreakNode(_node)) {
            const textContentSize = _node.getTextContentSize()
            if (isText && textContentSize >= textOffset) {
                _node.select(textOffset, textOffset)
                return true
            }
            textOffset -= textContentSize
        }
        return false
    })
}
