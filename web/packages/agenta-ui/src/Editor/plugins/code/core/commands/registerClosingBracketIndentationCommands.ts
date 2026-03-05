import {createLogger} from "@agenta/shared/utils"
import {
    $getSelection,
    $isRangeSelection,
    COMMAND_PRIORITY_HIGH,
    KEY_DOWN_COMMAND,
    type LexicalEditor,
} from "lexical"

import {$isCodeBlockNode} from "../../nodes/CodeBlockNode"
import {$isCodeLineNode} from "../../nodes/CodeLineNode"
import {$createCodeTabNode, $isCodeTabNode} from "../../nodes/CodeTabNode"
import {$getCodeBlockForLine, $getAllCodeLines, $getLineCount} from "../../utils/segmentUtils"

const log = createLogger("ClosingBracketIndentationPlugin", {
    disabled: true,
})
const DEBUG_LOGS = false
const MAX_LINES_FOR_CLOSING_BRACKET_INDENT = 2000

export function registerClosingBracketIndentationCommands(editor: LexicalEditor): () => void {
    return editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
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

            const parentBlock = $getCodeBlockForLine(currentLine)
            if (!parentBlock) {
                return false
            }
            if ($getLineCount(parentBlock) > MAX_LINES_FOR_CLOSING_BRACKET_INDENT) {
                return false
            }

            const currentLineChildren = currentLine.getChildren()
            let hasContentBeforeCursor = false
            let foundCursor = false

            for (const child of currentLineChildren) {
                if (child.getKey() === anchorNode.getKey()) {
                    const textContent = child.getTextContent()
                    const cursorOffset = selection.anchor.offset
                    const textBeforeCursor = textContent.slice(0, cursorOffset)
                    if (textBeforeCursor.trim().length > 0) {
                        hasContentBeforeCursor = true
                    }
                    foundCursor = true
                    break
                } else if (!foundCursor) {
                    const textContent = child.getTextContent()
                    if (textContent.trim().length > 0) {
                        hasContentBeforeCursor = true
                    }
                }
            }

            DEBUG_LOGS &&
                log("Closing bracket detected", {
                    key: event.key,
                    currentLine: currentLine.getTextContent(),
                    hasContentBeforeCursor,
                })

            if (hasContentBeforeCursor) {
                DEBUG_LOGS &&
                    log("Inline closing bracket detected, skipping indentation adjustment")
                return false
            }

            const allLines = $getAllCodeLines(parentBlock)
            const currentLineIndex = allLines.findIndex(
                (line) => line.getKey() === currentLine.getKey(),
            )

            if (currentLineIndex === -1) {
                return false
            }

            const matchingBrackets = {
                "}": "{",
                "]": "[",
                ")": "(",
            }

            const openingBracket = matchingBrackets[event.key as keyof typeof matchingBrackets]
            let bracketCount = 0
            let matchingLineIndex = -1

            for (let i = currentLineIndex - 1; i >= 0; i--) {
                const lineText = allLines[i].getTextContent()

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
                DEBUG_LOGS && log("No matching opening bracket found")
                return false
            }

            const matchingLine = allLines[matchingLineIndex]
            const matchingLineText = matchingLine.getTextContent()
            const matchingIndentLevel = (matchingLineText.match(/^\t*/)?.[0] || "").length

            DEBUG_LOGS &&
                log("Found matching bracket", {
                    matchingLineIndex,
                    matchingLineText,
                    matchingIndentLevel,
                })

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

            DEBUG_LOGS &&
                log("Current indentation", {
                    currentIndentLevel,
                    targetIndentLevel: matchingIndentLevel,
                })

            if (currentIndentLevel !== matchingIndentLevel) {
                if (currentIndentLevel > matchingIndentLevel) {
                    const tabsToRemove = currentIndentLevel - matchingIndentLevel
                    for (let i = 0; i < tabsToRemove; i++) {
                        if (leadingTabs[i]) {
                            leadingTabs[i].remove()
                        }
                    }
                } else {
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

                DEBUG_LOGS &&
                    log("Adjusted indentation", {
                        from: currentIndentLevel,
                        to: matchingIndentLevel,
                    })
            }

            return false
        },
        COMMAND_PRIORITY_HIGH,
    )
}
