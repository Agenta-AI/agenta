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
    $isRangeSelection,
    LexicalEditor,
    ElementNode,
    TextNode,
} from "lexical"
import {$isCodeNode, CodeNode} from "../../CodeNode"
import {$isCodeLineNode, CodeLineNode} from "../../CodeLineNode"
import {Tokenizer} from "./types"
import {$updateAndRetainSelection} from "./selection"
import {$getHighlightNodes} from "./helpers"
import {getDiffRange} from "./diff"

const nodesCurrentlyHighlighting = new Set()

export function codeNodeTransform(node: CodeNode, editor: LexicalEditor, tokenizer: Tokenizer) {
    const nodeKey = node.getKey()

    if (nodesCurrentlyHighlighting.has(nodeKey)) {
        return
    }

    nodesCurrentlyHighlighting.add(nodeKey)

    // When new code block inserted it might not have language selected
    if (node.getLanguage() === undefined) {
        node.setLanguage(tokenizer.defaultLanguage)
    }

    // Using nested update call to pass `skipTransforms` since we don't want
    // each individual codehighlight node to be transformed again as it's already
    // in its final state
    editor.update(
        () => {
            $updateAndRetainSelection(nodeKey, () => {
                const currentNode = $getNodeByKey(nodeKey)
                const selection = $getSelection()

                if (!$isRangeSelection(selection)) {
                    return false
                }

                let anchor: ElementNode | TextNode | null = selection.anchor.getNode()
                while (anchor && !$isCodeLineNode(anchor)) {
                    anchor = anchor.getParent()
                }

                if (!$isCodeNode(currentNode) || !currentNode.isAttached() || !anchor) {
                    return false
                }

                const getLineTextContext = (line: CodeLineNode, language: string) => {
                    const code = line.getTextContent()
                    const tokens = tokenizer.tokenize(code, language)
                    const highlightNodes = $getHighlightNodes(tokens)
                    const diffRange = getDiffRange(line.getChildren(), highlightNodes)
                    const {from, to, nodesForReplacement} = diffRange

                    if (from !== to || nodesForReplacement.length) {
                        line.splice(from, to - from, nodesForReplacement)
                        return true
                    }
                    return false
                }

                const hasChanges = getLineTextContext(
                    anchor as CodeLineNode,
                    currentNode.getLanguage() || tokenizer.defaultLanguage,
                )

                return hasChanges
            })
        },
        {
            onUpdate: () => {
                nodesCurrentlyHighlighting.delete(nodeKey)
            },
            skipTransforms: true,
        },
    )
}
