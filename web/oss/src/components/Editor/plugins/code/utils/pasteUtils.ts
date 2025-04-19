import {$createRangeSelection, $setSelection, $getRoot, $isRangeSelection} from "lexical"

import {$isCodeBlockNode, $createCodeBlockNode} from "../nodes/CodeBlockNode"
import {$createCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$createCodeLineNode} from "../nodes/CodeLineNode"

import {tokenizeCodeLine} from "./tokenizer"

/**
 * Inserts highlighted nodes (from syntax highlighter) into the code block at the correct place,
 * handling before/after cursor content, following lines, and restoring selection.
 */
export function $insertLinesWithSelectionAndIndent({
    lines,
    createNodeForLine,
    selection,
    anchorNode,
    anchorOffset,
    currentLine,
    parentBlock,
    beforeNodes,
    afterNodes,
    beforeContent,
    afterContent,
    followingLines,
    editor,
    insertIndex = null,
}: {
    lines: string[]
    createNodeForLine: (line: string, idx: number) => any
    selection: any
    anchorNode: any
    anchorOffset: number
    currentLine: any
    parentBlock: any
    beforeNodes: any[]
    afterNodes: any[]
    beforeContent: string
    afterContent: string
    followingLines: any[]
    editor: any
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
        console.log("firstLine", firstLine.getChildren(), beforeInLine)
        // Prepend beforeInLine nodes
        for (let i = 0; i < beforeInLine.length; i++) {
            firstLine.getFirstChild()?.insertBefore(beforeInLine[i])
            // firstLine.insertBefore(beforeInLine[i], firstLine.getFirstChild())
        }
        console.log(
            "INSERT FIRST LINE!",
            insertIdx,
            parentBlock,
            parentBlock.getChildren(),
            parentBlock.getChildAtIndex(insertIdx),
            parentBlock.getChildAtIndex(insertIdx - 1),
            firstLine,
        )
        const lineBefore = parentBlock.getChildAtIndex(insertIdx - 1)
        if (lineBefore) {
            lineBefore.insertAfter(firstLine)
        } else {
            parentBlock.append(firstLine)
        }

        insertIdx++
        let latestLine = firstLine
        // Middle lines
        for (let i = 1; i < lines.length; i++) {
            const lineNode = $createNodeForLineWithTabs(lines[i], parentBlock.getLanguage())
            // Last pasted line: append afterInLine nodes
            if (i === lines.length - 1 && afterInLine.length > 0) {
                afterInLine.forEach((n) => lineNode.append(n))
            }
            latestLine.insertAfter(lineNode)
            latestLine = lineNode
            // parentBlock.insertBefore(lineNode, parentBlock.getChildAtIndex(insertIdx))
            insertIdx++
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
        console.log("add trailing lines", parentBlock.getChildren(), insertIdx, i)
        parentBlock.getChildAtIndex(insertIdx - 1 + i).insertAfter(l)
        // parentBlock.insertBefore(l, parentBlock.getChildAtIndex(insertIdx + i))
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
                codeLine.append($createCodeHighlightNode("\t", "tab"))
                i += 1
            } else if (indent[i] === " ") {
                // Count consecutive spaces
                let spaceCount = 0
                while (indent[i + spaceCount] === " ") spaceCount++
                const tabs = Math.floor(spaceCount / tabSize)
                for (let t = 0; t < tabs; t++) {
                    codeLine.append($createCodeHighlightNode("\t", "tab"))
                }
                i += tabs * tabSize
                // If any leftover spaces, append as plain
                for (; i < indent.length && indent[i] === " "; i++) {
                    codeLine.append($createCodeHighlightNode(" ", "plain"))
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

/**
 * Handles invalid pasted or initial content by splitting into lines and inserting as plain text,
 * with proper selection and indentation. Used for fallback when JSON/YAML is invalid.
 *
 * @param text - The raw text to insert
 * @param language - The code language ("json" | "yaml")
 * @param editor - The Lexical editor instance
 */
function isTrulyEmptyContent(text: string): boolean {
    // Remove all whitespace and zero-width spaces
    const normalized = text.replace(/[\s\uFEFF\xA0]/g, "")
    return normalized.length === 0
}

export function $handleInvalidContent(text: string, language: "json" | "yaml", editor: any) {
    editor.update(() => {
        const root = $getRoot()
        if (!root) return
        let codeBlock = root.getChildren().find($isCodeBlockNode)
        if (!codeBlock) {
            codeBlock = $createCodeBlockNode(language)
            root.append(codeBlock)
        }
        // Handle empty or whitespace-only content
        if (isTrulyEmptyContent(text)) {
            if (typeof codeBlock.clear === "function") codeBlock.clear()
            // Always ensure at least one empty CodeLineNode with a zero-width space
            const line = $createCodeLineNode()
            const highlightNode = $createCodeHighlightNode("\u200B", "plain", false, null)
            line.append(highlightNode)
            codeBlock.append(line)
            return
        }
        // Robust line splitting and pretty-printing for valid JSON
        let lines: string[] = []
        if (language === "json") {
            try {
                const parsed = JSON.parse(text)
                lines = JSON.stringify(parsed, null, 2).split(/\r?\n/)
            } catch {
                lines = text.split(/\r?\n/)
            }
        } else {
            lines = text.split(/\r?\n/)
        }
        // Remove empty or whitespace-only lines
        lines = lines.filter((line) => !isTrulyEmptyContent(line))
        // If no valid lines, insert a single empty line with ZWSP
        if (lines.length === 0) {
            if (typeof codeBlock.clear === "function") codeBlock.clear()
            const line = $createCodeLineNode()
            const highlightNode = $createCodeHighlightNode("\u200B", "plain", false, null)
            line.append(highlightNode)
            codeBlock.append(line)
            return
        }
        // Guarantee a valid currentLine for $insertLinesWithSelectionAndIndent
        let currentLine = codeBlock.getChildren().find((n) => n.__type === "code-line")
        if (!currentLine) {
            currentLine = $createCodeLineNode()
            codeBlock.append(currentLine)
        }
        const selection = editor._getSelection && editor._getSelection()
        $insertLinesWithSelectionAndIndent({
            lines,
            createNodeForLine: (line: string) => createNodeForLineWithTabs(line, language),
            selection,
            anchorNode: null,
            anchorOffset: 0,
            currentLine,
            parentBlock: codeBlock,
            beforeNodes: [],
            afterNodes: [],
            beforeContent: "",
            afterContent: "",
            followingLines: [],
            editor,
        })
    })
}

/** @deprecated renamed to {@link $insertLinesWithSelectionAndIndent} by @lexical/eslint-plugin rules-of-lexical */
export const insertLinesWithSelectionAndIndent = $insertLinesWithSelectionAndIndent
