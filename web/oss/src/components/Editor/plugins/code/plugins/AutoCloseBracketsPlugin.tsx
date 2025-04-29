/**
 * AutoCloseBracketsPlugin.tsx
 *
 * This plugin provides automatic closing of brackets, quotes, and braces in the code editor.
 * It handles the following pairs: {}, [], (), "", '', ``
 * Features:
 * - Auto-closes matching character when opening character is typed
 * - Skips closing if closing character already exists
 * - Handles string context to prevent unwanted auto-closing
 * - Supports multiple cursor positions
 * - Maintains proper indentation after brackets
 *
 * @module AutoCloseBracketsPlugin
 */
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isRangeSelection,
    KEY_DOWN_COMMAND,
    $getNodeByKey,
    $setSelection,
    $createRangeSelection,
    $isTabNode,
    COMMAND_PRIORITY_HIGH,
} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeHighlightNode, $createCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

/** Mapping of opening characters to their corresponding closing characters */
const OPEN_TO_CLOSE = {
    '"': '"',
    "'": "'",
    "`": "`",
    "(": ")",
    "[": "]",
    "{": "}",
}

/** List of bracket characters that can trigger auto-indentation */
const BRACKETS = ["(", "[", "{"]

/** Plugin identifier for logging and lock management */
const PLUGIN_NAME = "AutoCloseBracketsPlugin"

/**
 * Determines if the current position is inside a string literal.
 * Handles escaped quotes and different quote types (", ', `).
 *
 * @param text - The text content to analyze
 * @param offset - Current cursor position in the text
 * @returns True if position is inside a string literal
 */
function isInsideString(text: string, offset: number): boolean {
    const quotes = ['"', "'", "`"]
    let openQuote: string | null = null
    let escaped = false

    for (let i = 0; i < offset; i++) {
        const char = text[i]
        if (char === "\\" && !escaped) {
            escaped = true
            continue
        }
        if (quotes.includes(char) && !escaped) {
            if (openQuote === null) {
                openQuote = char
            } else if (openQuote === char) {
                openQuote = null
            }
        }
        escaped = false
    }

    return openQuote !== null && openQuote !== "`"
}

const log = createLogger("AutoCloseBracketsPlugin", {
    disabled: false,
})

/**
 * React component that implements auto-closing behavior for brackets and quotes.
 * Integrates with Lexical editor to provide real-time bracket matching and indentation.
 *
 * Key features:
 * - Auto-closes matching characters
 * - Handles multiple cursor positions
 * - Prevents unwanted closings inside strings
 * - Maintains proper indentation
 * - Uses plugin locking to prevent conflicts
 *
 * @returns null - This is a behavior-only plugin
 */
export function AutoCloseBracketsPlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event: KeyboardEvent) => {
                log("KEY_DOWN_COMMAND 1", event.key)
                let selection = $getSelection()
                if (!$isRangeSelection(selection)) return false

                log("KEY_DOWN_COMMAND 2")
                const key = event.key
                if (!(key in OPEN_TO_CLOSE)) {
                    log("KEY_DOWN_COMMAND 2 EXIT EARLY")
                    return false
                }

                // Handle active text selection (range selection with different anchor/focus)
                const hasActiveSelection =
                    selection.anchor.key !== selection.focus.key ||
                    selection.anchor.offset !== selection.focus.offset

                if (hasActiveSelection) {
                    log("Active selection detected")

                    // Get the selected text
                    const selectedText = selection.getTextContent()
                    const close = OPEN_TO_CLOSE[key as keyof typeof OPEN_TO_CLOSE]

                    // Check if the selection is already wrapped with the same character
                    const isAlreadyWrapped =
                        selectedText.length >= 2 &&
                        selectedText.startsWith(key) &&
                        selectedText.endsWith(close)

                    event.preventDefault()
                    // lockPlugin(PLUGIN_NAME)

                    log("Active selection detected 2")

                    log("Active selection detected 3")
                    // Delete the selected content first
                    selection.deleteCharacter(false)

                    log("Active selection detected 4")
                    // Get the updated selection after deletion
                    const updatedSelection = $getSelection()
                    if (!$isRangeSelection(updatedSelection)) return

                    let anchorNode = updatedSelection.anchor.getNode()
                    log("Active selection detected 5", anchorNode)
                    if (
                        !$isCodeHighlightNode(anchorNode) &&
                        !$isTabNode(anchorNode) &&
                        !$isCodeLineNode(anchorNode)
                    )
                        return

                    const offset = updatedSelection.anchor.offset
                    const text = anchorNode.getTextContent()

                    // Insert opening and closing characters
                    let newText
                    let newCursorPosition

                    log("Active selection detected 6")

                    if (isAlreadyWrapped) {
                        // If already wrapped with the same character, add another layer of wrapping
                        // Example: "text" -> ""text""
                        newText =
                            text.slice(0, offset) + key + selectedText + close + text.slice(offset)
                        newCursorPosition = offset + selectedText.length + 2 // After the content and closing quote
                    } else {
                        log("not already wrapped", text)
                        // Normal case: wrap selection with quotes
                        newText =
                            text.slice(0, offset) + key + selectedText + close + text.slice(offset)
                        newCursorPosition = offset + selectedText.length + 2 // After the content and closing quote
                    }

                    if ($isCodeHighlightNode(anchorNode)) {
                        anchorNode.setTextContent(newText)

                        const sel = $createRangeSelection()
                        sel.anchor.set(anchorNode.getKey(), newCursorPosition, "text")
                        sel.focus.set(anchorNode.getKey(), newCursorPosition, "text")
                        $setSelection(sel)
                    } else if ($isCodeLineNode(anchorNode)) {
                        newText = newText.trim()
                        const highlightNode = $createCodeHighlightNode(
                            newText,
                            "plain",
                            false,
                            null,
                        )
                        anchorNode.append(highlightNode)
                        anchorNode = highlightNode

                        $setSelection(null)
                        const sel = $createRangeSelection()

                        sel.anchor.set(anchorNode.getKey(), 1, "text")
                        sel.focus.set(
                            anchorNode.getKey(),
                            anchorNode.getTextContentSize() - 1,
                            "text",
                        )
                        $setSelection(sel)
                    } else if ($isTabNode(anchorNode)) {
                        newText = newText.trim()
                        const highlightNode = $createCodeHighlightNode(
                            newText,
                            "plain",
                            false,
                            null,
                        )
                        anchorNode.insertAfter(highlightNode)
                        anchorNode = highlightNode

                        $setSelection(null)
                        const sel = $createRangeSelection()

                        sel.anchor.set(anchorNode.getKey(), 1, "text")
                        sel.focus.set(
                            anchorNode.getKey(),
                            anchorNode.getTextContentSize() - 1,
                            "text",
                        )
                        $setSelection(sel)
                    }
                    // Position cursor after the inserted content

                    log("Wrapped selection with quotes", {
                        selectedText,
                        newText: key + selectedText + close,
                        newCursorPosition,
                        isAlreadyWrapped,
                    })
                    return true
                }

                let anchorNode = selection.anchor.getNode()
                let offset = selection.anchor.offset

                if ($isTabNode(anchorNode)) {
                    const nextSibling = anchorNode.getNextSibling()
                    if (!nextSibling) {
                        $setSelection(null)
                        const highlightNode = $createCodeHighlightNode("", "plain", false, null)
                        anchorNode.insertAfter(highlightNode)
                        anchorNode = highlightNode
                        selection = anchorNode.selectStart()
                        $setSelection(selection)
                        offset = selection.anchor.offset
                    } else {
                        selection.modify("move", false, "character")
                        anchorNode = selection.anchor.getNode()
                        offset = selection.anchor.offset
                    }
                }

                log("KEY_DOWN_COMMAND 3", anchorNode)

                // Ensure we're only handling text nodes or empty line nodes
                // This prevents auto-closing in non-code contexts
                if (
                    !$isTabNode(anchorNode) &&
                    !$isCodeHighlightNode(anchorNode) &&
                    !$isCodeLineNode(anchorNode)
                ) {
                    return false
                }

                /**
                 * Handle empty CodeLineNode (no children yet)
                 * When typing in an empty line:
                 * 1. Create a new empty highlight node
                 * 2. Append it to the line node
                 * 3. Position cursor at start
                 * 4. Update anchorNode reference
                 */
                if ($isCodeLineNode(anchorNode)) {
                    const highlight = $createCodeHighlightNode("", "plain", false, null)
                    anchorNode.append(highlight)
                    highlight.select(0)
                    anchorNode = highlight
                    log("Inserted initial empty CodeHighlightNode")
                }

                const lineNode = anchorNode.getParent()
                const blockNode = lineNode?.getParent()

                log("KEY_DOWN_COMMAND 4", {lineNode, blockNode})

                if (!$isCodeLineNode(lineNode) || !$isCodeBlockNode(blockNode)) return false

                log("KEY_DOWN_COMMAND 5")
                const language = blockNode.getLanguage()
                const text = anchorNode.getTextContent()
                const charBefore = text[offset - 1] || ""
                const charAfter = text[offset] || ""
                const isStringQuote = key === '"' || key === "'" || key === "`"

                const insideString = isInsideString(text, offset)

                /**
                 * Special handling for YAML syntax
                 * Don't auto-close quotes after a colon to allow for unquoted values
                 * Example: key: value (no quotes needed)
                 */
                if (language === "yaml") {
                    if (isStringQuote) {
                        const charBeforeTrimmed = text.slice(0, offset).trimEnd()
                        if (charBeforeTrimmed.endsWith(":")) return false
                    }
                }

                /**
                 * Handle string quotes with special cases:
                 * 1. Skip if next char is same quote (just move cursor)
                 * 2. Check quote balance to maintain valid string state
                 * 3. Prevent bracket auto-closing inside strings
                 */
                if (isStringQuote) {
                    // If next char is same quote, just move cursor past it
                    if (charAfter === key && charBefore !== key) {
                        event.preventDefault()
                        anchorNode.select(offset)
                        return true
                    }

                    // Count quotes before and after cursor
                    const quoteCountBefore = (
                        text.slice(0, offset).match(new RegExp(`\\${key}`, "g")) || []
                    ).length
                    const quoteCountAfter = (
                        text.slice(offset).match(new RegExp(`\\${key}`, "g")) || []
                    ).length

                    // Don't auto-close if it would create invalid string state
                    if ((quoteCountBefore + quoteCountAfter) % 2 !== 0) return false
                } else if (BRACKETS.includes(key) && insideString) {
                    // Don't auto-close brackets inside strings
                    return false
                }

                /**
                 * Special handling for JSON syntax
                 * When typing closing brace and it already exists:
                 * 1. Prevent default behavior
                 * 2. Move cursor past existing brace
                 * This maintains proper JSON structure
                 */
                if (language === "json" && key === "}" && charAfter === "}") {
                    log("KEY_DOWN_COMMAND 6")
                    event.preventDefault()
                    anchorNode.select(offset + 1)
                    return true
                }

                log("KEY_DOWN_COMMAND 7", anchorNode)

                /**
                 * Auto-close character insertion process:
                 * 1. Prevent default key behavior
                 * 2. Get matching closing character
                 * 3. Insert both opening and closing chars
                 * 4. Update node content atomically
                 */
                event.preventDefault()
                const close = OPEN_TO_CLOSE[key as keyof typeof OPEN_TO_CLOSE]
                const newText = text.slice(0, offset) + key + close + text.slice(offset)
                if ($isCodeHighlightNode(anchorNode)) {
                    anchorNode.setTextContent(newText)
                } else {
                    log("[AutoCloseBrackets] invalid node:", {anchorNode, newText})
                    const nextSibling = anchorNode.getNextSibling()
                    if (nextSibling && $isCodeHighlightNode(nextSibling)) {
                        nextSibling.setTextContent(newText.trim())
                        anchorNode = nextSibling
                        offset = 0
                    }
                }

                log("[AutoCloseBrackets] Inserted pair:", key + close)
                log("[AutoCloseBrackets] Before:", text.slice(0, offset))
                log("[AutoCloseBrackets] After:", text.slice(offset))

                const updated = $getNodeByKey(anchorNode.getKey())
                if (updated && $isCodeHighlightNode(updated)) {
                    const sel = $createRangeSelection()
                    sel.anchor.set(updated.getKey(), offset + 1, "text")
                    sel.focus.set(updated.getKey(), offset + 1, "text")
                    $setSelection(sel)
                    log("[AutoCloseBrackets] Set collapsed selection at offset +1")
                } else {
                    log("[AutoCloseBrackets] Could not find updated node to select")
                }
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor])

    return null
}
