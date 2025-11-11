// Editor.tsx
import {memo, useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {mergeRegister} from "@lexical/utils"
import isEqual from "fast-deep-equal"
import {createStore, atom} from "jotai"
import JSON5 from "json5"
import {
    $getRoot,
    $createTabNode,
    COMMAND_PRIORITY_LOW,
    createCommand,
    BLUR_COMMAND,
    FOCUS_COMMAND,
    $setSelection,
} from "lexical"

const store = createStore()

import {$createCodeBlockNode, $isCodeBlockNode} from "./nodes/CodeBlockNode"
import {$createCodeHighlightNode} from "./nodes/CodeHighlightNode"
import {$createCodeLineNode, CodeLineNode} from "./nodes/CodeLineNode"
import {AutoCloseBracketsPlugin} from "./plugins/AutoCloseBracketsPlugin"
import {AutoFormatAndValidateOnPastePlugin} from "./plugins/AutoFormatAndValidateOnPastePlugin"
import {CodeBlockFoldingPlugin} from "./plugins/CodeBlockFoldingPlugin"
import {EmptyNodeTransformPlugin} from "./plugins/EmptyNodeTransformPlugin"
import {HorizontalNavigationPlugin} from "./plugins/HorizontalNavigationPlugin"
import {IndentationPlugin} from "./plugins/IndentationPlugin"
import {$getEditorCodeAsString, RealTimeValidationPlugin} from "./plugins/RealTimeValidationPlugin"
import {SyntaxHighlightPlugin} from "./plugins/SyntaxHighlightPlugin"
import {VerticalNavigationPlugin} from "./plugins/VerticalNavigationPlugin"
import {tryParsePartialJson} from "./tryParsePartialJson"
import {createLogger} from "./utils/createLogger"
import {tokenizeCodeLine} from "./utils/tokenizer"

export const ON_CHANGE_LANGUAGE = createCommand<{
    language: string
}>("ON_CHANGE_LANGUAGE")

const editorStateAtom = atom({
    focused: false,
})

store.set(editorStateAtom, {focused: false})

const log = createLogger("Code Editor")
/**
 * Creates an array of highlighted code line nodes from a given text and language.
 *
 * @param text The input text to highlight.
 * @param language The language to use for highlighting.
 * @returns An array of highlighted code line nodes.
 */
export function createHighlightedNodes(text: string, language: string): CodeLineNode[] {
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
                const obj = JSON.parse(text)
                pretty = JSON.stringify(obj, null, 2)
            }
            // Split pretty-printed JSON into lines
            const lines = pretty.split("\n")
            const codeLineNodes: CodeLineNode[] = []
            lines.forEach((line) => {
                const codeLine = $createCodeLineNode()
                let content = line
                while (content.startsWith("  ")) {
                    codeLine.append($createTabNode())
                    content = content.substring(2)
                }
                const tokens = tokenizeCodeLine(content, language)
                tokens.forEach((token) => {
                    const highlightNode = $createCodeHighlightNode(token.content)
                    highlightNode.setHighlightType(token.type)
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
            codeLine.append($createTabNode())
            content = content.substring(2)
        }
        const tokens = tokenizeCodeLine(content, language)
        tokens.forEach((token) => {
            const highlightNode = $createCodeHighlightNode(token.content)
            highlightNode.setHighlightType(token.type)
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
    debug,
    initialValue,
    language = "json",
    validationSchema,
}: {
    debug?: boolean
    initialValue: string
    language?: "json" | "yaml"
    validationSchema: any
}) {
    const [editor] = useLexicalComposerContext()

    // const isInitRef = useRef(false)

    useEffect(() => {
        log("INITIAL VALUE CHANGED", {initialValue})
        editor.update(
            () => {
                const hasFocus = store.get(editorStateAtom)?.focused
                const root = $getRoot()
                let existingCodeBlock = root.getChildren().find($isCodeBlockNode)

                if (!existingCodeBlock) {
                    root.clear()
                    existingCodeBlock = $createCodeBlockNode(language)
                    const line = $createCodeLineNode()
                    const highlightNode = $createCodeHighlightNode("\u200B", "plain", false, null)

                    line.append(highlightNode)
                    existingCodeBlock.append(line)

                    root.append(existingCodeBlock)
                } else if (hasFocus) {
                    return
                }

                // isInitRef.current = true
                const currentTextValue = $getEditorCodeAsString()
                root.getTextContent()
                if (currentTextValue) {
                    try {
                        const currentObjectValue = JSON5.parse(currentTextValue)
                        const incomingObjectValue =
                            typeof initialValue === "string"
                                ? JSON5.parse(initialValue)
                                : initialValue
                        if (isEqual(currentObjectValue, incomingObjectValue)) {
                            log("DO NOT CLEAR AND RECONSTRUCT 1", {initialValue, currentTextValue})
                            return
                        }
                    } catch (e) {
                        try {
                            const currentObject = tryParsePartialJson(currentTextValue)
                            const incomingObject =
                                typeof initialValue === "string"
                                    ? JSON5.parse(initialValue)
                                    : initialValue

                            if (isEqual(currentObject, incomingObject)) {
                                log("DO NOT CLEAR AND RECONSTRUCT 2")
                                return
                            } else {
                                const trimmedIncoming =
                                    typeof initialValue === "string"
                                        ? initialValue.trim()
                                        : JSON5.stringify(initialValue).trim()

                                if (currentTextValue.trim() === trimmedIncoming) {
                                    log("DO NOT CLEAR AND RECONSTRUCT 3")
                                    return
                                }
                            }
                        } catch (e) {
                            log("there was an error parsing to json", {
                                e,
                                initialValue,
                                currentTextValue,
                            })
                        }
                    }
                }

                if (currentTextValue) {
                    editor.setEditable(false)
                }
                // TODO: Instead of clearing and re-adding, we should do a diff check and edit updated nodes only
                try {
                    const objectValue =
                        typeof initialValue === "string" ? JSON5.parse(initialValue) : initialValue
                    const value = JSON.stringify(objectValue, null, 2)
                    existingCodeBlock.clear()
                    log("CLEAR AND RECONSTRUCT", {initialValue, currentTextValue})
                    const highlightedNodes = createHighlightedNodes(value, language)
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
                        initialValue,
                        type: typeof initialValue,
                        err,
                    })

                    if (!editor.isEditable()) {
                        editor.setEditable(true)
                    }
                }
            },
            {
                skipTransforms: true,
            },
        )
    }, [initialValue])

    useEffect(() => {
        return mergeRegister(
            editor.registerCommand(
                ON_CHANGE_LANGUAGE,
                (payload) => {
                    const root = $getRoot()
                    const existingCodeBlock = root.getChildren().filter($isCodeBlockNode)[0]
                    existingCodeBlock.setLanguage(payload.language as "json" | "yaml")
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
        )
    }, [])

    return (
        <>
            <AutoFormatAndValidateOnPastePlugin />
            <IndentationPlugin />
            <AutoCloseBracketsPlugin />
            <SyntaxHighlightPlugin />
            <EmptyNodeTransformPlugin />
            <HorizontalNavigationPlugin />
            <VerticalNavigationPlugin />
            {validationSchema ? (
                <RealTimeValidationPlugin debug={debug} schema={validationSchema} />
            ) : null}
            <CodeBlockFoldingPlugin />
        </>
    )
}

const InsertInitialCodeBlockPluginWrapper = (props) => {
    return (
        <>
            <InsertInitialCodeBlockPlugin {...props} />
        </>
    )
}

export default memo(InsertInitialCodeBlockPluginWrapper)
