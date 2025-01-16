/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * This file is adapted from Meta's Lexical project:
 * https://github.com/facebook/lexical
 */

import {$isLineBreakNode, $isTabNode, LexicalNode} from "lexical"
import {$isCodeHighlightNode} from "../../CodeHighlightNode"

function isEqual(nodeA: LexicalNode, nodeB: LexicalNode): boolean {
    // Only checking for code higlight nodes, tabs and linebreaks. If it's regular text node
    // returning false so that it's transformed into code highlight node
    return (
        ($isCodeHighlightNode(nodeA) &&
            $isCodeHighlightNode(nodeB) &&
            nodeA.__text === nodeB.__text &&
            nodeA.__highlightType === nodeB.__highlightType) ||
        ($isTabNode(nodeA) && $isTabNode(nodeB)) ||
        ($isLineBreakNode(nodeA) && $isLineBreakNode(nodeB))
    )
}

// Finds minimal diff range between two nodes lists. It returns from/to range boundaries of prevNodes
// that needs to be replaced with `nodes` (subset of nextNodes) to make prevNodes equal to nextNodes.
export function getDiffRange(
    prevNodes: Array<LexicalNode>,
    nextNodes: Array<LexicalNode>,
): {
    from: number
    nodesForReplacement: Array<LexicalNode>
    to: number
} {
    let leadingMatch = 0
    while (leadingMatch < prevNodes.length) {
        if (!isEqual(prevNodes[leadingMatch], nextNodes[leadingMatch])) {
            break
        }
        leadingMatch++
    }

    const prevNodesLength = prevNodes.length
    const nextNodesLength = nextNodes.length
    const maxTrailingMatch = Math.min(prevNodesLength, nextNodesLength) - leadingMatch

    let trailingMatch = 0
    while (trailingMatch < maxTrailingMatch) {
        trailingMatch++
        if (
            !isEqual(
                prevNodes[prevNodesLength - trailingMatch],
                nextNodes[nextNodesLength - trailingMatch],
            )
        ) {
            trailingMatch--
            break
        }
    }

    const from = leadingMatch
    const to = prevNodesLength - trailingMatch
    const nodesForReplacement = nextNodes.slice(leadingMatch, nextNodesLength - trailingMatch)
    return {
        from,
        nodesForReplacement,
        to,
    }
}
