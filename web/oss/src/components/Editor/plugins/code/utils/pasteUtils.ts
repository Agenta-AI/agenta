import {$createRangeSelection, $setSelection, $createTabNode} from "lexical"

import {$createCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$createCodeLineNode} from "../nodes/CodeLineNode"

import {normalizePastedLinesIndentation} from "./indentationUtils"
import {tokenizeCodeLine} from "./tokenizer"

/**
 * Inserts highlighted nodes (from syntax highlighter) into the code block at the correct place,
 * handling before/after cursor content, following lines, and restoring selection.
 */
export function $insertLinesWithSelectionAndIndent({
    lines,
    anchorNode,
    anchorOffset,
    currentLine,
    parentBlock,
}: {
    lines: string[]
    anchorNode: any
    anchorOffset: number
    currentLine: any
    parentBlock: any
    beforeNodes: any[]
    afterNodes: any[]
    beforeContent: string
    afterContent: string
    followingLines: any[]

    insertIndex?: number | null
}) {
    // 1. Find selection context and extract state
    if (!currentLine || !parentBlock) {
        console.error("[pasteUtils] Missing currentLine or parentBlock, aborting paste logic")
        return
    }
    const allLines = parentBlock.getChildren()
    console.log("[pasteUtils] parent block", {
        parentBlock,
        currentLine,
        allLinesLength: allLines.length,
        allLines,
    })
    const lineIdx = allLines.findIndex((n: any) => n.getKey && n.getKey() === currentLine.getKey())
    if (lineIdx === -1) {
        console.error("[pasteUtils] Could not find currentLine in parentBlock children")
        return
    }
    // Split lines
    const linesBefore = allLines.slice(0, lineIdx)
    const linesAfter = allLines.slice(lineIdx + 1)
    // Split currentLine nodes
    const children = currentLine.getChildren()
    const beforeInLine: any[] = []
    const afterInLine: any[] = []
    let found = false
    let cursorCount = 0

    // --- NEW: Compute base indentation from current line ---
    // Count leading tabs (or 2-space groups) in current line
    const currentLineText = currentLine.getTextContent()
    let baseIndentCount = 0
    const match = currentLineText.match(/^(\s*)/)
    if (match) {
        const tabCount = (match[1].match(/\t/g) || []).length
        const spaceCount = (match[1].match(/ /g) || []).length
        baseIndentCount = tabCount + Math.floor(spaceCount / 2)
    }
    // --- Normalize pasted lines ---
    lines = normalizePastedLinesIndentation(lines, baseIndentCount)

    // Find anchorNode in currentLine children, split at anchorOffset
    for (const node of children) {
        if (!found && node.getKey && anchorNode && node.getKey() === anchorNode.getKey()) {
            const text = node.getTextContent()
            beforeInLine.push((node.clone && node.clone()) || node)
            if (
                typeof anchorOffset === "number" &&
                anchorOffset > 0 &&
                anchorOffset < text.length
            ) {
                // Split node at anchorOffset
                const beforeText = text.slice(0, anchorOffset)
                const afterText = text.slice(anchorOffset)
                if (beforeText)
                    beforeInLine[beforeInLine.length - 1] = $createCodeHighlightNode(beforeText)
                if (afterText) {
                    if (node && typeof node.clone === "function") {
                        afterInLine.push(node.clone())
                    } else if (node) {
                        afterInLine.push(node)
                        console.warn("[pasteUtils] Node without .clone() in afterInLine", node)
                    } else {
                        console.warn("[pasteUtils] Skipping undefined/null node in afterInLine")
                    }
                    afterInLine[afterInLine.length - 1] = $createCodeHighlightNode(afterText)
                }
            } else if (anchorOffset === 0) {
                // All goes to afterInLine
                if (node && typeof node.clone === "function") {
                    afterInLine.push(node.clone())
                } else if (node) {
                    afterInLine.push(node)
                    console.warn("[pasteUtils] Node without .clone() in afterInLine", node)
                } else {
                    console.warn("[pasteUtils] Skipping undefined/null node in afterInLine")
                }
                beforeInLine.pop()
            }
            found = true
            cursorCount++
        } else if (!found) {
            if (node && typeof node.clone === "function") {
                beforeInLine.push(node.clone())
            } else if (node) {
                beforeInLine.push(node)
                console.warn("[pasteUtils] Node without .clone() in beforeInLine", node)
            } else {
                console.warn("[pasteUtils] Skipping undefined/null node in beforeInLine")
            }
        } else {
            if (node && typeof node.clone === "function") {
                afterInLine.push(node.clone())
            } else if (node) {
                afterInLine.push(node)
                console.warn("[pasteUtils] Node without .clone() in afterInLine", node)
            } else {
                console.warn("[pasteUtils] Skipping undefined/null node in afterInLine")
            }
        }
    }
    // Log state
    console.log("[pasteUtils] Function state", {
        linesBefore: linesBefore.map((l) => l.getTextContent()),
        nodesBeforeSelection: beforeInLine.map((n) => n.getTextContent()),
        nodesAfterSelection: afterInLine.map((n) => n.getTextContent()),
        trailingLines: linesAfter.map((l) => l.getTextContent()),
        pastedLines: lines,
        parentBlock,
        currentLine,
        // selection: selection.clone(),
    })

    // Clone trailing lines before removal
    const clonedTrailingLines = linesAfter.map((l) => (l.clone && l.clone()) || l)
    linesAfter.forEach((l) => l.remove && l.remove())
    // Remove current line
    currentLine.remove && currentLine.remove()
    // Insert new lines
    let insertIdx = lineIdx
    // First line: nodesBeforeSelection + first pasted line
    if (lines.length > 0) {
        const firstLine = $createNodeForLineWithTabs(lines[0], parentBlock.getLanguage())
        console.log("[pasteUtils] First line", firstLine.getTextContent())
        // Prepend beforeInLine nodes
        for (let i = beforeInLine.length - 1; i >= 0; i--) {
            console.log(
                "[pasteUtils] Inserting beforeInLine node",
                beforeInLine[i].getTextContent(),
            )
            firstLine.getFirstChild()?.insertBefore(beforeInLine[i])
        }
        console.log("[pasteUtils] INSERT FIRST LINE!", {
            insertIdx,
            parentBlock,
            children: parentBlock.getChildren(),
            text: firstLine
                .getChildren()
                .map((n) => n.getTextContent())
                .join(""),
        })
        const lineBefore = parentBlock.getChildAtIndex(insertIdx - 1)
        if (lineBefore) {
            lineBefore.insertAfter(firstLine)
        } else {
            parentBlock.append(firstLine)
        }

        insertIdx++
        let latestLine = firstLine
        console.log("[pasteUtils] HERE", lines)

        if (lines.length === 1) {
            afterInLine.forEach((n) => {
                console.log("[pasteUtils] Last pasted line", n.getTextContent())
                firstLine.append(n)
            })
        } else {
            // Middle lines
            for (let i = 1; i < lines.length; i++) {
                console.log("[pasteUtils] HERE 2")
                const lineNode = $createNodeForLineWithTabs(lines[i], parentBlock.getLanguage())
                // Last pasted line: append afterInLine nodes
                if (i === lines.length - 1 && afterInLine.length > 0) {
                    afterInLine.forEach((n) => {
                        console.log("[pasteUtils] Last pasted line", n.getTextContent())
                        lineNode.append(n)
                    })
                }
                latestLine.insertAfter(lineNode)
                latestLine = lineNode
                // parentBlock.insertBefore(lineNode, parentBlock.getChildAtIndex(insertIdx))
                insertIdx++
            }
        }
    } else {
        // No pasted lines, just keep before/after nodes as a new line
        const lineNode = $createCodeLineNode()
        beforeInLine.forEach((n) => lineNode.append(n))
        afterInLine.forEach((n) => lineNode.append(n))
        parentBlock.insertBefore(lineNode, parentBlock.getChildAtIndex(insertIdx))
        insertIdx++
    }

    // Add trailing lines (use clones)
    clonedTrailingLines.forEach((l, i) => {
        parentBlock.getChildAtIndex(insertIdx - 1 + i).insertAfter(l)
    })
    // Restore selection at end of last inserted line
    const lastInserted = parentBlock.getChildAtIndex(insertIdx - 1)
    if (lastInserted && typeof lastInserted.getLastChild === "function") {
        const lastChild = lastInserted.getLastChild()
        if (
            lastChild &&
            typeof lastChild.getKey === "function" &&
            typeof lastChild.getTextContentSize === "function"
        ) {
            const newSelection = $createRangeSelection()
            newSelection.anchor.set(lastChild.getKey(), lastChild.getTextContentSize(), "text")
            newSelection.focus.set(lastChild.getKey(), lastChild.getTextContentSize(), "text")
            $setSelection(newSelection)
            console.log("[pasteUtils] Restored selection at end of last inserted line", {
                lastInserted,
                lastChild,
            })
        }
    }
    // LOG: Final state
    console.log("[pasteUtils] $insertLinesWithSelectionAndIndent: complete", {
        parentBlock,
        parentBlockChildren:
            parentBlock &&
            parentBlock.getChildren &&
            parentBlock.getChildren().map((n: any) => n.getTextContent && n.getTextContent()),
    })
}

export function $createNodeForLineWithTabs(line: string, language: "json" | "yaml") {
    const codeLine = $createCodeLineNode()
    // Extract leading spaces/tabs
    const indentMatch = line.match(/^[ \t]+/)
    let rest = line
    if (indentMatch) {
        const indent = indentMatch[0]
        rest = line.slice(indent.length)
        // Assume 2 spaces = 1 tab for JSON
        const tabSize = 2
        let i = 0
        while (i < indent.length) {
            if (indent[i] === "\t") {
                codeLine.append($createTabNode())
                i += 1
            } else if (indent[i] === " ") {
                // Count consecutive spaces
                let spaceCount = 0
                while (indent[i + spaceCount] === " ") spaceCount++
                const tabs = Math.floor(spaceCount / tabSize)
                for (let t = 0; t < tabs; t++) {
                    codeLine.append($createTabNode())
                }
                i += tabs * tabSize
                // If any leftover spaces, append as plain
                for (; i < indent.length && indent[i] === " "; i++) {
                    codeLine.append($createTabNode())
                }
            }
        }
    }
    // Tokenize the rest of the line
    const tokens = tokenizeCodeLine(rest, language)
    tokens.forEach((token) => {
        codeLine.append($createCodeHighlightNode(token.content, token.type))
    })
    return codeLine
}

/** @deprecated renamed to {@link $insertLinesWithSelectionAndIndent} by @lexical/eslint-plugin rules-of-lexical */
export const insertLinesWithSelectionAndIndent = $insertLinesWithSelectionAndIndent
