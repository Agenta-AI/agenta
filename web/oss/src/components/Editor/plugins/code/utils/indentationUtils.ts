import {$createTabNode} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"

/**
 * Normalizes pasted lines to the target indentation level.
 *
 * - Strips minimum indentation from all pasted lines (so their relative structure is preserved)
 * - Prepends the given number of tabs to each line, so the pasted block is indented at the insertion context
 *
 * @param pastedLines The array of pasted lines (strings)
 * @param baseIndentCount The indentation level (number of tabs) to prepend to each line
 * @returns The array of lines with normalized indentation
 */
export function normalizePastedLinesIndentation(
    pastedLines: string[],
    baseIndentCount: number,
): string[] {
    // Find min indentation (in tabs or spaces) across all non-empty lines
    let minIndent = Infinity
    for (const line of pastedLines) {
        if (!line.trim()) continue
        const match = line.match(/^(\s*)/)
        if (match) {
            // Count tabs as 1, 2 spaces as 1 tab (for mixed content)
            const tabCount = (match[1].match(/\t/g) || []).length
            const spaceCount = (match[1].match(/ /g) || []).length
            const total = tabCount + Math.floor(spaceCount / 2)
            if (total < minIndent) minIndent = total
        }
    }
    if (!isFinite(minIndent)) minIndent = 0

    // Remove minIndent from each line and prepend baseIndentCount tabs
    return pastedLines.map((line) => {
        if (!line.trim()) return ""
        // Remove minIndent tabs/spaces
        let l = line
        let removed = 0
        while (removed < minIndent && l.startsWith("\t")) {
            l = l.slice(1)
            removed++
        }
        while (removed < minIndent && l.startsWith("  ")) {
            // two spaces
            l = l.slice(2)
            removed++
        }
        // Prepend baseIndentCount tabs
        return "\t".repeat(baseIndentCount) + l
    })
}

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
        const children = line.getChildren()
        // Count current leading tab nodes
        let currentTabs = 0
        for (const child of children) {
            // $isTabNode is from lexical, but not always imported. Use type or class check if needed.
            if (child.getType && child.getType() === "tab") {
                currentTabs++
            } else {
                break
            }
        }

        // Decrease indent before closing brace
        const text = line.getTextContent()
        const trimmed = text.trim()
        if (/^[\]\}\)]/.test(trimmed)) {
            indentLevel = Math.max(0, indentLevel - 1)
        }

        // Adjust tab nodes at the start
        if (currentTabs < indentLevel) {
            // Add missing tabs at the start
            for (let t = 0; t < indentLevel - currentTabs; t++) {
                const tabNode = $createTabNode()
                // Always add as a child of the line
                const updatedChildren = line.getChildren()
                if (updatedChildren.length > 0) {
                    updatedChildren[0].insertBefore(tabNode)
                } else {
                    line.append(tabNode)
                }
            }
        } else if (currentTabs > indentLevel) {
            // Remove excess tabs
            for (let t = 0; t < currentTabs - indentLevel; t++) {
                children[t].remove()
            }
        }

        // Increase indent after opening brace
        if (/[\{\[\(]$/.test(trimmed)) {
            indentLevel++
        }
    }
}

/** @deprecated renamed to {@link $fixCodeBlockIndentation} by @lexical/eslint-plugin rules-of-lexical */
export const fixCodeBlockIndentation = $fixCodeBlockIndentation
