// Editor.tsx
import {Fragment, type ComponentProps, type FC, memo, useEffect, useRef} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {mergeRegister} from "@lexical/utils"
import isEqual from "fast-deep-equal"
import {createStore, atom} from "jotai"
import yaml from "js-yaml"
import JSON5 from "json5"
import {
    $getRoot,
    COMMAND_PRIORITY_LOW,
    createCommand,
    BLUR_COMMAND,
    FOCUS_COMMAND,
    $setSelection,
    LexicalNode,
    SELECT_ALL_COMMAND,
} from "lexical"

import {safeJson5Parse} from "@/oss/lib/helpers/utils"

import {INITIAL_CONTENT_COMMAND, InitialContentPayload} from "../../commands/InitialContentCommand"

export const store = createStore()

import {$createCodeBlockNode, $isCodeBlockNode} from "./nodes/CodeBlockNode"
import {$createCodeHighlightNode} from "./nodes/CodeHighlightNode"
import {$createCodeLineNode, CodeLineNode, $isCodeLineNode} from "./nodes/CodeLineNode"
import {$createCodeTabNode, $isCodeTabNode} from "./nodes/CodeTabNode"
import {AutoCloseBracketsPlugin} from "./plugins/AutoCloseBracketsPlugin"
import {AutoFormatAndValidateOnPastePlugin} from "./plugins/AutoFormatAndValidateOnPastePlugin"
import {ClosingBracketIndentationPlugin} from "./plugins/ClosingBracketIndentationPlugin"
import {GlobalErrorIndicatorPlugin} from "./plugins/GlobalErrorIndicatorPlugin"
import {IndentationPlugin} from "./plugins/IndentationPlugin"
import {$getEditorCodeAsString} from "./plugins/RealTimeValidationPlugin"
import {SyntaxHighlightPlugin} from "./plugins/SyntaxHighlightPlugin"
import VerticalNavigationPlugin from "./plugins/VerticalNavigationPlugin"
import {tryParsePartialJson} from "./tryParsePartialJson"
import {createLogger} from "./utils/createLogger"
import {tokenizeCodeLine} from "./utils/tokenizer"

export const TOGGLE_FORM_VIEW = createCommand<void>("TOGGLE_FORM_VIEW")

export const ON_CHANGE_LANGUAGE = createCommand<{
    language: string
}>("ON_CHANGE_LANGUAGE")

export const editorStateAtom = atom({
    focused: false,
})

store.set(editorStateAtom, {focused: false})

const log = createLogger("Code Editor", {
    disabled: true,
})

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
 * @returns An array of highlighted code line nodes.
 */
export function createHighlightedNodes(text: string, language: "json" | "yaml"): CodeLineNode[] {
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
            const codeLineNodes: CodeLineNode[] = []
            lines.forEach((line) => {
                const codeLine = $createCodeLineNode()
                let content = line
                while (content.startsWith("  ")) {
                    codeLine.append($createCodeTabNode())
                    content = content.substring(2)
                }
                const tokens = tokenizeCodeLine(content, language)
                tokens.forEach((token) => {
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
                    codeLine.append(highlightNode)
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
    const codeLineNodes: CodeLineNode[] = []
    lines.forEach((line) => {
        const codeLine = $createCodeLineNode()
        let content = line
        while (content.startsWith("  ")) {
            codeLine.append($createCodeTabNode())
            content = content.substring(2)
        }
        const tokens = tokenizeCodeLine(content, language)
        tokens.forEach((token) => {
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
            codeLine.append(highlightNode)
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
    debug = false,
    initialValue,
    language = "json",
    validationSchema,
    additionalCodePlugins = [],
    editorId,
}: {
    debug?: boolean
    initialValue: string
    language?: "json" | "yaml"
    validationSchema: any
    additionalCodePlugins?: React.ReactNode[]
    editorId: string
}) {
    const [editor] = useLexicalComposerContext()

    // const isInitRef = useRef(false)

    const prevInitialRef = useRef<string | undefined>(undefined)

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
                    editor.update(() => {
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
                        } else if (hasFocus && editor.isEditable()) {
                            // Don't update if editor has focus and is editable (user is typing)
                            // But allow updates for read-only editors (like diff view)
                            return
                        }

                        // Default processing for JSON/YAML content
                        const currentTextValue = $getEditorCodeAsString()
                        log("INITIAL VALUE CHANGED - CURRENT TEXT VALUE", {currentTextValue})
                        if (currentTextValue) {
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
                            // For JSON/YAML content, parse and format
                            const objectValue =
                                payload.language === "json"
                                    ? JSON5.parse(payload.content)
                                    : payload.content
                            let value: string
                            if (payload.language === "json") {
                                value = JSON.stringify(objectValue, null, 2)
                            } else {
                                try {
                                    const obj = yaml.load(objectValue)
                                    if (obj !== undefined) {
                                        value = yaml.dump(obj as any, {indent: 2})
                                    } else {
                                        value = objectValue
                                    }
                                } catch {
                                    // Try JSON as a fallback and then dump to YAML for consistent highlighting
                                    try {
                                        const obj = JSON5.parse(objectValue)
                                        value = yaml.dump(obj as any, {indent: 2})
                                    } catch {
                                        value = objectValue
                                    }
                                }
                            }
                            log(" Reconstructing code block due to prop change", {
                                language: payload.language,
                                value,
                            })

                            existingCodeBlock.clear()
                            log("CLEAR AND RECONSTRUCT", {
                                content: payload.content,
                                currentTextValue,
                            })
                            const highlightedNodes = createHighlightedNodes(
                                value,
                                payload.language as "json" | "yaml",
                            )
                            highlightedNodes.forEach((node) => {
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
                    })

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
                    const oldLanguage = existingCodeBlock.getLanguage() as "json" | "yaml"
                    const newLanguage = payload.language as "json" | "yaml"
                    log(" ON_CHANGE_LANGUAGE triggered", {oldLanguage, newLanguage})
                    if (oldLanguage === newLanguage) {
                        existingCodeBlock.setLanguage(newLanguage)
                        return true
                    }

                    // Extract current code string
                    const lines = existingCodeBlock.getChildren().map((line: LexicalNode) => {
                        if (!$isCodeLineNode(line)) return ""
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

                    let obj: any = null
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
                    let newText = ""
                    try {
                        if (newLanguage === "json") {
                            newText = JSON.stringify(obj, null, 2)
                        } else {
                            newText = yaml.dump(obj, {indent: 2})
                            log(" Stringified object in new language", {newText})
                        }
                    } catch (err) {
                        console.error("Failed to stringify new code during language switch", err)
                        existingCodeBlock.setLanguage(newLanguage)
                        return true
                    }

                    existingCodeBlock.clear()
                    const newNodes = createHighlightedNodes(newText, newLanguage)
                    newNodes.forEach((n) => existingCodeBlock.append(n))
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
        )
    }, [])

    useEffect(() => {
        // For JSON content, use semantic comparison. YAML should be treated as raw text.
        if (prevInitialRef.current) {
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

        // Dispatch event to allow other plugins to handle the content
        let defaultPrevented = false
        const payload: InitialContentPayload = {
            content: initialValue,
            language,
            preventDefault: () => {
                defaultPrevented = true
            },
            isDefaultPrevented: () => defaultPrevented,
        }

        log("INITIAL VALUE CHANGED", {initialValue})
        editor.dispatchCommand(INITIAL_CONTENT_COMMAND, payload)
    }, [initialValue, language])

    return (
        <>
            <AutoFormatAndValidateOnPastePlugin />
            <IndentationPlugin />
            <ClosingBracketIndentationPlugin />
            <AutoCloseBracketsPlugin />
            <GlobalErrorIndicatorPlugin editorId={editorId} />
            <SyntaxHighlightPlugin editorId={editorId} schema={validationSchema} debug={debug} />
            {additionalCodePlugins?.map((plugin, index) => (
                <Fragment key={index}>{plugin}</Fragment>
            ))}
            <VerticalNavigationPlugin />
        </>
    )
}

type InsertInitialCodeBlockProps = ComponentProps<typeof InsertInitialCodeBlockPlugin>
const InsertInitialCodeBlockPluginWrapper: FC<InsertInitialCodeBlockProps> = (props) => {
    return <InsertInitialCodeBlockPlugin {...props} />
}

export default memo(InsertInitialCodeBlockPluginWrapper)
