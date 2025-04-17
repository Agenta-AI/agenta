/**
 * Utility functions for managing cursor position in the code editor.
 * These functions help maintain a consistent editing experience by
 * controlling where the cursor (caret) is placed after operations.
 */

import {$createRangeSelection, $isTabNode, $setSelection} from "lexical"

import {$isCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {CodeLineNode} from "../nodes/CodeLineNode"

/**
 * Moves the text cursor (caret) to the start of the first content node in a code line,
 * with special handling for indentation and empty lines.
 *
 * This function is used to position the cursor in a sensible location after operations
 * that might disrupt cursor position (like creating a new line). It:
 *
 * 1. Handles indentation by positioning the cursor after any tab nodes
 * 2. Prioritizes positioning at the first content node
 * 3. Creates a new range selection at the appropriate position
 * 4. Sets the editor's selection to that position
 *
 * The function specifically:
 * - Sets both anchor and focus points to the same position (no text selected)
 * - Uses the 'text' type to ensure proper cursor behavior in the editor
 * - Ensures caret visibility even in empty lines
 *
 * @param lineNode - The code line node to move the cursor within
 */
export function $moveCaretToStart(lineNode: CodeLineNode) {
    const children = lineNode.getChildren()
    
    // Get all tab nodes (indentation) at the start of the line
    const tabNodes = children.filter($isTabNode)
    
    // Find the first non-tab node (actual content)
    const firstContentNode = children.find(node => !$isTabNode(node))
    
    console.log("moveCaretToStart:", {
        childrenCount: children.length,
        tabNodesCount: tabNodes.length,
        hasContentNode: !!firstContentNode,
        childrenTypes: children.map(c => c.getType())
    })
    
    // Case 1: We have content after tabs - position cursor at start of content
    if (firstContentNode) {
        const sel = $createRangeSelection()
        sel.anchor.set(firstContentNode.getKey(), 0, "text")
        sel.focus.set(firstContentNode.getKey(), 0, "text")
        $setSelection(sel)
        return
    }
    
    // Case 2: We only have tab nodes - position cursor after the last tab
    if (tabNodes.length > 0) {
        const lastTabNode = tabNodes[tabNodes.length - 1]
        const sel = lastTabNode.selectEnd()
        $setSelection(sel)
        return
    }
    
    // Case 3: Empty line - position cursor at the line itself
    const sel = lineNode.selectStart()
    $setSelection(sel)
}
