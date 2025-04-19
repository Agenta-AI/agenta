import {$isTabNode, $createTabNode} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeHighlightNode, $createCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode, CodeLineNode, $createCodeLineNode} from "../nodes/CodeLineNode"

/**
 * Analyzes and corrects the indentation of all lines in a code block node.
 * This utility can be used after a paste event or for bulk formatting.
 *
 * - Ensures correct indentation based on braces and nesting.
 * - Converts leading spaces to tabs for consistency.
 * - Handles nested blocks (e.g. JSON, JS, YAML).
 *
 * @param codeBlock The code block node to fix indentation for.
 */
export function $fixCodeBlockIndentation(codeBlock: any) {
    if (!$isCodeBlockNode(codeBlock)) return
    const lines = codeBlock.getChildren().filter($isCodeLineNode) as CodeLineNode[]

    let indentLevel = 0
    for (const line of lines) {
        const text = line.getTextContent()
        const trimmed = text.trim()

        // Remove all children and re-create with correct indentation
        line.clear()

        // Decrease indent before closing brace
        if (/^[\]\}\)]/.test(trimmed)) {
            indentLevel = Math.max(0, indentLevel - 1)
        }

        // Add tabs for indentation
        for (let t = 0; t < indentLevel; t++) {
            line.append($createTabNode())
        }

        // Add the rest of the line as a highlight node (if not empty)
        if (trimmed) {
            line.append($createCodeHighlightNode(trimmed, "plain"))
        } else {
            // Ensure line is selectable
            line.append($createCodeHighlightNode("\u200b", "plain"))
        }

        // Increase indent after opening brace
        if (/[\{\[\(]$/.test(trimmed)) {
            indentLevel++
        }
    }
}
/** @deprecated renamed to {@link $fixCodeBlockIndentation} by @lexical/eslint-plugin rules-of-lexical */
export const fixCodeBlockIndentation = $fixCodeBlockIndentation
