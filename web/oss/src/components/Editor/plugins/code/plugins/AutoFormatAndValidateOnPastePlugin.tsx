// plugins/AutoFormatAndValidateOnPastePlugin.tsx
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import JSON5 from "json5"
import {
    $getSelection,
    $isRangeSelection,
    PASTE_COMMAND,
    $getRoot,
    COMMAND_PRIORITY_CRITICAL,
} from "lexical"

import {$createCodeBlockNode, $isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"
import {calculateMultiLineIndentation, getIndentCount} from "../utils/indent"
import {$insertLinesWithSelectionAndIndent} from "../utils/pasteUtils"

const log = createLogger("AutoFormatAndValidateOnPastePlugin", {
    disabled: true,
})

export function AutoFormatAndValidateOnPastePlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        const removeListener = editor.registerCommand(
            PASTE_COMMAND,
            (event: ClipboardEvent) => {
                const pastedText = event.clipboardData?.getData("text/plain")
                if (!pastedText) return false

                // Utility functions for validation using JSON5 for more flexible parsing
                const isValidJson = (text: string) => {
                    try {
                        JSON5.parse(text)
                        return true
                    } catch {
                        return false
                    }
                }

                const parseJsonContent = (text: string) => {
                    try {
                        return JSON5.parse(text)
                    } catch {
                        return null
                    }
                }

                log("Paste detected", pastedText.substring(0, 50))
                log("[AutoFormatAndValidateOnPastePlugin] Raw Paste:", pastedText)

                // Unify valid and invalid content handling
                event.preventDefault()
                event.stopPropagation()
                log(
                    "[AutoFormatAndValidateOnPastePlugin] Prevented default paste, updating editor...",
                )
                const selection = $getSelection()
                log("[AutoFormatAndValidateOnPastePlugin] Selection before paste:", selection)
                if (!$isRangeSelection(selection)) {
                    log("Paste: Not a range selection", {selection})
                    return false
                }
                const anchorNode = selection.anchor.getNode()
                let currentLine = anchorNode.getParent()
                if (!currentLine) {
                    log("Paste: No currentLine 0", {anchorNode})
                    log(
                        "[AutoFormatAndValidateOnPastePlugin] No currentLine found for anchorNode:",
                        anchorNode,
                    )
                    return false
                }
                if (!$isCodeLineNode(currentLine)) {
                    if ($isCodeBlockNode(currentLine)) {
                        const line = currentLine.getChildren().find($isCodeLineNode)
                        if (line) {
                            currentLine = line
                        } else {
                            log("Paste: No currentLine 1", {anchorNode, currentLine})
                            return false
                        }
                    } else {
                        if ($isCodeBlockNode(anchorNode)) {
                            const line = anchorNode.getChildren().find($isCodeLineNode)
                            if (line) {
                                currentLine = line
                            } else {
                                log("Paste: No currentLine 2", {anchorNode, currentLine})
                                return false
                            }
                        } else {
                            log("Paste: No currentLine 2", {anchorNode, currentLine})
                            return false
                        }
                    }
                }
                let parentBlock = currentLine.getParent()
                if (!parentBlock) {
                    // parentBlock =
                    log("Paste: No parentBlock", {currentLine})
                    return false
                }

                // Get the actual language from the CodeBlock node, or default to "code"
                const language = $isCodeBlockNode(parentBlock)
                    ? parentBlock.getLanguage()
                    : "code"
                log("Paste: Initial selection state", {
                    selection,
                    anchorNode,
                    currentLine,
                    parentBlock,
                })

                if (!selection.isCollapsed()) {
                    // const nodes = selection.extract()
                    selection.removeText()
                    const clone = selection.clone()

                    log("Paste: Not collapsed, removing text", clone)
                }

                if (!$isCodeBlockNode(parentBlock) && !$isCodeLineNode(currentLine)) {
                    const root = $getRoot()
                    let existingCodeBlock = root.getChildren().find($isCodeBlockNode)
                    if (!existingCodeBlock) {
                        existingCodeBlock = $createCodeBlockNode(language)
                        root.append(existingCodeBlock)
                    }
                    if (!$isCodeLineNode(currentLine)) {
                        const lines = existingCodeBlock.getChildren().filter($isCodeLineNode)
                        currentLine = lines[lines.length - 1]
                    }
                    parentBlock = existingCodeBlock
                    log("Paste: Normalized to code block", {
                        currentLine,
                        parentBlock,
                    })
                }

                // Determine if content is valid and pretty-print if needed
                let lines: string[]
                if (language === "json" && isValidJson(pastedText)) {
                    // Pretty-print valid JSON with tab-based indentation using JSON5
                    try {
                        const parsed = parseJsonContent(pastedText)
                        if (parsed !== null) {
                            // Use 2-space indentation first, then convert to tabs
                            const spacedJson = JSON.stringify(parsed, null, 2)
                            // Convert every 2 spaces at the beginning of lines to tabs
                            const tabbedJson = spacedJson.replace(/^( {2})+/gm, (match) => {
                                return "\t".repeat(match.length / 2)
                            })
                            lines = tabbedJson.split("\n")
                            log("JSON5 formatting applied", {
                                original: pastedText,
                                formatted: tabbedJson,
                                lineCount: lines.length,
                                wasJSON5: true,
                            })
                        } else {
                            lines = pastedText.split("\n")
                        }
                    } catch {
                        lines = pastedText.split("\n")
                    }
                } else {
                    // For YAML or invalid JSON, just split as-is
                    lines = pastedText.split("\n")
                }

                // Calculate proper indentation for each pasted line based on content and context
                // This follows the same logic as the IndentationPlugin's Enter handler

                // Analyze cursor position to determine if we're pasting inline or at line start
                const currentLineText = currentLine.getTextContent()
                const baseIndentLevel = getIndentCount(currentLineText)
                const anchorOffset = selection.anchor.offset

                // Check if there's content before the cursor (inline paste)
                // We need to check the entire line content up to the cursor position, not just the anchor node
                const allChildren = currentLine.getChildren()
                let totalTextBeforeCursor = ""

                for (const child of allChildren) {
                    if (child.getKey() === anchorNode.getKey()) {
                        // Add the portion of the anchor node before the cursor
                        totalTextBeforeCursor += anchorNode.getTextContent().slice(0, anchorOffset)
                        break
                    } else {
                        // Add the entire content of nodes before the anchor
                        totalTextBeforeCursor += child.getTextContent()
                    }
                }

                const hasContentBefore = !!currentLineText
                // totalTextBeforeCursor.trim().length > 0

                // Check if there's content after the cursor on the same line
                const textAfterCursor = anchorNode.getTextContent().slice(anchorOffset)
                const hasContentAfter = textAfterCursor.trim().length > 0

                // For Python/code: NO TRANSFORMATION - paste exactly as-is
                // For JSON/YAML: convert tabs to spaces (2:1), recalculate indentation based on braces
                let properlyIndentedLines: string[]

                if (language === "json" || language === "yaml") {
                    // Convert tabs to spaces first (2 spaces for JSON/YAML)
                    const spacedLines = lines.map((line) => line.replace(/\t/g, "  "))

                    // Strip all leading whitespace from pasted lines
                    const strippedLines = spacedLines.map((line) => line.replace(/^\s+/, ""))

                    // Calculate proper indentation levels for each line
                    const indentLevels = calculateMultiLineIndentation(
                        strippedLines,
                        baseIndentLevel,
                        language,
                    )

                    // Apply calculated indentation using tabs
                    properlyIndentedLines = strippedLines.map((line, index) => {
                        let indentLevel = indentLevels[index]

                        if (index === 0 && !!totalTextBeforeCursor) {
                            return line
                        }

                        const result = "\t".repeat(indentLevel) + line
                        return result
                    })
                } else {
                    // For code/Python: NO TRANSFORMATION AT ALL - exact paste
                    properlyIndentedLines = lines
                }

                log("Paste: Cursor context analysis", {
                    anchorOffset,
                    totalTextBeforeCursor,
                    textAfterCursor,
                    hasContentBefore,
                    hasContentAfter,
                    currentLineText,
                    baseIndentLevel,
                    currentLine,
                })

                log("Paste: Lines with calculated indentation", {
                    originalLines: lines,
                    properlyIndentedLines,
                    baseIndentLevel,
                    language,
                })

                $insertLinesWithSelectionAndIndent({
                    lines: properlyIndentedLines,
                    anchorNode,
                    anchorOffset: selection.anchor.offset,
                    currentLine,
                    parentBlock,
                    skipNormalization: true,
                })

                return true
            },
            COMMAND_PRIORITY_CRITICAL,
        )
        return () => removeListener()
    }, [editor])

    return null
}
