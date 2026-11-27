/**
 * Navigation helpers shared among plugins.
 */

import {$isTextNode, TextNode} from "lexical"

import {CodeLineNode} from "../nodes/CodeLineNode"

/**
 * Given a CodeLineNode and a character offset counted across its children,
 * returns the TextNode that contains the offset and the offset inside that
 * node. Falls back to last text node if offset exceeds total length.
 */
export function getNodeAtOffset(
    line: CodeLineNode,
    offset: number,
): {node: TextNode | null; innerOffset: number} {
    let acc = 0
    let lastText: TextNode | null = null

    for (const child of line.getChildren()) {
        if (!$isTextNode(child)) continue
        const len = child.getTextContentSize()
        lastText = child
        if (acc + len >= offset) {
            return {node: child, innerOffset: offset - acc}
        }
        acc += len
    }
    // If not found return last text node
    return {node: lastText, innerOffset: lastText ? lastText.getTextContentSize() : 0}
}
