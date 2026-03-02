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
import {useEffect, useRef} from "react"

import {createLogger} from "@agenta/shared/utils"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isRangeSelection,
    KEY_DOWN_COMMAND,
    $getNodeByKey,
    $setSelection,
    $createRangeSelection,
    COMMAND_PRIORITY_HIGH,
    SELECTION_CHANGE_COMMAND,
} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeHighlightNode, $createCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {$isCodeTabNode} from "../nodes/CodeTabNode"

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
const _PLUGIN_NAME = "AutoCloseBracketsPlugin"

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
    disabled: true,
})

/**
 * Interface for tracking auto-completion context
 */
interface AutoCloseContext {
    nodeKey: string
    offset: number
    closingChar: string
    openingChar: string
}

/**
 * React component that implements auto-closing behavior for brackets and quotes.
 * Integrates with Lexical editor to provide real-time bracket matching and indentation.
 *
 * Key features:
 * - Auto-closes matching characters
 * - State-based tracking of auto-completion context
 * - Handles multiple cursor positions
 * - Prevents unwanted closings inside strings
 * - Maintains proper indentation
 * - Uses plugin locking to prevent conflicts
 *
 * @returns null - This is a behavior-only plugin
 */
export function AutoCloseBracketsPlugin() {
    const [editor] = useLexicalComposerContext()

    // Track the current auto-completion context
    const autoCloseContextRef = useRef<AutoCloseContext | null>(null)

    useEffect(() => {
        // Clear auto-close context when selection changes
        const unregisterSelectionChange = editor.registerCommand(
            SELECTION_CHANGE_COMMAND,
            () => {
                // Clear context when selection changes (user moves cursor)
                if (autoCloseContextRef.current) {
                    autoCloseContextRef.current = null
                }
                return false
            },
            COMMAND_PRIORITY_HIGH,
        )

        const unregisterKeyDown = editor.registerCommand(
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
                    if (!$isRangeSelection(updatedSelection)) return false

                    let anchorNode = updatedSelection.anchor.getNode()
                    log("Active selection detected 5", anchorNode)
                    if (
                        !$isCodeHighlightNode(anchorNode) &&
                        !$isCodeTabNode(anchorNode) &&
                        !$isCodeLineNode(anchorNode)
                    )
                        return false

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
                    } else if ($isCodeTabNode(anchorNode)) {
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

                if ($isCodeTabNode(anchorNode)) {
                    const nextSibling = anchorNode.getNextSibling()
                    if (!nextSibling) {
                        $setSelection(null)
                        const highlightNode = $createCodeHighlightNode("", "plain", false, null)
                        anchorNode.insertAfter(highlightNode)
                        anchorNode = highlightNode
                        selection = anchorNode.selectStart()
                        if (!$isRangeSelection(selection)) return false
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
                    !$isCodeTabNode(anchorNode) &&
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
                 * VSCode-like smart quote handling:
                 * 1. If next char is same quote -> move cursor past it (skip over)
                 * 2. If we're at the end of a string -> move cursor past closing quote
                 * 3. If we're starting a new string -> auto-complete with pair
                 * 4. Prevent bracket auto-closing inside strings
                 */
                // Check if we should skip over a closing character based on auto-close context
                const context = autoCloseContextRef.current
                if (
                    context &&
                    // context.nodeKey === anchorNode.getKey() &&
                    // context.offset === offset &&
                    context.closingChar === key
                ) {
                    // We're in auto-close context and typing the closing character
                    // Skip over it instead of inserting
                    event.preventDefault()
                    const sel = $createRangeSelection()
                    sel.anchor.set(anchorNode.getKey(), offset + 1, "text")
                    sel.focus.set(anchorNode.getKey(), offset + 1, "text")
                    $setSelection(sel)

                    // Clear the context since we've used it
                    autoCloseContextRef.current = null
                    log("[AutoClose] Skipped over closing character:", key)
                    return true
                } else {
                    if ($isCodeHighlightNode(anchorNode)) {
                        // if this is a text bracket, and the node already is a text block with valid string opening
                        // and closing, do not autoclose this new bracket
                        const text = anchorNode.getTextContent()
                        const textFirst = text[0]
                        const textLast = text[text.length - 1]
                        if (
                            isStringQuote &&
                            ((textFirst === "'" && textLast === "'") ||
                                (textFirst === '"' && textLast === '"'))
                        ) {
                            return false
                        }
                    }
                }

                // Clear context on any other key press (breaks the auto-close chain)
                if (context) {
                    log("[AutoClose] Key press broke auto-close context")
                    autoCloseContextRef.current = null
                }

                if (isStringQuote) {
                    // Check if we're inside a string context
                    const isCurrentlyInsideString = isInsideString(text, offset)

                    // If we're inside a string and typing the same quote type,
                    // we might be trying to close the string
                    if (isCurrentlyInsideString) {
                        // Count unmatched quotes of this type before cursor
                        let quoteCount = 0
                        let escaped = false
                        for (let i = 0; i < offset; i++) {
                            const char = text[i]
                            if (char === "\\" && !escaped) {
                                escaped = true
                                continue
                            }
                            if (char === key && !escaped) {
                                quoteCount++
                            }
                            escaped = false
                        }

                        // If odd number of quotes, we're likely closing a string
                        // Don't auto-complete, just insert the closing quote
                        if (quoteCount % 2 === 1) {
                            // Let the default behavior handle this (just insert the quote)
                            return false
                        }
                    }

                    // Starting a new string - auto-complete with pair
                    // (This will be handled by the auto-close logic below)
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

                    // Set auto-close context for the inserted pair
                    autoCloseContextRef.current = {
                        nodeKey: updated.getKey(),
                        offset: offset + 1, // Position after opening char, before closing char
                        closingChar: close,
                        openingChar: key,
                    }

                    log("[AutoCloseBrackets] Set collapsed selection and auto-close context", {
                        offset: offset + 1,
                        closingChar: close,
                    })
                } else {
                    log("[AutoCloseBrackets] Could not find updated node to select")
                }
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )

        // Return cleanup function that unregisters both listeners
        return () => {
            unregisterSelectionChange()
            unregisterKeyDown()
        }
    }, [editor])

    return null
}
