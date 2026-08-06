import {createLogger} from "@agenta/shared/utils"
import JSON5 from "json5"
import {
    $addUpdateTag,
    $getRoot,
    $getSelection,
    $isRangeSelection,
    $setSelection,
    COMMAND_PRIORITY_CRITICAL,
    PASTE_COMMAND,
    type LexicalEditor,
} from "lexical"

import {createHighlightedNodes} from "../../index"
import {$createCodeBlockNode, $isCodeBlockNode, type CodeBlockNode} from "../../nodes/CodeBlockNode"
import {$isCodeLineNode, type CodeLineNode} from "../../nodes/CodeLineNode"
import {calculateMultiLineIndentation, getIndentCount} from "../../utils/indent"
import {showEditorLoadingOverlay} from "../../utils/loadingOverlay"
import {$insertLinesWithSelectionAndIndent} from "../../utils/pasteUtils"
import {
    $wrapLinesInSegments,
    $getAllCodeLines,
    $getCodeBlockForLine,
} from "../../utils/segmentUtils"
import {INITIAL_CONTENT_UPDATE_TAG} from "../highlight/updateTags"

const log = createLogger("AutoFormatAndValidateOnPastePlugin", {
    disabled: true,
})

/**
 * Threshold above which a paste replaces the entire editor content
 * using the bulk initial-content path to avoid O(n²) node insertion
 * and transform fan-out.
 */
const LARGE_PASTE_LINE_THRESHOLD = 500

export function registerAutoFormatAndValidateOnPasteCommands(editor: LexicalEditor): () => void {
    return editor.registerCommand(
        PASTE_COMMAND,
        (event: ClipboardEvent) => {
            const pastedText = event.clipboardData?.getData("text/plain")
            if (!pastedText) return false

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

            event.preventDefault()
            event.stopPropagation()

            const selection = $getSelection()
            if (!$isRangeSelection(selection)) {
                log("Paste: Not a range selection", {selection})
                return false
            }
            const anchorNode = selection.anchor.getNode()
            let currentLine = anchorNode.getParent()
            if (!currentLine) {
                log("Paste: No currentLine", {anchorNode})
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
                } else if ($isCodeBlockNode(anchorNode)) {
                    const line = anchorNode.getChildren().find($isCodeLineNode)
                    if (line) {
                        currentLine = line
                    } else {
                        log("Paste: No currentLine 2", {anchorNode, currentLine})
                        return false
                    }
                } else {
                    log("Paste: No currentLine 3", {anchorNode, currentLine})
                    return false
                }
            }
            let parentBlock = $getCodeBlockForLine(currentLine) || currentLine.getParent()
            if (!parentBlock) {
                log("Paste: No parentBlock", {currentLine})
                return false
            }

            const language = $isCodeBlockNode(parentBlock) ? parentBlock.getLanguage() : "code"

            if (!selection.isCollapsed()) {
                selection.removeText()
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
            }

            let lines: string[]
            if (language === "json" && isValidJson(pastedText)) {
                try {
                    const parsed = parseJsonContent(pastedText)
                    if (parsed !== null) {
                        const spacedJson = JSON.stringify(parsed, null, 2)
                        const tabbedJson = spacedJson.replace(/^( {2})+/gm, (match) => {
                            return "\t".repeat(match.length / 2)
                        })
                        lines = tabbedJson.split("\n")
                    } else {
                        lines = pastedText.split("\n")
                    }
                } catch {
                    lines = pastedText.split("\n")
                }
            } else {
                lines = pastedText.split("\n")
            }

            // ── Large paste fast path ──────────────────────────────────
            // For very large pastes (500+ lines), the line-by-line insertion
            // plus per-node transform fan-out is O(n²) and will freeze or
            // crash the browser.  Instead, compute the final document text
            // (string ops — fast) synchronously, then defer the heavy
            // createHighlightedNodes + DOM reconciliation to the next frame
            // so the browser can paint a loading overlay first.
            if (
                lines.length >= LARGE_PASTE_LINE_THRESHOLD &&
                (language === "json" || language === "yaml") &&
                $isCodeBlockNode(parentBlock)
            ) {
                log("Paste: Large paste fast path", {lineCount: lines.length})

                // Build final document text: lines before cursor + pasted + lines after cursor
                const allExistingLines = $getAllCodeLines(parentBlock)
                const lineIdx = allExistingLines.findIndex(
                    (n) => n.getKey() === currentLine.getKey(),
                )
                const anchorOffset = selection.anchor.offset

                // Compute text before and after cursor in the current line
                const currentLineText = currentLine.getTextContent()
                const children = currentLine.getChildren()
                let textBeforeCursor = ""
                for (const child of children) {
                    if (child.getKey() === anchorNode.getKey()) {
                        textBeforeCursor += anchorNode.getTextContent().slice(0, anchorOffset)
                        break
                    } else {
                        textBeforeCursor += child.getTextContent()
                    }
                }
                const textAfterCursor = currentLineText.slice(textBeforeCursor.length)

                // Assemble lines before cursor
                const linesBefore: string[] = []
                for (let i = 0; i < lineIdx; i++) {
                    linesBefore.push(allExistingLines[i].getTextContent())
                }
                if (textBeforeCursor) {
                    linesBefore.push(textBeforeCursor)
                }

                // Pasted lines (convert tabs back to 2-space for createHighlightedNodes)
                const pastedLines = lines.map((l) => l.replace(/\t/g, "  "))

                // Assemble lines after cursor
                const linesAfter: string[] = []
                if (textAfterCursor) {
                    linesAfter.push(textAfterCursor)
                }
                for (let i = lineIdx + 1; i < allExistingLines.length; i++) {
                    linesAfter.push(allExistingLines[i].getTextContent())
                }

                const fullText = [...linesBefore, ...pastedLines, ...linesAfter].join("\n")

                // Capture the language for the deferred callback (string, not a node ref)
                const capturedLanguage = language as "json" | "yaml"

                // Show loading overlay immediately (DOM manipulation — no React needed)
                const removeOverlay = showEditorLoadingOverlay(editor)

                // Defer the heavy work so the browser can paint the overlay
                setTimeout(() => {
                    editor.update(
                        () => {
                            $addUpdateTag(INITIAL_CONTENT_UPDATE_TAG)

                            // Re-find the CodeBlockNode (node refs are stale across update boundaries)
                            const root = $getRoot()
                            const codeBlock = root.getChildren().find($isCodeBlockNode)
                            if (!codeBlock) {
                                log("Paste deferred: no code block found")
                                return
                            }

                            codeBlock.clear()
                            const highlightedNodes = createHighlightedNodes(
                                fullText,
                                capturedLanguage,
                            )

                            $wrapLinesInSegments(highlightedNodes).forEach((node) => {
                                codeBlock.append(node)
                            })

                            // Place cursor at the START of the document.
                            // This ensures virtualization's visible window begins at line 0,
                            // so paddingTop=0 and the user sees content immediately
                            // (not blank padding from a cursor-at-end position).
                            const firstLine = $getAllCodeLines(codeBlock)[0]
                            if (firstLine) {
                                firstLine.selectStart()
                            } else {
                                $setSelection(null)
                            }
                        },
                        {
                            onUpdate: () => {
                                removeOverlay?.()

                                // After Lexical reconciles the DOM, scroll the editor
                                // container to the top so the user sees the content.
                                // Use rAF to ensure virtualization has also run.
                                requestAnimationFrame(() => {
                                    const root = editor.getRootElement()
                                    if (!root) return

                                    // Scroll all ancestor containers to top
                                    let el: HTMLElement | null = root
                                    while (el) {
                                        if (el.scrollTop > 0) {
                                            el.scrollTop = 0
                                        }
                                        el = el.parentElement
                                    }
                                })
                            },
                        },
                    )
                }, 0)

                return true
            }

            const currentLineText = currentLine.getTextContent()
            const baseIndentLevel = getIndentCount(currentLineText)
            const anchorOffset = selection.anchor.offset

            const allChildren = currentLine.getChildren()
            let totalTextBeforeCursor = ""

            for (const child of allChildren) {
                if (child.getKey() === anchorNode.getKey()) {
                    totalTextBeforeCursor += anchorNode.getTextContent().slice(0, anchorOffset)
                    break
                } else {
                    totalTextBeforeCursor += child.getTextContent()
                }
            }

            const hasContentBefore = !!currentLineText

            const textAfterCursor = anchorNode.getTextContent().slice(anchorOffset)
            const hasContentAfter = textAfterCursor.trim().length > 0

            let properlyIndentedLines: string[]

            if (language === "json" || language === "yaml") {
                const spacedLines = lines.map((line) => line.replace(/\t/g, "  "))

                const strippedLines = spacedLines.map((line) => line.replace(/^\s+/, ""))

                const indentLevels = calculateMultiLineIndentation(
                    strippedLines,
                    baseIndentLevel,
                    language,
                )

                properlyIndentedLines = strippedLines.map((line, index) => {
                    const indentLevel = indentLevels[index]

                    if (index === 0 && !!totalTextBeforeCursor) {
                        return line
                    }

                    const result = "\t".repeat(indentLevel) + line
                    return result
                })
            } else {
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

            $insertLinesWithSelectionAndIndent({
                lines: properlyIndentedLines,
                anchorNode,
                anchorOffset: selection.anchor.offset,
                currentLine: currentLine as CodeLineNode,
                parentBlock: parentBlock as CodeBlockNode,
                skipNormalization: true,
            })

            return true
        },
        COMMAND_PRIORITY_CRITICAL,
    )
}
