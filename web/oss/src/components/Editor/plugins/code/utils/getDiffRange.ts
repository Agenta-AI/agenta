import {LexicalNode} from "lexical"

import {$isBase64Node} from "../nodes/Base64Node"
import {$isCodeHighlightNode} from "../nodes/CodeHighlightNode"

/**
 * Checks if two nodes (CodeHighlightNode or Base64Node) are semantically equal.
 *
 * Two nodes are considered equal if they have:
 * 1. The same text content
 * 2. The same type (both highlight or both base64)
 * 3. For highlight nodes: same highlight type, validation error state, and message
 *
 * @param a - First node to compare
 * @param b - Second node to compare
 * @returns true if nodes are equal, false otherwise
 */
export function isEqual(a: LexicalNode, b: LexicalNode): boolean {
    // Both must be the same type
    const aIsBase64 = $isBase64Node(a)
    const bIsBase64 = $isBase64Node(b)

    if (aIsBase64 !== bIsBase64) {
        return false
    }

    // For Base64Nodes, just compare text content
    if (aIsBase64 && bIsBase64) {
        return a.getTextContent() === b.getTextContent()
    }

    // For CodeHighlightNodes, compare all properties
    if ($isCodeHighlightNode(a) && $isCodeHighlightNode(b)) {
        return (
            a.getTextContent() === b.getTextContent() &&
            (a.getHighlightType?.() ?? "") === (b.getHighlightType?.() ?? "") &&
            a.hasValidationError() === b.hasValidationError() &&
            (a.getValidationMessage() ?? null) === (b.getValidationMessage() ?? null)
        )
    }

    // Fallback: compare text content only
    return a.getTextContent() === b.getTextContent()
}

/**
 * Calculates the minimal range of nodes that need to be replaced when updating syntax highlighting.
 *
 * This function implements a diff algorithm that:
 * 1. Finds matching nodes at the start (leading matches)
 * 2. Finds matching nodes at the end (trailing matches)
 * 3. Determines the minimal range of nodes that need to be replaced
 *
 * The algorithm optimizes updates by only replacing the nodes that have actually changed,
 * preserving nodes at the start and end that remain the same. This is particularly
 * important for performance when editing large code blocks.
 *
 * For example, if we have:
 * prev: [A, B, C, D, E]
 * next: [A, B, X, Y, E]
 * The function will return:
 * - from: 2 (start replacing after B)
 * - to: 4 (stop replacing before E)
 * - nodesForReplacement: [X, Y]
 *
 * @param prev - Array of existing nodes (CodeHighlightNode or Base64Node)
 * @param next - Array of new nodes to replace with
 * @returns Object containing:
 *   - from: Index to start replacing nodes from
 *   - to: Index to stop replacing nodes at
 *   - nodesForReplacement: New nodes to insert in the range
 */
export function getDiffRange(
    prev: LexicalNode[],
    next: LexicalNode[],
): {from: number; to: number; nodesForReplacement: LexicalNode[]} {
    let leadingMatch = 0
    while (leadingMatch < prev.length && isEqual(prev[leadingMatch], next[leadingMatch])) {
        leadingMatch++
    }

    const maxTrailingMatch = Math.min(prev.length, next.length) - leadingMatch
    let trailingMatch = 0
    while (trailingMatch < maxTrailingMatch) {
        if (
            !isEqual(prev[prev.length - 1 - trailingMatch], next[next.length - 1 - trailingMatch])
        ) {
            break
        }
        trailingMatch++
    }

    const from = leadingMatch
    const to = prev.length - trailingMatch
    const nodesForReplacement = next.slice(leadingMatch, next.length - trailingMatch)
    return {from, to, nodesForReplacement}
}
