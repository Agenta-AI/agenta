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
    $createLineBreakNode,
    $createTabNode,
    $isLineBreakNode,
    $isTabNode,
    LexicalNode,
    LineBreakNode,
    TabNode,
} from "lexical"
import {
    $createCodeHighlightNode,
    $isCodeHighlightNode,
    CodeHighlightNode,
    getLastCodeNodeOfLine,
} from "../../CodeHighlightNode"
import invariant from "./invariant"
import {Token} from "./types"

export function getStartOfCodeInLine(
    anchor: CodeHighlightNode | TabNode,
    offset: number,
): null | {
    node: CodeHighlightNode | TabNode | LineBreakNode
    offset: number
} {
    let last: null | {
        node: CodeHighlightNode | TabNode | LineBreakNode
        offset: number
    } = null
    let lastNonBlank: null | {node: CodeHighlightNode; offset: number} = null
    let node: null | CodeHighlightNode | TabNode | LineBreakNode = anchor
    let nodeOffset = offset
    let nodeTextContent = anchor.getTextContent()

    while (true) {
        if (nodeOffset === 0) {
            node = node.getPreviousSibling()
            if (node === null) {
                break
            }
            invariant(
                $isCodeHighlightNode(node) || $isTabNode(node) || $isLineBreakNode(node),
                "Expected a valid Code Node: CodeHighlightNode, TabNode, LineBreakNode",
            )
            if ($isLineBreakNode(node)) {
                last = {
                    node,
                    offset: 1,
                }
                break
            }
            nodeOffset = Math.max(0, node.getTextContentSize() - 1)
            nodeTextContent = node.getTextContent()
        } else {
            nodeOffset--
        }
        const character = nodeTextContent[nodeOffset]
        if ($isCodeHighlightNode(node) && character !== " ") {
            lastNonBlank = {
                node,
                offset: nodeOffset,
            }
        }
    }
    // lastNonBlank !== null: anchor in the middle of code; move to line beginning
    if (lastNonBlank !== null) {
        return lastNonBlank
    }
    // Spaces, tabs or nothing ahead of anchor
    let codeCharacterAtAnchorOffset = null
    if (offset < anchor.getTextContentSize()) {
        if ($isCodeHighlightNode(anchor)) {
            codeCharacterAtAnchorOffset = anchor.getTextContent()[offset]
        }
    } else {
        const nextSibling = anchor.getNextSibling()
        if ($isCodeHighlightNode(nextSibling)) {
            codeCharacterAtAnchorOffset = nextSibling.getTextContent()[0]
        }
    }
    if (codeCharacterAtAnchorOffset !== null && codeCharacterAtAnchorOffset !== " ") {
        // Borderline whitespace and code, move to line beginning
        return last
    } else {
        const nextNonBlank = findNextNonBlankInLine(anchor, offset)
        if (nextNonBlank !== null) {
            return nextNonBlank
        } else {
            return last
        }
    }
}

export function findNextNonBlankInLine(
    anchor: LexicalNode,
    offset: number,
): null | {node: CodeHighlightNode; offset: number} {
    let node: null | LexicalNode = anchor
    let nodeOffset = offset
    let nodeTextContent = anchor.getTextContent()
    let nodeTextContentSize = anchor.getTextContentSize()
    while (true) {
        if (!$isCodeHighlightNode(node) || nodeOffset === nodeTextContentSize) {
            node = node.getNextSibling()
            if (node === null || $isLineBreakNode(node)) {
                return null
            }
            if ($isCodeHighlightNode(node)) {
                nodeOffset = 0
                nodeTextContent = node.getTextContent()
                nodeTextContentSize = node.getTextContentSize()
            }
        }
        if ($isCodeHighlightNode(node)) {
            if (nodeTextContent[nodeOffset] !== " ") {
                return {
                    node,
                    offset: nodeOffset,
                }
            }
            nodeOffset++
        }
    }
}

export function getEndOfCodeInLine(
    anchor: CodeHighlightNode | TabNode,
): CodeHighlightNode | TabNode {
    const lastNode = getLastCodeNodeOfLine(anchor)
    invariant(!$isLineBreakNode(lastNode), "Unexpected lineBreakNode in getEndOfCodeInLine")
    return lastNode
}

export function $getHighlightNodes(tokens: Array<string | Token>, type?: string): LexicalNode[] {
    const nodes: LexicalNode[] = []

    for (const token of tokens) {
        if (typeof token === "string") {
            const partials = token.split(/(\n|\t)/)
            const partialsLength = partials.length
            for (let i = 0; i < partialsLength; i++) {
                const part = partials[i]
                if (part === "\n" || part === "\r\n") {
                    nodes.push($createLineBreakNode())
                } else if (part === "\t") {
                    nodes.push($createTabNode())
                } else if (part.length > 0) {
                    nodes.push($createCodeHighlightNode(part, type))
                }
            }
        } else {
            const {content} = token
            if (typeof content === "string") {
                nodes.push(...$getHighlightNodes([content], token.type))
            } else if (Array.isArray(content)) {
                nodes.push(...$getHighlightNodes(content, token.type))
            }
        }
    }

    return nodes
}
