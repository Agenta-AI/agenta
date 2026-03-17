// Editor.tsx - Code editor plugin with syntax highlighting

// Editor.tsx
import {type ComponentProps, type FC, memo, useEffect, useRef} from "react"

import {tryParsePartialJson, safeJson5Parse, createLogger} from "@agenta/shared/utils"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {mergeRegister} from "@lexical/utils"
import isEqual from "fast-deep-equal"
import {createStore, atom} from "jotai"
import yaml from "js-yaml"
import JSON5 from "json5"
import {
    $addUpdateTag,
    $getRoot,
    $getSelection,
    $isRangeSelection,
    COMMAND_PRIORITY_LOW,
    CONTROLLED_TEXT_INSERTION_COMMAND,
    COPY_COMMAND,
    CUT_COMMAND,
    createCommand,
    BLUR_COMMAND,
    FOCUS_COMMAND,
    KEY_BACKSPACE_COMMAND,
    KEY_DELETE_COMMAND,
    $setSelection,
    LexicalNode,
    SELECT_ALL_COMMAND,
} from "lexical"

import {INITIAL_CONTENT_COMMAND, InitialContentPayload} from "../../commands/InitialContentCommand"

export const store = createStore()

import PropertyClickPlugin from "./extensions/propertyClick"
import {$createBase64Node, isBase64String, parseBase64String} from "./nodes/Base64Node"
import {$createCodeBlockNode, $isCodeBlockNode} from "./nodes/CodeBlockNode"
import {$createCodeHighlightNode} from "./nodes/CodeHighlightNode"
import {$createCodeLineNode, CodeLineNode} from "./nodes/CodeLineNode"
import {$createCodeTabNode, $isCodeTabNode} from "./nodes/CodeTabNode"
import {$createLongTextNode, isLongTextString, parseLongTextString} from "./nodes/LongTextNode"
import {$getEditorCodeAsString} from "./utils/editorCodeUtils"
import {showEditorLoadingOverlay} from "./utils/loadingOverlay"
import {$wrapLinesInSegments, $getAllCodeLines, $getLineCount} from "./utils/segmentUtils"
import {tokenizeCodeLine} from "./utils/tokenizer"
import type {CodeLanguage} from "./types"

export {PropertyClickPlugin}

export const TOGGLE_FORM_VIEW = createCommand<void>("TOGGLE_FORM_VIEW")

export const DRILL_IN_TO_PATH = createCommand<{path: string}>("DRILL_IN_TO_PATH")

export const ON_CHANGE_LANGUAGE = createCommand<{
    language: CodeLanguage
}>("ON_CHANGE_LANGUAGE")

export const editorStateAtom = atom({
    focused: false,
})

store.set(editorStateAtom, {focused: false})

const log = createLogger("Code Editor", {
    disabled: true,
})
export const BULK_CLEAR_UPDATE_TAG = "agenta:bulk-clear"

const BULK_CLEAR_LINE_THRESHOLD = 500

const LARGE_DOC_INITIAL_HIGHLIGHT_CHAR_THRESHOLD = 50000
const LARGE_DOC_INITIAL_HIGHLIGHT_LINE_THRESHOLD = 1200
// Keep a very high cap so normal "large" payloads still get full initial highlight.
// This guard remains only for extreme payloads.
const LARGE_DOC_INITIAL_TOKENIZE_LINE_LIMIT = 12000

/**
 * Simple validation function for JSON tokens
 */
function getTokenValidation(
    text: string,
    tokenType: string,
    language: string,
): {shouldHaveError: boolean; expectedMessage: string | null} {
    // JSON syntax validation for unquoted property names
    if (language === "json" && tokenType === "plain") {
        const trimmed = text.trim()
        if (!trimmed) {
            return {shouldHaveError: false, expectedMessage: null}
        }

        // Numbers, booleans and null are allowed as values
        const n = Number(trimmed)
        const isNumeric = !Number.isNaN(n)
        const isBooleanOrNull = trimmed === "true" || trimmed === "false" || trimmed === "null"

        // Looks like an identifier (what a property name would look like)
        const identifierRegex = /^[A-Za-z_$][A-Za-z0-9_$]*$/

        if (identifierRegex.test(trimmed) && !isNumeric && !isBooleanOrNull) {
            return {
                shouldHaveError: true,
                expectedMessage: "Property names must be wrapped in double quotes",
            }
        }
    }
    return {shouldHaveError: false, expectedMessage: null}
}

/**
 * Creates an array of highlighted code line nodes from a given text and language.
 *
 * @param text The input text to highlight.
 * @param language The language to use for highlighting.
 * @param validationSchema Optional schema for validation during node creation.
 * @param disableLongText If true, disable long text node truncation (show full strings)
 * @returns An array of highlighted code line nodes.
 */
export function createHighlightedNodes(
    text: string,
    language: CodeLanguage,
    disableLongText?: boolean,
): CodeLineNode[] {
    // For JSON, avoid splitting on \n inside string values
    if (language === "json") {
        try {
            // Only parse and pretty-print if input is compact (no indentation)
            const isCompactJson =
                typeof text === "string" &&
                (text.trim().startsWith("{") || text.trim().startsWith("[")) &&
                !text.includes("\n  ")
            let pretty = text
            if (isCompactJson) {
                const obj = JSON5.parse(text)
                pretty = JSON.stringify(obj, null, 2)
            }

            // Split pretty-printed JSON into lines
            const lines = pretty.split("\n")
            const shouldLimitInitialTokenization =
                pretty.length >= LARGE_DOC_INITIAL_HIGHLIGHT_CHAR_THRESHOLD ||
                lines.length >= LARGE_DOC_INITIAL_HIGHLIGHT_LINE_THRESHOLD
            const codeLineNodes: CodeLineNode[] = []
            lines.forEach((line, lineIndex) => {
                const codeLine = $createCodeLineNode()
                let content = line
                while (content.startsWith("  ")) {
                    codeLine.append($createCodeTabNode())
                    content = content.substring(2)
                }

                if (
                    shouldLimitInitialTokenization &&
                    lineIndex >= LARGE_DOC_INITIAL_TOKENIZE_LINE_LIMIT
                ) {
                    codeLine.append($createCodeHighlightNode(content, "plain", false, null))
                    codeLineNodes.push(codeLine)
                    return
                }

                const tokens = tokenizeCodeLine(content, language)
                tokens.forEach((token) => {
                    // Check if this is a base64 string token
                    if (token.type === "string" && isBase64String(token.content)) {
                        const parsed = parseBase64String(token.content)
                        const base64Node = $createBase64Node(
                            parsed.fullValue,
                            parsed.mimeType,
                            token.type,
                        )
                        codeLine.append(base64Node)
                    } else if (
                        token.type === "string" &&
                        !disableLongText &&
                        isLongTextString(token.content)
                    ) {
                        // Check if this is a long text string token
                        const parsed = parseLongTextString(token.content)
                        const longTextNode = $createLongTextNode(parsed.fullValue, token.type)
                        codeLine.append(longTextNode)
                    } else {
                        const {shouldHaveError, expectedMessage} = getTokenValidation(
                            token.content.trim(),
                            token.type,
                            language,
                        )
                        const highlightNode = $createCodeHighlightNode(
                            token.content,
                            token.type,
                            shouldHaveError,
                            expectedMessage,
                        )
                        if (token.style) {
                            highlightNode.setStyle(token.style)
                        }
                        codeLine.append(highlightNode)
                    }
                })
                codeLineNodes.push(codeLine)
            })

            return codeLineNodes
        } catch (e) {
            // If invalid JSON, fallback to generic line splitting below
        }
    }
    // Fallback: generic line splitting (for non-JSON or invalid JSON)
    const lines = text.split("\n")
    const shouldLimitInitialTokenization =
        text.length >= LARGE_DOC_INITIAL_HIGHLIGHT_CHAR_THRESHOLD ||
        lines.length >= LARGE_DOC_INITIAL_HIGHLIGHT_LINE_THRESHOLD
    const codeLineNodes: CodeLineNode[] = []
    lines.forEach((line, lineIndex) => {
        const codeLine = $createCodeLineNode()
        let content = line
        while (content.startsWith("  ")) {
            codeLine.append($createCodeTabNode())
            content = content.substring(2)
        }

        if (shouldLimitInitialTokenization && lineIndex >= LARGE_DOC_INITIAL_TOKENIZE_LINE_LIMIT) {
            codeLine.append($createCodeHighlightNode(content, "plain", false, null))
            codeLineNodes.push(codeLine)
            return
        }

        const tokens = tokenizeCodeLine(content, language)
        tokens.forEach((token) => {
            // Check if this is a base64 string token
            if (token.type === "string" && isBase64String(token.content)) {
                const parsed = parseBase64String(token.content)
                const base64Node = $createBase64Node(parsed.fullValue, parsed.mimeType, token.type)
                codeLine.append(base64Node)
            } else if (
                token.type === "string" &&
                !disableLongText &&
                isLongTextString(token.content)
            ) {
                // Check if this is a long text string token
                const parsed = parseLongTextString(token.content)
                const longTextNode = $createLongTextNode(parsed.fullValue, token.type)
                codeLine.append(longTextNode)
            } else {
                const {shouldHaveError, expectedMessage} = getTokenValidation(
                    token.content.trim(),
                    token.type,
                    language,
                )
                const highlightNode = $createCodeHighlightNode(
                    token.content,
                    token.type,
                    shouldHaveError,
                    expectedMessage,
                )
                if (token.style) {
                    highlightNode.setStyle(token.style)
                }
                codeLine.append(highlightNode)
            }
        })
        codeLineNodes.push(codeLine)
    })

    return codeLineNodes
}
/**
 * Plugin that initializes the editor with an empty code block.
 *
 * This plugin runs once when the editor mounts and:
 * 1. Checks for existing code blocks to avoid duplication
 * 2. If no code block exists, creates a new empty JSON code block
 * 3. Ensures the editor always has a valid code block to edit
 */
function InsertInitialCodeBlockPlugin({
    initialValue,
    language = "json",
    onPropertyClick,
    disableLongText = false,
}: {
    initialValue: string
    language?: CodeLanguage
    onPropertyClick?: (path: string) => void
    disableLongText?: boolean
}) {
    const [editor] = useLexicalComposerContext()

    // const isInitRef = useRef(false)

    const prevInitialRef = useRef<string | undefined>(undefined)
    const prevLanguageRef = useRef<string | undefined>(undefined)

    useEffect(() => {
        return mergeRegister(
            editor.registerCommand(
                INITIAL_CONTENT_COMMAND,
                (payload) => {
                    // If another plugin handled the content, skip default processing
                    if (payload.isDefaultPrevented()) {
                        return false // Command not handled by this plugin
                    }

                    // Default JSON/YAML processing
                    editor.update(
                        () => {
                            const hasFocus = store.get(editorStateAtom)?.focused
                            const root = $getRoot()
                            let existingCodeBlock = root.getChildren().find($isCodeBlockNode)

                            if (!existingCodeBlock) {
                                log("INITIAL VALUE CHANGED - CREATE NEW CODE BLOCK")
                                root.clear()
                                existingCodeBlock = $createCodeBlockNode(payload.language)
                                const line = $createCodeLineNode()
                                existingCodeBlock.append(line)

                                root.append(existingCodeBlock)
                                line.selectStart()
                            } else if (hasFocus && editor.isEditable() && !payload.forceUpdate) {
                                // Don't update if editor has focus and is editable (user is typing)
                                // But allow updates for read-only editors (like diff view)
                                // Also allow forceUpdate for undo/redo operations
                                return
                            }

                            // Default processing for JSON/YAML content
                            const currentTextValue = $getEditorCodeAsString()
                            log("INITIAL VALUE CHANGED - CURRENT TEXT VALUE", {currentTextValue})
                            // Skip semantic equality check if forceUpdate is true (for undo/redo)
                            if (currentTextValue && !payload.forceUpdate) {
                                try {
                                    const currentObjectValue = JSON5.parse(currentTextValue)
                                    const incomingObjectValue =
                                        typeof payload.content === "string"
                                            ? JSON5.parse(payload.content)
                                            : payload.content
                                    if (isEqual(currentObjectValue, incomingObjectValue)) {
                                        log("DO NOT CLEAR AND RECONSTRUCT 1", {
                                            content: payload.content,
                                            currentTextValue,
                                        })
                                        return
                                    }
                                } catch (e) {
                                    try {
                                        const currentObject = tryParsePartialJson(currentTextValue)
                                        const incomingObject =
                                            typeof payload.content === "string"
                                                ? JSON5.parse(payload.content)
                                                : payload.content

                                        if (isEqual(currentObject, incomingObject)) {
                                            log("DO NOT CLEAR AND RECONSTRUCT 2")
                                            return
                                        } else {
                                            const trimmedIncoming =
                                                typeof payload.content === "string"
                                                    ? payload.content.trim()
                                                    : JSON5.stringify(payload.content).trim()

                                            if (currentTextValue.trim() === trimmedIncoming) {
                                                log("DO NOT CLEAR AND RECONSTRUCT 3")
                                                return
                                            }
                                        }
                                    } catch (e) {
                                        log("there was an error parsing to json", {
                                            e,
                                            content: payload.content,
                                            currentTextValue,
                                        })
                                    }
                                }
                            }

                            if (currentTextValue) {
                                editor.setEditable(false)
                            }
                            log("INITIAL VALUE CHANGED - CHANGE CONTENT", {currentTextValue})
                            // TODO: Instead of clearing and re-adding, we should do a diff check and edit updated nodes only
                            try {
                                let value: string
                                // For JSON/YAML content, parse and format
                                if (payload.language === "json") {
                                    const objectValue = JSON5.parse(payload.content)
                                    value = JSON.stringify(objectValue, null, 2)
                                } else if (payload.language === "yaml") {
                                    const objectValue = payload.content
                                    try {
                                        const obj = yaml.load(objectValue)
                                        if (obj !== undefined) {
                                            value = yaml.dump(obj, {indent: 2})
                                        } else {
                                            value = objectValue
                                        }
                                    } catch {
                                        // Try JSON as a fallback and then dump to YAML for consistent highlighting
                                        try {
                                            const obj = JSON5.parse(objectValue)
                                            value = yaml.dump(obj, {indent: 2})
                                        } catch {
                                            value = objectValue
                                        }
                                    }
                                } else {
                                    // For code languages (python, javascript, typescript), keep as-is
                                    value = payload.content
                                }
                                log(" Reconstructing code block due to prop change", {
                                    language: payload.language,
                                    value,
                                })

                                // For large content, defer the heavy node creation so the
                                // browser can paint a loading overlay first.
                                const lineCount = value.split("\n").length
                                if (lineCount >= LARGE_DOC_INITIAL_HIGHLIGHT_LINE_THRESHOLD) {
                                    // Capture values for the deferred callback
                                    const capturedLanguage = payload.language as CodeLanguage
                                    const capturedDisableLongText = disableLongText

                                    // Clear existing content and show a single empty line
                                    // so the current update finishes quickly.
                                    existingCodeBlock.clear()
                                    const placeholder = $createCodeLineNode()
                                    existingCodeBlock.append(placeholder)
                                    $setSelection(null)

                                    if (!store.get(editorStateAtom)?.focused) {
                                        editor.setEditable(true)
                                    }

                                    // Show overlay and defer heavy work
                                    const removeOverlay = showEditorLoadingOverlay(editor)
                                    setTimeout(() => {
                                        editor.update(
                                            () => {
                                                $addUpdateTag("agenta:initial-content")
                                                const root = $getRoot()
                                                const codeBlock = root
                                                    .getChildren()
                                                    .find($isCodeBlockNode)
                                                if (!codeBlock) return

                                                codeBlock.clear()
                                                const highlightedNodes = createHighlightedNodes(
                                                    value,
                                                    capturedLanguage,
                                                    capturedDisableLongText,
                                                )
                                                $wrapLinesInSegments(highlightedNodes).forEach(
                                                    (node) => {
                                                        codeBlock.append(node)
                                                    },
                                                )

                                                if (!store.get(editorStateAtom)?.focused) {
                                                    editor.setEditable(true)
                                                    $setSelection(null)
                                                }
                                            },
                                            {
                                                tag: "agenta:initial-content",
                                                onUpdate: () => {
                                                    removeOverlay?.()
                                                },
                                            },
                                        )
                                    }, 0)

                                    return
                                }

                                existingCodeBlock.clear()
                                log("CLEAR AND RECONSTRUCT", {
                                    content: payload.content,
                                    currentTextValue,
                                })
                                const highlightedNodes = createHighlightedNodes(
                                    value,
                                    payload.language,
                                    disableLongText,
                                )
                                $wrapLinesInSegments(highlightedNodes).forEach((node) => {
                                    existingCodeBlock.append(node)
                                })

                                const hasFocus = store.get(editorStateAtom)?.focused

                                if (!hasFocus) {
                                    editor.setEditable(true)
                                    $setSelection(null)
                                }
                            } catch (err) {
                                log("failed values", {
                                    existingCodeBlock,
                                    content: payload.content,
                                    type: typeof payload.content,
                                    err,
                                })

                                if (!editor.isEditable()) {
                                    editor.setEditable(true)
                                }
                            }
                        },
                        {tag: "agenta:initial-content"},
                    )

                    return true // Command handled
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand(
                ON_CHANGE_LANGUAGE,
                (payload) => {
                    const hasFocus = store.get(editorStateAtom)?.focused
                    // Temporarily disable editing if editor is not focused to avoid unwanted cursor jumps
                    if (!hasFocus) {
                        editor.setEditable(false)
                    }
                    const root = $getRoot()
                    const existingCodeBlock = root.getChildren().filter($isCodeBlockNode)[0]
                    const oldLanguage = existingCodeBlock.getLanguage() as CodeLanguage
                    const newLanguage = payload.language as CodeLanguage
                    log(" ON_CHANGE_LANGUAGE triggered", {oldLanguage, newLanguage})
                    if (oldLanguage === newLanguage) {
                        existingCodeBlock.setLanguage(newLanguage)
                        return true
                    }

                    // Extract current code string
                    const lines = $getAllCodeLines(existingCodeBlock).map((line: CodeLineNode) => {
                        return line
                            .getChildren()
                            .map((child: LexicalNode) =>
                                $isCodeTabNode(child) ? "  " : child.getTextContent(),
                            )
                            .join("")
                    })
                    const currentCode = lines.join("\n").trim()

                    if (currentCode === "") {
                        log(" Empty code, skipping parsing and clearing code block")

                        existingCodeBlock.clear()
                        existingCodeBlock.setLanguage(newLanguage)

                        const emptyLine = $createCodeLineNode()
                        existingCodeBlock.append(emptyLine)

                        if (!hasFocus) {
                            editor.setEditable(true)
                            $setSelection(null)
                        }

                        return true
                    }
                    log(" Extracted current code", {currentCode})

                    let obj: unknown = null
                    let newText = ""

                    // For code languages (python, javascript, typescript), keep text as-is
                    if (
                        oldLanguage !== "json" &&
                        oldLanguage !== "yaml" &&
                        newLanguage !== "json" &&
                        newLanguage !== "yaml"
                    ) {
                        // Both are code languages, just keep the current code
                        newText = currentCode
                    } else if (oldLanguage !== "json" && oldLanguage !== "yaml") {
                        // Converting from code language to JSON/YAML - not supported, keep as-is
                        newText = currentCode
                    } else if (newLanguage !== "json" && newLanguage !== "yaml") {
                        // Converting from JSON/YAML to code language - not supported, keep as-is
                        newText = currentCode
                    } else {
                        // Both are JSON/YAML, do conversion
                        // Attempt to parse the existing code string
                        log(" Attempting to parse existing code", {oldLanguage})
                        try {
                            if (oldLanguage === "json") {
                                obj = JSON5.parse(currentCode)
                            } else {
                                obj = yaml.load(currentCode)
                            }
                        } catch (err) {
                            console.error("Failed to parse old code during language switch", err)
                            existingCodeBlock.setLanguage(newLanguage)
                            return true
                        }

                        log(" Parsed object from current code", {obj})
                        try {
                            if (newLanguage === "json") {
                                newText = JSON.stringify(obj, null, 2)
                            } else {
                                newText = yaml.dump(obj, {indent: 2})
                                log(" Stringified object in new language", {newText})
                            }
                        } catch (err) {
                            console.error(
                                "Failed to stringify new code during language switch",
                                err,
                            )
                            existingCodeBlock.setLanguage(newLanguage)
                            return true
                        }
                    }

                    $addUpdateTag("agenta:initial-content")
                    existingCodeBlock.clear()
                    const newNodes = createHighlightedNodes(newText, newLanguage, disableLongText)
                    $wrapLinesInSegments(newNodes).forEach((n) => existingCodeBlock.append(n))
                    existingCodeBlock.setLanguage(newLanguage)

                    // Re-enable editing and clear selection if the editor was not focused before the change
                    if (!hasFocus) {
                        editor.setEditable(true)
                        $setSelection(null)
                    }
                    return true
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand(
                BLUR_COMMAND,
                () => {
                    store.set(editorStateAtom, {focused: false})
                    return false
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand(
                FOCUS_COMMAND,
                () => {
                    store.set(editorStateAtom, {focused: true})
                    return false
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand(
                SELECT_ALL_COMMAND,
                () => {
                    const rootElement = editor.getRootElement()
                    if (!rootElement) {
                        return false
                    }

                    const activeElement =
                        typeof document !== "undefined" ? document.activeElement : null

                    const selectAllInEditor = () => {
                        editor.update(() => {
                            const root = $getRoot()
                            const codeBlock = root.getChildren().find($isCodeBlockNode)

                            if (codeBlock) {
                                // Select the content of the code block, not the entire root,
                                // so deleting does not remove the block itself.
                                codeBlock.select()
                            } else {
                                // Fallback: select the entire root if no code block exists
                                root.select()
                            }
                        })

                        if (typeof window === "undefined" || typeof document === "undefined") {
                            return
                        }

                        const ensureNativeSelection = () => {
                            const domSelection = window.getSelection()
                            if (!domSelection || domSelection.toString().length > 0) {
                                return
                            }

                            domSelection.removeAllRanges()
                            const range = document.createRange()
                            range.selectNodeContents(rootElement)
                            domSelection.addRange(range)
                        }

                        if (typeof requestAnimationFrame === "function") {
                            requestAnimationFrame(ensureNativeSelection)
                        } else {
                            setTimeout(ensureNativeSelection, 0)
                        }
                    }

                    if (
                        !activeElement ||
                        (activeElement !== rootElement && !rootElement.contains(activeElement))
                    ) {
                        rootElement.focus({preventScroll: true})
                        setTimeout(selectAllInEditor, 0)
                        return true
                    }

                    selectAllInEditor()

                    return true
                },
                COMMAND_PRIORITY_LOW,
            ),
            // Copy handler: virtualization detaches DOM children from hidden
            // lines, so the browser's native copy only captures visible text.
            // Intercept COPY_COMMAND and write the full Lexical model text to
            // the clipboard so Cmd+A → Cmd+C works on large documents.
            editor.registerCommand(
                COPY_COMMAND,
                (event) => {
                    const root = $getRoot()
                    const codeBlock = root.getChildren().find($isCodeBlockNode)
                    if (!codeBlock) return false

                    // Only intercept when there are hidden (virtualized) lines.
                    // For small documents without virtualization, let the browser
                    // handle copy natively.
                    const rootElement = editor.getRootElement()
                    if (!rootElement) return false
                    const hasHiddenLines =
                        rootElement.querySelector(".editor-code-line.virtual-hidden") !== null
                    if (!hasHiddenLines) return false

                    const fullText = $getEditorCodeAsString()

                    if (event instanceof ClipboardEvent && event.clipboardData) {
                        event.preventDefault()
                        event.clipboardData.setData("text/plain", fullText)
                    } else {
                        // KeyboardEvent path — write via async clipboard API
                        navigator.clipboard.writeText(fullText).catch(() => {
                            // Silently fail — user's clipboard is unchanged
                        })
                    }

                    return true
                },
                COMMAND_PRIORITY_LOW,
            ),
            // Bulk-clear helpers: when a large non-collapsed selection exists
            // (500+ lines), replace the code block with a single empty line
            // instead of letting Lexical remove 30k+ nodes individually
            // (which triggers O(n²) transform cascades).
            // Returns the new empty CodeLineNode, or null if bulk-clear
            // didn't apply.
            (() => {
                const $tryBulkClear = (): CodeLineNode | null => {
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection) || selection.isCollapsed()) {
                        return null
                    }

                    const root = $getRoot()
                    const codeBlock = root.getChildren().find($isCodeBlockNode)
                    if (!codeBlock) return null

                    const lineCount = $getLineCount(codeBlock)
                    if (lineCount < BULK_CLEAR_LINE_THRESHOLD) return null

                    // Only bulk-clear when the selection covers all content
                    // (e.g. Ctrl+A then Delete). For partial selections, let
                    // Lexical handle deletion normally to avoid data loss.
                    const selectedText = selection.getTextContent()
                    const fullText = codeBlock.getTextContent()
                    if (selectedText.length < fullText.length) return null

                    $addUpdateTag(BULK_CLEAR_UPDATE_TAG)
                    const lang = codeBlock.getLanguage()
                    root.clear()
                    const newCodeBlock = $createCodeBlockNode(lang)
                    const emptyLine = $createCodeLineNode()
                    newCodeBlock.append(emptyLine)
                    root.append(newCodeBlock)
                    emptyLine.selectStart()
                    return emptyLine
                }

                return mergeRegister(
                    editor.registerCommand(
                        KEY_BACKSPACE_COMMAND,
                        (event) => {
                            const cleared = $tryBulkClear()
                            if (!cleared) return false
                            event.preventDefault()
                            return true
                        },
                        COMMAND_PRIORITY_LOW,
                    ),
                    editor.registerCommand(
                        KEY_DELETE_COMMAND,
                        (event) => {
                            const cleared = $tryBulkClear()
                            if (!cleared) return false
                            event.preventDefault()
                            return true
                        },
                        COMMAND_PRIORITY_LOW,
                    ),
                    // Typing a character while all text is selected also
                    // triggers selection removal — handle it the same way.
                    editor.registerCommand(
                        CONTROLLED_TEXT_INSERTION_COMMAND,
                        (payload) => {
                            const cleared = $tryBulkClear()
                            if (!cleared) return false

                            // Insert the typed text on the now-empty line
                            const text =
                                typeof payload === "string"
                                    ? payload
                                    : ((payload as InputEvent).data ?? "")
                            if (text) {
                                const sel = $getSelection()
                                if ($isRangeSelection(sel)) {
                                    sel.insertText(text)
                                }
                            }
                            return true
                        },
                        COMMAND_PRIORITY_LOW,
                    ),
                    // Cut = copy + delete. Reuse the copy logic for
                    // virtualized content, then bulk-clear.
                    editor.registerCommand(
                        CUT_COMMAND,
                        (event) => {
                            const root = $getRoot()
                            const codeBlock = root.getChildren().find($isCodeBlockNode)
                            if (!codeBlock) return false

                            const lineCount = $getLineCount(codeBlock)
                            if (lineCount < BULK_CLEAR_LINE_THRESHOLD) return false

                            const selection = $getSelection()
                            if (!$isRangeSelection(selection) || selection.isCollapsed()) {
                                return false
                            }

                            // Copy full text to clipboard
                            const fullText = $getEditorCodeAsString()
                            if (event instanceof ClipboardEvent && event.clipboardData) {
                                event.preventDefault()
                                event.clipboardData.setData("text/plain", fullText)
                            } else {
                                navigator.clipboard.writeText(fullText).catch(() => {})
                            }

                            // Then bulk-clear
                            $tryBulkClear()
                            return true
                        },
                        COMMAND_PRIORITY_LOW,
                    ),
                )
            })(),
        )
    }, [])

    useEffect(() => {
        const languageChanged =
            prevLanguageRef.current !== undefined && prevLanguageRef.current !== language

        // For JSON content, use semantic comparison. YAML should be treated as raw text.
        // Always proceed if the language itself changed (re-tokenization needed).
        if (prevInitialRef.current && !languageChanged) {
            if (language === "json") {
                if (
                    isEqual(
                        safeJson5Parse(prevInitialRef.current as string),
                        safeJson5Parse(initialValue),
                    )
                ) {
                    return // no semantic change
                }
            } else if (prevInitialRef.current === initialValue) {
                return
            }
        }

        prevInitialRef.current = initialValue
        prevLanguageRef.current = language

        // Check if this is an external update (undo/redo) by comparing with current editor content
        // If the incoming value differs from what's in the editor, force the update
        let forceUpdate = false
        editor.getEditorState().read(() => {
            const currentEditorContent = $getEditorCodeAsString()
            // console.log("currentEditorContent", currentEditorContent)
            if (currentEditorContent) {
                try {
                    const currentParsed = safeJson5Parse(currentEditorContent)
                    const incomingParsed = safeJson5Parse(initialValue)
                    // If editor content differs from incoming value, this is an external update
                    if (!isEqual(currentParsed, incomingParsed)) {
                        forceUpdate = true
                    }
                } catch {
                    // If parsing fails, compare as strings
                    if (currentEditorContent.trim() !== initialValue.trim()) {
                        forceUpdate = true
                    }
                }
            }
        })

        // Dispatch event to allow other plugins to handle the content
        let defaultPrevented = false
        const payload: InitialContentPayload = {
            content: initialValue,
            language,
            preventDefault: () => {
                defaultPrevented = true
            },
            isDefaultPrevented: () => defaultPrevented,
            forceUpdate,
        }

        log("INITIAL VALUE CHANGED", {initialValue, forceUpdate})
        editor.dispatchCommand(INITIAL_CONTENT_COMMAND, payload)
    }, [initialValue, language])

    return null
}

type InsertInitialCodeBlockProps = ComponentProps<typeof InsertInitialCodeBlockPlugin>
const InsertInitialCodeBlockPluginWrapper: FC<InsertInitialCodeBlockProps> = (props) => {
    return <InsertInitialCodeBlockPlugin {...props} />
}

export default memo(InsertInitialCodeBlockPluginWrapper)
