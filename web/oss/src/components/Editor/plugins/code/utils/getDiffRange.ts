import {LexicalNode} from "lexical"

import {CodeHighlightNode} from "../nodes/CodeHighlightNode"

/**
 * Checks if two CodeHighlightNodes are semantically equal.
 *
 * Two nodes are considered equal if they have:
 * 1. The same text content
 * 2. The same highlight type (or both have no highlight type)
 *
 * The optional chaining (?.) is used because highlight type may be undefined,
 * in which case we default to empty string for comparison.
 *
 * @param a - First CodeHighlightNode to compare
 * @param b - Second CodeHighlightNode to compare
 * @returns true if nodes are equal, false otherwise
 */
export function isEqual(a: CodeHighlightNode, b: CodeHighlightNode): boolean {
    return (
        a.getTextContent() === b.getTextContent() &&
        (a.getHighlightType?.() ?? "") === (b.getHighlightType?.() ?? "")
    )
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
 * @param prev - Array of existing CodeHighlightNodes
 * @param next - Array of new CodeHighlightNodes to replace with
 * @returns Object containing:
 *   - from: Index to start replacing nodes from
 *   - to: Index to stop replacing nodes at
 *   - nodesForReplacement: New nodes to insert in the range
 */
export function getDiffRange(
    prev: CodeHighlightNode[],
    next: CodeHighlightNode[],
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
