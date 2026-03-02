// plugins/ClosingBracketIndentationPlugin.tsx
import {useEffect} from "react"

import {createLogger} from "@agenta/shared/utils"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {$createCodeTabNode, $isCodeTabNode} from "../nodes/CodeTabNode"

const log = createLogger("ClosingBracketIndentationPlugin", {
    disabled: true,
})

export function ClosingBracketIndentationPlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        const removeListener = editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event: KeyboardEvent) => {
                // Only handle closing brackets: }, ], )
                const closingBrackets = ["}", "]", ")"]
                if (!closingBrackets.includes(event.key)) {
                    return false
                }

                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                    return false
                }

                const anchorNode = selection.anchor.getNode()
                let currentLine = anchorNode.getParent()

                // Find the current code line
                if (!$isCodeLineNode(currentLine)) {
                    if ($isCodeBlockNode(currentLine)) {
                        const line = currentLine.getChildren().find($isCodeLineNode)
                        if (line) {
                            currentLine = line
                        } else {
                            return false
                        }
                    } else {
                        return false
                    }
                }

                const parentBlock = currentLine.getParent()
                if (!$isCodeBlockNode(parentBlock)) {
                    return false
                }

                // Check if there's content before the cursor (inline closing bracket)
                const currentLineChildren = currentLine.getChildren()
                let hasContentBeforeCursor = false
                let foundCursor = false

                for (const child of currentLineChildren) {
                    if (child.getKey() === anchorNode.getKey()) {
                        // Check if there's content before the cursor in this node
                        const textContent = child.getTextContent()
                        const cursorOffset = selection.anchor.offset
                        const textBeforeCursor = textContent.slice(0, cursorOffset)
                        if (textBeforeCursor.trim().length > 0) {
                            hasContentBeforeCursor = true
                        }
                        foundCursor = true
                        break
                    } else if (!foundCursor) {
                        // Check if this child (before cursor) has non-whitespace content
                        const textContent = child.getTextContent()
                        if (textContent.trim().length > 0) {
                            hasContentBeforeCursor = true
                        }
                    }
                }

                log("Closing bracket detected", {
                    key: event.key,
                    currentLine: currentLine.getTextContent(),
                    hasContentBeforeCursor,
                })

                // If there's content before the cursor, this is an inline closing bracket
                // Don't adjust indentation in this case
                if (hasContentBeforeCursor) {
                    log("Inline closing bracket detected, skipping indentation adjustment")
                    return false
                }

                // Get all lines in the code block
                const allLines = parentBlock.getChildren().filter($isCodeLineNode)
                const currentLineIndex = allLines.findIndex(
                    (line) => line.getKey() === currentLine.getKey(),
                )

                if (currentLineIndex === -1) {
                    return false
                }

                // Find the matching opening bracket by scanning backwards
                const matchingBrackets = {
                    "}": "{",
                    "]": "[",
                    ")": "(",
                }

                const openingBracket = matchingBrackets[event.key as keyof typeof matchingBrackets]
                let bracketCount = 0
                let matchingLineIndex = -1

                // Scan backwards from current line to find matching opening bracket
                for (let i = currentLineIndex - 1; i >= 0; i--) {
                    const lineText = allLines[i].getTextContent()

                    // Count brackets in this line
                    for (const char of lineText) {
                        if (char === event.key) {
                            bracketCount++
                        } else if (char === openingBracket) {
                            if (bracketCount === 0) {
                                matchingLineIndex = i
                                break
                            }
                            bracketCount--
                        }
                    }

                    if (matchingLineIndex !== -1) {
                        break
                    }
                }

                if (matchingLineIndex === -1) {
                    log("No matching opening bracket found")
                    return false
                }

                // Get the indentation level of the matching opening bracket line
                const matchingLine = allLines[matchingLineIndex]
                const matchingLineText = matchingLine.getTextContent()
                const matchingIndentLevel = (matchingLineText.match(/^\t*/)?.[0] || "").length

                log("Found matching bracket", {
                    matchingLineIndex,
                    matchingLineText,
                    matchingIndentLevel,
                })

                // Remove excess tabs from the current line
                const lineChildren = currentLine.getChildren()
                const leadingTabs = []

                for (const child of lineChildren) {
                    if ($isCodeTabNode(child)) {
                        leadingTabs.push(child)
                    } else {
                        break
                    }
                }

                const currentIndentLevel = leadingTabs.length

                log("Current indentation", {
                    currentIndentLevel,
                    targetIndentLevel: matchingIndentLevel,
                })

                // Only adjust if indentation is wrong
                if (currentIndentLevel !== matchingIndentLevel) {
                    // Remove excess tabs or add missing tabs
                    if (currentIndentLevel > matchingIndentLevel) {
                        // Remove excess tabs
                        const tabsToRemove = currentIndentLevel - matchingIndentLevel
                        for (let i = 0; i < tabsToRemove; i++) {
                            if (leadingTabs[i]) {
                                leadingTabs[i].remove()
                            }
                        }
                    } else {
                        // Add missing tabs
                        const tabsToAdd = matchingIndentLevel - currentIndentLevel
                        const firstNonTabChild = currentLineChildren.find(
                            (child) => !$isCodeTabNode(child),
                        )

                        for (let i = 0; i < tabsToAdd; i++) {
                            const tabNode = $createCodeTabNode()
                            if (firstNonTabChild) {
                                firstNonTabChild.insertBefore(tabNode)
                            } else {
                                currentLine.append(tabNode)
                            }
                        }
                    }

                    log("Adjusted indentation", {
                        from: currentIndentLevel,
                        to: matchingIndentLevel,
                    })
                }

                // Let the normal character input proceed
                return false
            },
            COMMAND_PRIORITY_HIGH,
        )

        return () => removeListener()
    }, [editor])

    return null
}
