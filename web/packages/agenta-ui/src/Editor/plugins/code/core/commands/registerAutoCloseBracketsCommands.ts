import {createLogger} from "@agenta/shared/utils"
import {mergeRegister} from "@lexical/utils"
import {
    $createRangeSelection,
    $getNodeByKey,
    $getSelection,
    $isRangeSelection,
    $setSelection,
    COMMAND_PRIORITY_HIGH,
    KEY_DOWN_COMMAND,
    SELECTION_CHANGE_COMMAND,
    type LexicalEditor,
} from "lexical"

import {$createCodeHighlightNode, $isCodeHighlightNode} from "../../nodes/CodeHighlightNode"
import {$isCodeLineNode} from "../../nodes/CodeLineNode"
import {$isCodeTabNode} from "../../nodes/CodeTabNode"
import {$getCodeBlockForLine, $getLineCount} from "../../utils/segmentUtils"

const OPEN_TO_CLOSE = {
    '"': '"',
    "'": "'",
    "`": "`",
    "(": ")",
    "[": "]",
    "{": "}",
}

const BRACKETS = ["(", "[", "{"]

interface AutoCloseContext {
    nodeKey: string
    offset: number
    closingChar: string
    openingChar: string
}

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
const DEBUG_LOGS = false
/**
 * Auto-close bracket/quote insertion is O(line-length), not O(document-length).
 * The per-line cost (string slice + setTextContent) is trivially cheap regardless
 * of document size, so we use a very high threshold.  The expensive bracket-matching
 * search lives in registerClosingBracketIndentationCommands which has its own limit.
 *
 * Previously this was 2000 — when exceeded, the handler returned false and the
 * browser handled the keypress natively, which broke caret placement on empty
 * lines created by Enter (the char appeared on the wrong line).
 */
const MAX_LINES_FOR_AUTO_CLOSE_BRACKETS = Number.POSITIVE_INFINITY

export function registerAutoCloseBracketsCommands(editor: LexicalEditor): () => void {
    let autoCloseContext: AutoCloseContext | null = null

    return mergeRegister(
        editor.registerCommand(
            SELECTION_CHANGE_COMMAND,
            () => {
                if (autoCloseContext) {
                    autoCloseContext = null
                }
                return false
            },
            COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event: KeyboardEvent) => {
                DEBUG_LOGS && log("KEY_DOWN_COMMAND 1", event.key)
                let selection = $getSelection()
                if (!$isRangeSelection(selection)) return false

                DEBUG_LOGS && log("KEY_DOWN_COMMAND 2")
                const key = event.key
                if (!(key in OPEN_TO_CLOSE)) {
                    DEBUG_LOGS && log("KEY_DOWN_COMMAND 2 EXIT EARLY")
                    return false
                }

                const hasActiveSelection =
                    selection.anchor.key !== selection.focus.key ||
                    selection.anchor.offset !== selection.focus.offset

                if (hasActiveSelection) {
                    DEBUG_LOGS && log("Active selection detected")

                    const selectedText = selection.getTextContent()
                    const close = OPEN_TO_CLOSE[key as keyof typeof OPEN_TO_CLOSE]

                    const isAlreadyWrapped =
                        selectedText.length >= 2 &&
                        selectedText.startsWith(key) &&
                        selectedText.endsWith(close)

                    event.preventDefault()

                    DEBUG_LOGS && log("Active selection detected 2")
                    DEBUG_LOGS && log("Active selection detected 3")
                    selection.deleteCharacter(false)

                    DEBUG_LOGS && log("Active selection detected 4")
                    const updatedSelection = $getSelection()
                    if (!$isRangeSelection(updatedSelection)) return false

                    let anchorNode = updatedSelection.anchor.getNode()
                    DEBUG_LOGS && log("Active selection detected 5", anchorNode)
                    if (
                        !$isCodeHighlightNode(anchorNode) &&
                        !$isCodeTabNode(anchorNode) &&
                        !$isCodeLineNode(anchorNode)
                    ) {
                        return false
                    }

                    const offset = updatedSelection.anchor.offset
                    const text = anchorNode.getTextContent()

                    let newText
                    let newCursorPosition

                    DEBUG_LOGS && log("Active selection detected 6")

                    if (isAlreadyWrapped) {
                        newText =
                            text.slice(0, offset) + key + selectedText + close + text.slice(offset)
                        newCursorPosition = offset + selectedText.length + 2
                    } else {
                        DEBUG_LOGS && log("not already wrapped", text)
                        newText =
                            text.slice(0, offset) + key + selectedText + close + text.slice(offset)
                        newCursorPosition = offset + selectedText.length + 2
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

                    DEBUG_LOGS &&
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
                    } else if ($isCodeHighlightNode(nextSibling)) {
                        // Move selection directly to the sibling highlight node.
                        // selection.modify("move", false, "character") relies on
                        // the browser's cursor movement which skips empty text
                        // nodes — landing on the wrong line entirely.
                        anchorNode = nextSibling
                        const sel = nextSibling.selectStart()
                        $setSelection(sel)
                        selection = sel
                        offset = 0
                    } else {
                        selection.modify("move", false, "character")
                        anchorNode = selection.anchor.getNode()
                        offset = selection.anchor.offset
                    }
                }

                DEBUG_LOGS && log("KEY_DOWN_COMMAND 3", anchorNode)

                if (
                    !$isCodeTabNode(anchorNode) &&
                    !$isCodeHighlightNode(anchorNode) &&
                    !$isCodeLineNode(anchorNode)
                ) {
                    return false
                }

                if ($isCodeLineNode(anchorNode)) {
                    const highlight = $createCodeHighlightNode("", "plain", false, null)
                    anchorNode.append(highlight)
                    highlight.select(0)
                    anchorNode = highlight
                    DEBUG_LOGS && log("Inserted initial empty CodeHighlightNode")
                }

                const lineNode = anchorNode.getParent()
                if (!$isCodeLineNode(lineNode)) {
                    return false
                }
                const blockNode = $getCodeBlockForLine(lineNode)

                DEBUG_LOGS && log("KEY_DOWN_COMMAND 4", {lineNode, blockNode})

                if (!blockNode) {
                    return false
                }
                if ($getLineCount(blockNode) > MAX_LINES_FOR_AUTO_CLOSE_BRACKETS) {
                    return false
                }

                DEBUG_LOGS && log("KEY_DOWN_COMMAND 5")
                const language = blockNode.getLanguage()
                const text = anchorNode.getTextContent()
                const charAfter = text[offset] || ""
                const isStringQuote = key === '"' || key === "'" || key === "`"

                const insideString = isInsideString(text, offset)

                if (language === "yaml") {
                    if (isStringQuote) {
                        const charBeforeTrimmed = text.slice(0, offset).trimEnd()
                        if (charBeforeTrimmed.endsWith(":")) return false
                    }
                }

                const context = autoCloseContext
                if (context && context.closingChar === key) {
                    event.preventDefault()
                    const sel = $createRangeSelection()
                    sel.anchor.set(anchorNode.getKey(), offset + 1, "text")
                    sel.focus.set(anchorNode.getKey(), offset + 1, "text")
                    $setSelection(sel)

                    autoCloseContext = null
                    DEBUG_LOGS && log("[AutoClose] Skipped over closing character:", key)
                    return true
                } else if ($isCodeHighlightNode(anchorNode)) {
                    const nodeText = anchorNode.getTextContent()
                    const textFirst = nodeText[0]
                    const textLast = nodeText[nodeText.length - 1]
                    if (
                        isStringQuote &&
                        ((textFirst === "'" && textLast === "'") ||
                            (textFirst === '"' && textLast === '"'))
                    ) {
                        return false
                    }
                }

                if (context) {
                    DEBUG_LOGS && log("[AutoClose] Key press broke auto-close context")
                    autoCloseContext = null
                }

                if (isStringQuote) {
                    const isCurrentlyInsideString = isInsideString(text, offset)

                    if (isCurrentlyInsideString) {
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

                        if (quoteCount % 2 === 1) {
                            return false
                        }
                    }
                } else if (BRACKETS.includes(key) && insideString) {
                    return false
                }

                if (language === "json" && key === "}" && charAfter === "}") {
                    DEBUG_LOGS && log("KEY_DOWN_COMMAND 6")
                    event.preventDefault()
                    anchorNode.select(offset + 1)
                    return true
                }

                DEBUG_LOGS && log("KEY_DOWN_COMMAND 7", anchorNode)

                event.preventDefault()
                const close = OPEN_TO_CLOSE[key as keyof typeof OPEN_TO_CLOSE]
                const newText = text.slice(0, offset) + key + close + text.slice(offset)
                if ($isCodeHighlightNode(anchorNode)) {
                    anchorNode.setTextContent(newText)
                } else {
                    DEBUG_LOGS && log("[AutoCloseBrackets] invalid node:", {anchorNode, newText})
                    const nextSibling = anchorNode.getNextSibling()
                    if (nextSibling && $isCodeHighlightNode(nextSibling)) {
                        nextSibling.setTextContent(newText.trim())
                        anchorNode = nextSibling
                        offset = 0
                    }
                }

                DEBUG_LOGS && log("[AutoCloseBrackets] Inserted pair:", key + close)
                DEBUG_LOGS && log("[AutoCloseBrackets] Before:", text.slice(0, offset))
                DEBUG_LOGS && log("[AutoCloseBrackets] After:", text.slice(offset))

                const updated = $getNodeByKey(anchorNode.getKey())
                if (updated && $isCodeHighlightNode(updated)) {
                    const sel = $createRangeSelection()
                    sel.anchor.set(updated.getKey(), offset + 1, "text")
                    sel.focus.set(updated.getKey(), offset + 1, "text")
                    $setSelection(sel)

                    autoCloseContext = {
                        nodeKey: updated.getKey(),
                        offset: offset + 1,
                        closingChar: close,
                        openingChar: key,
                    }
                }
                return true
            },
            COMMAND_PRIORITY_HIGH,
        ),
    )
}
