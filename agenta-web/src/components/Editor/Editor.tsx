import {LexicalComposer} from "@lexical/react/LexicalComposer"
import clsx from "clsx"
import {
    $createTextNode,
    $insertNodes,
    COMMAND_PRIORITY_LOW,
    EditorState,
    LexicalEditor,
    createCommand,
} from "lexical"
import {$getRoot} from "lexical"
import {$convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS} from "@lexical/markdown"

import {useEditorResize} from "./hooks/useEditorResize"
import {useEditorInvariant} from "./hooks/useEditorInvariant"
import useEditorConfig from "./hooks/useEditorConfig"
import EditorPlugins from "./plugins"

import type {EditorProps} from "./types"
import {forwardRef, useCallback, useEffect, useRef} from "react"
import {mergeRegister} from "@lexical/utils"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"

import styles from "./assets/Editor.module.css"

export const ON_HYDRATE_FROM_REMOTE_CONTENT = createCommand<{
    hydrateWithRemoteContent: string
    parentId: string
}>("ON_HYDRATE_FROM_REMOTE_CONTENT")

/**
 * Editor component
 *
 * @param {string} id - Unique identifier for the editor instance.
 * @param {string} initialValue - Initial value of the editor content.
 * @param {function} onChange - Callback function to handle content changes.
 * @param {string} placeholder - Placeholder text for the editor.
 * @param {boolean} singleLine - If true, the editor will be single-line.
 * @param {boolean} codeOnly - If true, the editor will be in code-only mode.
 * @param {string} language - Programming language for code highlighting.
 * @param {boolean} showToolbar - If true, the toolbar will be shown.
 * @param {boolean} enableTokens - If true, token functionality will be enabled.
 * @param {boolean} enableResize - If true, the editor will be resizable.
 * @param {boolean} boundWidth - If true, the editor width will be bounded to the parent width.
 * @param {boolean} boundHeight - If true, the editor height will be bounded to the parent height.
 * @param {boolean} debug - If true, debug information will be shown.
 * @param {boolean} showBorder - If true, the editor would have border style.
 */
const EditorInner = forwardRef<HTMLDivElement, EditorProps>(
    (
        {
            id = crypto.randomUUID(),
            initialValue = "",
            onChange,
            placeholder = "Enter some text...",
            singleLine = false,
            codeOnly = false,
            language,
            showToolbar = true,
            enableTokens = false,
            debug = false,
            autoFocus = false,
            dimensions,
            enableResize = false, // New prop
            boundWidth = true, // New prop
            boundHeight = true, // New prop
        }: EditorProps,
        ref,
    ) => {
        useEditorInvariant({
            singleLine,
            enableResize,
            codeOnly,
            enableTokens,
            showToolbar,
            language,
        })

        const handleUpdate = useCallback(
            (editorState: EditorState, _editor: LexicalEditor) => {
                editorState.read(() => {
                    const root = $getRoot()
                    const textContent = $convertToMarkdownString(TRANSFORMERS)
                    const tokens: unknown[] = [] // Extract tokens if needed

                    const result = {
                        value: "", // Omit this for now
                        textContent,
                        tokens,
                    }

                    if (onChange) {
                        onChange(result)
                    }
                })
            },
            [onChange],
        )

        const [editor] = useLexicalComposerContext()

        const isInitRef = useRef(false)

        useEffect(() => {
            /**
             * Hydrates editor with remote content
             * can be overridden by the wrappers or playgins by consuming
             * ON_HYDRATE_FROM_REMOTE_DOM command
             */
            return mergeRegister(
                editor.registerCommand(
                    ON_HYDRATE_FROM_REMOTE_CONTENT,
                    ({hydrateWithRemoteContent}) => {
                        if (editor.isEditable() && isInitRef.current) return false

                        isInitRef.current = true
                        editor.update(() => {
                            // In the browser you can use the native DOMParser API to parse the HTML string.
                            // if (hydrateWithRemoteContent) {
                            //     // create a lexical node with provided initial value
                            //     const initialTextNode = $createTextNode(hydrateWithRemoteContent)
                            //     // clear lexical editor nodes
                            //     const root = $getRoot()
                            //     root.select()
                            //     root.clear()

                            //     // insert the new node created from initial value
                            //     $insertNodes([initialTextNode])
                            // }
                            if (hydrateWithRemoteContent) {
                                $convertFromMarkdownString(hydrateWithRemoteContent, TRANSFORMERS)
                            }
                        })
                        return false
                    },
                    COMMAND_PRIORITY_LOW,
                ),
            )
        }, [editor])

        useEffect(() => {
            editor.dispatchCommand(ON_HYDRATE_FROM_REMOTE_CONTENT, {
                hydrateWithRemoteContent: initialValue || "",
                parentId: "",
            })
        }, [initialValue, editor])

        return (
            <div className="editor-container overflow-hidden relative min-h-[inherit]">
                <div
                    ref={ref}
                    className={`editor-inner border rounded-lg min-h-[inherit] ${singleLine ? "single-line" : ""}`}
                    style={
                        dimensions && dimensions.width
                            ? {
                                  width: dimensions.width,
                                  height: dimensions.height,
                              }
                            : undefined
                    }
                >
                    <EditorPlugins
                        autoFocus={autoFocus}
                        showToolbar={showToolbar}
                        singleLine={singleLine}
                        codeOnly={codeOnly}
                        enableTokens={enableTokens}
                        debug={debug}
                        language={language}
                        placeholder={placeholder}
                        handleUpdate={handleUpdate}
                    />
                    {/* {!singleLine && enableResize && <div className="resize-handle" />} */}
                </div>
            </div>
        )
    },
)

const Editor = ({
    id = crypto.randomUUID(),
    initialValue = "",
    disabled = false,
    className,
    onChange,
    placeholder = "",
    singleLine = false,
    codeOnly = false,
    language,
    showToolbar = true,
    enableTokens = false,
    autoFocus = false,
    debug = false,
    enableResize = false, // New prop
    boundWidth = true, // New prop
    boundHeight, // New prop
    showBorder = true,
}: EditorProps) => {
    useEditorInvariant({
        singleLine,
        enableResize,
        codeOnly,
        enableTokens,
        showToolbar,
        language,
    })

    const {containerRef, dimensions} = useEditorResize({
        singleLine,
        enableResize,
        boundWidth,
        boundHeight,
    })

    const config = useEditorConfig({
        id,
        initialValue,
        codeOnly,
        enableTokens,
        disabled,
    })

    if (!config) {
        return (
            <div
                className="bg-white relative flex flex-col p-2 border rounded-lg"
                style={
                    dimensions.width
                        ? {
                              width: dimensions.width,
                              height: dimensions.height,
                          }
                        : undefined
                }
            >
                <div className="editor-placeholder">{placeholder}</div>
            </div>
        )
    }

    return (
        <div
            className={clsx([
                "agenta-rich-text-editor",
                styles["agenta-rich-text-editor"],
                "min-h-16",
                "text-[#1C2C3D] relative flex flex-col rounded-lg",
                {
                    "border border-solid border-[#BDC7D1]": showBorder,
                    disabled: disabled,
                },
                className,
            ])}
        >
            <LexicalComposer initialConfig={config}>
                <EditorInner
                    ref={containerRef}
                    dimensions={dimensions}
                    id={id}
                    initialValue={initialValue}
                    onChange={onChange}
                    placeholder={placeholder}
                    singleLine={singleLine}
                    codeOnly={codeOnly}
                    language={language}
                    showToolbar={showToolbar}
                    enableTokens={enableTokens}
                    debug={debug}
                    autoFocus={autoFocus}
                />
            </LexicalComposer>
        </div>
    )
}

export default Editor
