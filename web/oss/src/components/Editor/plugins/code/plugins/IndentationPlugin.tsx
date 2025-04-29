/**
 * IndentationPlugin.tsx
 *
 * This plugin manages code indentation behavior in the editor.
 * It handles automatic indentation on Enter key press, maintaining proper
 * indentation levels based on code structure and block nesting.
 *
 * Features:
 * - Smart indentation on new lines
 * - Preserves existing indentation
 * - Handles block-based indentation
 * - Supports tab-based indentation
 *
 * @module IndentationPlugin
 */
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$findMatchingParent} from "@lexical/utils"
import {
    $createRangeSelection,
    $createTabNode,
    $getSelection,
    $isRangeSelection,
    $isTabNode,
    $setSelection,
    COMMAND_PRIORITY_HIGH,
    KEY_DOWN_COMMAND,
    LexicalNode,
} from "lexical"

import {$isCodeHighlightNode, $createCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode, $createCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

const log = createLogger("IndentationPlugin", {
    disabled: true,
})

/**
 * React component that implements smart indentation behavior.
 * Integrates with Lexical editor to provide automatic indentation
 * and proper code formatting.
 *
 * Key features:
 * - Handles Enter key for new lines
 * - Maintains indentation context
 * - Splits lines at cursor position
 * - Preserves code structure
 *
 * @returns null - This is a behavior-only plugin
 */
export function IndentationPlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event: KeyboardEvent) => {
                log("ENTER pressed", event.key)
                if (event.key !== "Enter") return false

                const selection = $getSelection()
                if (!$isRangeSelection(selection)) return false

                event.preventDefault()
                log("ENTER pressed")

                const anchor = selection.anchor
                const anchorOffset = anchor.offset
                const anchorNode = anchor.getNode()

                const lineNode = $findMatchingParent(anchorNode, $isCodeLineNode)
                if (!lineNode) return

                const children = lineNode.getChildren()
                const caretKey = anchorNode.getKey()

                const beforeNodes: LexicalNode[] = []
                const afterNodes: LexicalNode[] = []

                let seenCaret = false

                for (const node of children) {
                    if (!$isCodeHighlightNode(node)) {
                        beforeNodes.push(node)
                        continue
                    }

                    const text = node.getTextContent()
                    const length = text.length
                    const isCaretNode = node.getKey() === caretKey

                    // Before cursor: collect nodes as-is
                    if (!seenCaret && !isCaretNode) {
                        beforeNodes.push(node)
                        continue
                    }

                    // At cursor node: split content based on cursor position
                    if (isCaretNode) {
                        seenCaret = true
                        const type = node.getHighlightType()

                        // Handle edge cases:
                        if (anchorOffset === 0) {
                            // Cursor at start: entire node goes after
                            afterNodes.push(node)
                        } else if (anchorOffset === length) {
                            // Cursor at end: entire node goes before
                            beforeNodes.push(node)
                        } else {
                            // Cursor in middle: split node content
                            const before = $createCodeHighlightNode(
                                text.slice(0, anchorOffset),
                                type,
                                false,
                                null,
                            )
                            const after = $createCodeHighlightNode(
                                text.slice(anchorOffset),
                                type,
                                false,
                                null,
                            )
                            beforeNodes.push(before)
                            afterNodes.push(after)
                            log("✂️ Split highlight node", {before, after})
                        }
                        continue
                    }

                    // After cursor: collect remaining nodes
                    afterNodes.push(node)
                }

                /**
                 * Analyze line content and structure:
                 * 1. Extract current indentation level
                 * 2. Join content before/after cursor
                 * 3. Detect if we're inside a brace pair
                 */
                // Get base indentation from the start of the line
                const indentMatch = lineNode.getTextContent().match(/^\s*/)
                const baseIndent = indentMatch ? indentMatch[0] : ""
                const indentCount = (baseIndent.match(/\t/g) || []).length

                // Join node content for analysis
                const beforeText = beforeNodes.map((n) => n.getTextContent()).join("")
                const afterText = afterNodes.map((n) => n.getTextContent()).join("")

                // Check if cursor is between opening and closing braces
                const isBraced =
                    /[\[{(]\s*$/.test(beforeText.trim()) && /^[\]})]/.test(afterText.trim())

                // Check if line ends with an opening brace
                const endsWithOpeningBrace = /[\[{(]\s*$/.test(beforeText.trim())

                log("🔎 Full highlight content", {
                    fullText: beforeText + afterText,
                })
                log("🔪 Split parts", {
                    before: beforeText,
                    after: afterText,
                })
                log("Line analysis", {
                    before: beforeText,
                    after: afterText,
                    indentCount,
                    isBraced,
                })

                // Update current line with beforeNodes
                const writableLine = lineNode.getWritable()
                writableLine.clear()
                beforeNodes.forEach((n) => writableLine.append(n))

                // Array to store new lines that will be inserted after the current line
                // This includes the middle line for braced content and the trailing line
                const linesToInsert: CodeLineNode[] = []

                /**
                 * Creates a new line with proper indentation based on the current context
                 *
                 * @param extra - Additional indentation level to add (e.g. 1 for content inside braces)
                 * @returns A new CodeLineNode with the correct number of tab nodes
                 *
                 * The function:
                 * 1. Creates a new empty line
                 * 2. Adds base indentation from the current line
                 * 3. Adds any extra indentation for nested content
                 * 4. Uses CodeHighlightNode for tabs to maintain consistency
                 */
                const createIndentedLine = (extra: number) => {
                    const line = $createCodeLineNode()
                    for (let i = 0; i < indentCount + extra; i++) {
                        line.append($createTabNode())
                    }
                    // Add an empty CodeHighlightNode to ensure proper node type for text entry
                    // This prevents plain text nodes from being created when typing
                    line.append($createCodeHighlightNode("\u200b", "plain"))
                    return line
                }

                // Handle special case for content inside braces (e.g. if, for, function blocks)
                // When we detect content is braced:
                // 1. Create an empty line with +1 indentation level
                // 2. Add a zero-width space to ensure line is selectable
                // 3. Insert this line before the trailing content
                if (isBraced) {
                    const middle = createIndentedLine(1)
                    linesToInsert.push(middle)
                }

                // Handle case where line ends with an opening brace but there's no matching closing brace
                // This ensures proper indentation for JSON objects, arrays, and code blocks
                else if (endsWithOpeningBrace) {
                    // Add extra indentation to the trailing line
                    const trailing = createIndentedLine(1)

                    // If there was content after the cursor, move it to the new line
                    if (afterNodes.length > 0) {
                        afterNodes.forEach((n) => trailing.append(n))
                        log("📎 Inserted trailing content with extra indent", {
                            trailingContent: trailing.getTextContent(),
                        })
                    }

                    // Insert all new lines after the current line
                    lineNode.insertAfter(trailing)

                    // Find the empty CodeHighlightNode that was created in the trailing line
                    const emptyHighlightNode = trailing
                        .getChildren()
                        .find((node) => $isCodeHighlightNode(node) && node.getTextContent() === "")

                    // Set selection to the empty CodeHighlightNode in the new line
                    if (emptyHighlightNode) {
                        $setSelection(emptyHighlightNode.selectStart())
                        log("🎯 Set selection to empty highlight node", {
                            lineKey: trailing.getKey(),
                            nodeKey: emptyHighlightNode.getKey(),
                        })
                    } else {
                        // Fallback: position after the last tab
                        const tabNodes = trailing.getChildren().filter($isTabNode)
                        if (tabNodes.length > 0) {
                            const lastTab = tabNodes[tabNodes.length - 1]
                            $setSelection(lastTab.selectEnd())
                        } else {
                            $setSelection(trailing.selectStart())
                        }
                        log("🎯 Set selection to fallback position", {
                            lineKey: trailing.getKey(),
                        })
                    }

                    return true
                }

                // Create the trailing line that will contain any content that was after the cursor
                // This line maintains the same indentation level as the original line
                const trailing = createIndentedLine(0)

                // If there was content after the cursor, move it to the new line
                if (afterNodes.length > 0) {
                    afterNodes.forEach((n) => trailing.append(n))
                    log("📎 Inserted trailing content", {
                        trailingContent: trailing.getTextContent(),
                    })
                } else {
                    // If no content, add an empty CodeHighlightNode to ensure line is selectable
                    // This will be properly styled by the CodeHighlightNode.createDOM method
                    // trailing.append($createCodeHighlightNode("arda", "plain", false, null))
                    log("📎 Inserted new line content", {
                        trailingContent: trailing.getTextContent(),
                    })
                    // trailing.append($createTextNode("\u200b"))
                    // trailing.append($createCodeHighlightNode("\u200b", "plain", false, null))
                }
                linesToInsert.push(trailing)

                // Insert all new lines after the current line
                // We maintain a reference to the last inserted line to chain them correctly:
                // currentLine -> middleLine (if braced) -> trailingLine
                let insertAfter = lineNode
                for (const line of linesToInsert) {
                    insertAfter.insertAfter(line)
                    insertAfter = line
                }

                // Place the cursor in the appropriate position:
                // - For braced content: on the empty middle line
                // - Otherwise: on the trailing line with the moved content
                const selectionTarget = isBraced ? linesToInsert[0] : trailing

                const targetChildren = selectionTarget.getChildren()
                const firstContentNode = targetChildren.find((node) => !$isTabNode(node))
                const lastTabNode = targetChildren.filter($isTabNode).pop()

                log("Selection target analysis:", {
                    targetKey: selectionTarget.getKey(),
                    childrenCount: targetChildren.length,
                    hasContentNode: !!firstContentNode,
                    hasTabNodes: !!lastTabNode,
                    childTypes: targetChildren.map((c) => c.getType()),
                })

                // Create a new selection at the appropriate position
                const sel = $createRangeSelection()

                if (firstContentNode) {
                    // Position at start of first content node
                    log("SELECTION CASE 1", {
                        firstContentNode,
                        selectionTarget,
                        nextSibling: firstContentNode.getNextSibling(),
                    })
                    if (!firstContentNode.getNextSibling()) {
                        if (
                            selection.anchor.offset + selection.focus.offset <
                            firstContentNode.getTextContentSize()
                        ) {
                            log("SELECTION CASE 1a")
                            $setSelection(firstContentNode.selectStart())
                        } else {
                            log("SELECTION CASE 1b")
                            $setSelection(firstContentNode.selectEnd())
                        }
                    } else {
                        $setSelection(firstContentNode.selectStart())
                    }
                } else if (lastTabNode) {
                    // Position after last tab node
                    $setSelection(lastTabNode.selectEnd())
                } else {
                    // Position at start of line if no content or tabs
                    $setSelection(selectionTarget.selectStart())
                    // $setSelection(sel)
                }

                // Set the selection explicitly
                // $setSelection(sel)

                log("🎯 Set explicit selection to new line", {
                    lineKey: selectionTarget.getKey(),
                    selection: sel,
                })

                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor])

    return null
}
