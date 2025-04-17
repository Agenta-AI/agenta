// plugins/AutoFormatAndValidateOnPastePlugin.tsx
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isRangeSelection,
    PASTE_COMMAND,
    COMMAND_PRIORITY_HIGH,
    LexicalNode,
    $getRoot,
    COMMAND_PRIORITY_CRITICAL,
} from "lexical"

import {$createCodeBlockNode, $isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$createCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$createCodeLineNode, $isCodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"
import {$createNodeForLineWithTabs, $insertLinesWithSelectionAndIndent} from "../utils/pasteUtils"

const log = createLogger("AutoFormatAndValidateOnPastePlugin")

export function AutoFormatAndValidateOnPastePlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        const removeListener = editor.registerCommand(
            PASTE_COMMAND,
            (event: ClipboardEvent) => {
                const pastedText = event.clipboardData?.getData("text/plain")
                if (!pastedText) return false

                // Utility functions for validation
                const isValidJson = (text: string) => {
                    try {
                        JSON.parse(text)
                        return true
                    } catch {
                        return false
                    }
                }

                log("Paste detected", pastedText.substring(0, 50))
                console.log("[AutoFormatAndValidateOnPastePlugin] Raw Paste:", pastedText)
                const language: "json" | "yaml" = pastedText.trim().startsWith("{")
                    ? "json"
                    : "yaml"

                // Unify valid and invalid content handling
                event.preventDefault()
                console.log(
                    "[AutoFormatAndValidateOnPastePlugin] Prevented default paste, updating editor...",
                )
                editor.update(
                    () => {
                        const selection = $getSelection()
                        console.log(
                            "[AutoFormatAndValidateOnPastePlugin] Selection before paste:",
                            selection,
                        )
                        if (!$isRangeSelection(selection)) {
                            log("Paste: Not a range selection", {selection})
                            return false
                        }
                        const anchorNode = selection.anchor.getNode()
                        let currentLine = anchorNode.getParent()
                        if (!currentLine) {
                            log("Paste: No currentLine 0", {anchorNode})
                            console.log(
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

                            console.log(
                                "not collapsed",
                                clone,
                                clone.anchor.getNode(),
                                clone.focus.getNode(),
                            )
                            // return true
                        }

                        if (!$isCodeBlockNode(parentBlock) && !$isCodeLineNode(currentLine)) {
                            const root = $getRoot()
                            let existingCodeBlock = root.getChildren().find($isCodeBlockNode)
                            if (!existingCodeBlock) {
                                existingCodeBlock = $createCodeBlockNode(language)
                                root.append(existingCodeBlock)
                            }
                            if (!$isCodeLineNode(currentLine)) {
                                const lines = existingCodeBlock
                                    .getChildren()
                                    .filter($isCodeLineNode)
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
                            // Pretty-print valid JSON
                            try {
                                const parsed = JSON.parse(pastedText)
                                lines = JSON.stringify(parsed, null, 2).split("\n")
                            } catch {
                                lines = pastedText.split("\n")
                            }
                        } else {
                            // For YAML or invalid JSON, just split as-is
                            lines = pastedText.split("\n")
                        }

                        log("Paste: Lines to insert", {lines, count: lines.length})

                        $insertLinesWithSelectionAndIndent({
                            lines,
                            // createNodeForLine: (line: string) => {

                            //     // $createNodeForLineWithTabs(line, language),
                            // }
                            selection,
                            anchorNode,
                            // anchorOffset,
                            currentLine,
                            parentBlock,
                            // beforeNodes,
                            // afterNodes,
                            // beforeContent,
                            // afterContent,
                            // followingLines,
                            editor,
                            // insertIndex,
                        })

                        // log("Paste: Insert complete", {
                        //     linesInserted: lines.length,
                        //     parentBlock,
                        //     editorState: editor.getEditorState().toJSON
                        //         ? editor.getEditorState().toJSON()
                        //         : undefined,
                        //     textContent: $getRoot().getTextContent(),
                        // })

                        // // CLEANUP: Remove redundant empty or '{}' lines
                        // if (parentBlock && typeof parentBlock.getChildren === "function") {
                        //     const children = parentBlock.getChildren()
                        //     let removed = false
                        //     children.forEach((child: any) => {
                        //         const content = child.getTextContent().replace(/[\u200B\s]/g, "")
                        //         if (content === "" || content === "{}") {
                        //             child.remove()
                        //             removed = true
                        //         }
                        //     })
                        //     if (removed) {
                        //         console.log(
                        //             "[AutoFormatAndValidateOnPastePlugin] Cleaned up empty or '{}' lines after paste.",
                        //         )
                        //         console.log(
                        //             "[AutoFormatAndValidateOnPastePlugin] Final children:",
                        //             parentBlock.getChildren().map((n: any) => n.getTextContent()),
                        //         )
                        //     }
                        // }
                        return true
                    },
                    {
                        skipTransforms: true,
                    },
                )
                return true
            },
            COMMAND_PRIORITY_CRITICAL,
        )
        return () => removeListener()
    }, [editor])

    return null
}
