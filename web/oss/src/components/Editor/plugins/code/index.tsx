// Editor.tsx
import {memo, useEffect, useRef} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {mergeRegister} from "@lexical/utils"
import {createStore, atom} from "jotai"
import {
    $getRoot,
    $createTabNode,
    COMMAND_PRIORITY_LOW,
    createCommand,
    BLUR_COMMAND,
    FOCUS_COMMAND,
} from "lexical"

const store = createStore()

import {ON_HYDRATE_FROM_REMOTE_CONTENT} from "../../Editor"
// import {editorStateAtom} from "../../state/assets/atoms"

import {$createCodeBlockNode, $isCodeBlockNode} from "./nodes/CodeBlockNode"
import {$createCodeHighlightNode, $isCodeHighlightNode} from "./nodes/CodeHighlightNode"
import {$createCodeLineNode, $isCodeLineNode, CodeLineNode} from "./nodes/CodeLineNode"
import {AutoCloseBracketsPlugin} from "./plugins/AutoCloseBracketsPlugin"
import {AutoFormatAndValidateOnPastePlugin} from "./plugins/AutoFormatAndValidateOnPastePlugin"
import {CodeBlockFoldingPlugin} from "./plugins/CodeBlockFoldingPlugin"
import {CodeGutterPlugin} from "./plugins/CodeGutterPlugin"
import {EmptyNodeTransformPlugin} from "./plugins/EmptyNodeTransformPlugin"
import {HorizontalNavigationPlugin} from "./plugins/HorizontalNavigationPlugin"
import {IndentationPlugin} from "./plugins/IndentationPlugin"
import {RealTimeValidationPlugin} from "./plugins/RealTimeValidationPlugin"
import {SyntaxHighlightPlugin} from "./plugins/SyntaxHighlightPlugin"
import {VerticalNavigationPlugin} from "./plugins/VerticalNavigationPlugin"
import {$handleInvalidContent} from "./utils/pasteUtils"
import {tokenizeCodeLine} from "./utils/tokenizer"

export const ON_CHANGE_LANGUAGE = createCommand<{
    language: string
}>("ON_CHANGE_LANGUAGE")

const editorStateAtom = atom({
    focused: false,
})

store.set(editorStateAtom, {focused: false})

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

    const isInitRef = useRef(false)

    useEffect(() => {
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
                }
                // return false

                if (editor.isEditable() && hasFocus) {
                    if (existingCodeBlock) {
                        const lines = existingCodeBlock.getChildren().filter($isCodeLineNode)
                        const line = lines[0]
                        if (!line) {
                            const newLine = $createCodeLineNode()
                            const highlightNode = $createCodeHighlightNode(
                                "\u200B",
                                "plain",
                                false,
                                null,
                            )
                            newLine.append(highlightNode)
                            existingCodeBlock.append(newLine)
                            highlightNode.selectEnd()
                            return
                        }

                        return
                    }
                }

                isInitRef.current = true
                existingCodeBlock.clear()
                editor.setEditable(false)
                try {
                    const objectValue =
                        typeof initialValue === "string" ? JSON.parse(initialValue) : initialValue
                    const value = JSON.stringify(objectValue, null, 2)
                    const highlightedNodes = createHighlightedNodes(value, language)
                    highlightedNodes.forEach((node) => {
                        existingCodeBlock.append(node)
                    })
                } catch (err) {
                    console.error("Failed to parse initial value", initialValue, err)
                    console.error("failed values", {
                        existingCodeBlock,
                        initialValue,
                        type: typeof initialValue,
                        err,
                    })
                }
            },
            {
                onUpdate: () => {
                    editor.update(
                        () => {
                            editor.setEditable(true)
                        },
                        {
                            skipTransforms: true,
                        },
                    )
                },
                skipTransforms: true,
            },
        )
    }, [initialValue])

    useEffect(() => {
        return mergeRegister(
            editor.registerCommand(
                ON_CHANGE_LANGUAGE,
                (payload) => {
                    editor.update(() => {
                        const root = $getRoot()
                        const existingCodeBlock = root.getChildren().filter($isCodeBlockNode)[0]
                        existingCodeBlock.setLanguage(payload.language as "json" | "yaml")
                    })
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
            <CodeGutterPlugin />
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
