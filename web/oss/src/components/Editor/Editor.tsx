import {forwardRef, useCallback, useEffect, useRef, ReactNode, memo} from "react"

import {$convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS} from "@lexical/markdown"
import {LexicalComposer} from "@lexical/react/LexicalComposer"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {mergeRegister} from "@lexical/utils"
import clsx from "clsx"
import {COMMAND_PRIORITY_LOW, EditorState, LexicalEditor, createCommand} from "lexical"
import {v4 as uuidv4} from "uuid"

import useEditorConfig from "./hooks/useEditorConfig"
import {useEditorInvariant} from "./hooks/useEditorInvariant"
import {useEditorResize} from "./hooks/useEditorResize"
import EditorPlugins from "./plugins"
import {$getEditorCodeAsString} from "./plugins/code/plugins/RealTimeValidationPlugin"
import type {EditorProps} from "./types"

export const ON_HYDRATE_FROM_REMOTE_CONTENT = createCommand<{
    hydrateWithRemoteContent: string
    parentId: string
}>("ON_HYDRATE_FROM_REMOTE_CONTENT")

// Re-export the useLexicalComposerContext hook for easier access
export {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"

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
 * @param {boolean} debug - If true, debug information will be shown.
 * @param {boolean} autoFocus - If true, the editor will be focused automatically.
 * @param {boolean} enableResize - If true, the editor will be resizable.
 * @param {boolean} boundWidth - If true, the editor width will be bounded to the parent width.
 * @param {boolean} boundHeight - If true, the editor height will be bounded to the parent height.
 * @param {object} dimensions - Dimensions of the editor.
 * @param {object} validationSchema - Validation schema for the editor.
 */
const EditorInner = forwardRef<HTMLDivElement, EditorProps>(
    (
        {
            id = uuidv4(),
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
            validationSchema,
            enableResize = false, // New prop
            boundWidth = true, // New prop
            boundHeight, // New prop
            disabled = false,
            ...rest
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
                    if (!_editor.isEditable()) return

                    if (codeOnly) {
                        const textContent = $getEditorCodeAsString(_editor)
                        const result = {
                            value: textContent,
                            textContent,
                            tokens: [], // You can extract tokens if needed
                        }
                        if (onChange) {
                            onChange(result)
                        }
                    } else {
                        const textContent = $convertToMarkdownString(TRANSFORMERS)
                        const tokens: unknown[] = [] // Extract tokens if needed

                        const result = {
                            value: "", // Omit this for now
                            textContent: textContent.replaceAll(/\\(.)/g, "$1"),
                            tokens,
                        }

                        if (onChange) {
                            onChange(result)
                        }
                    }
                })
            },
            [onChange],
        )

        const [editor] = useLexicalComposerContext()

        const isInitRef = useRef(false)

        useEffect(() => {
            editor.setEditable(!disabled)
        }, [disabled, editor])

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
                        if (hydrateWithRemoteContent) {
                            $convertFromMarkdownString(hydrateWithRemoteContent, TRANSFORMERS)
                        }
                        return false
                    },
                    COMMAND_PRIORITY_LOW,
                ),
            )
        }, [editor])

        useEffect(() => {
            if (codeOnly) return
            editor.dispatchCommand(ON_HYDRATE_FROM_REMOTE_CONTENT, {
                hydrateWithRemoteContent: initialValue || "",
                parentId: "",
            })
        }, [initialValue])

        return (
            <div className="editor-container w-full overflow-hidden relative min-h-[inherit]">
                <div
                    ref={ref}
                    className={clsx("editor-inner border rounded-lg min-h-[inherit]", {
                        "single-line": singleLine,
                        "code-editor": codeOnly,
                    })}
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
                        initialValue={initialValue}
                        validationSchema={validationSchema}
                    />
                    {/* {!singleLine && enableResize && <div className="resize-handle" />} */}
                </div>
            </div>
        )
    },
)

export const EditorProvider = ({
    id = uuidv4(),
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
    enableResize = false,
    boundWidth = true,
    boundHeight,
    showBorder = true,
    validationSchema,
    children,
    dimensions,
}: EditorProps & {children: ReactNode}) => {
    useEditorInvariant({
        singleLine,
        enableResize,
        codeOnly,
        enableTokens,
        showToolbar,
        language,
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
                    dimensions?.width
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
                "min-h-[70px]",
                "w-full",
                "text-[#1C2C3D] relative flex flex-col rounded-lg",
                {
                    disabled: disabled,
                },
                className,
            ])}
        >
            <LexicalComposer initialConfig={config}>{children}</LexicalComposer>
        </div>
    )
}

const Editor = ({
    id = uuidv4(),
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
    enableResize = true, // New prop
    boundWidth = true, // New prop
    boundHeight, // New prop
    showBorder = true,
    validationSchema,
    noProvider = false,
    ...rest
}: EditorProps) => {
    const {setContainerElm, dimensions: dimension} = useEditorResize({
        singleLine,
        enableResize,
        boundWidth,
        boundHeight,
        skipHandle: !noProvider,
    })

    return (
        <div
            className="agenta-editor-wrapper w-full relative"
            ref={(el) => {
                setContainerElm(el)
            }}
        >
            {noProvider ? (
                <EditorInner
                    dimensions={dimension}
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
                    disabled={disabled}
                    validationSchema={validationSchema}
                />
            ) : (
                <EditorProvider
                    id={id}
                    dimensions={
                        noProvider
                            ? dimension
                            : {
                                  width: "100%",
                                  maxWidth: "100%",
                                  height: "auto",
                              }
                    }
                    initialValue={initialValue}
                    disabled={disabled}
                    className={className}
                    onChange={onChange}
                    placeholder={placeholder}
                    singleLine={singleLine}
                    codeOnly={codeOnly}
                    language={language}
                    showToolbar={showToolbar}
                    enableTokens={enableTokens}
                    autoFocus={autoFocus}
                    debug={debug}
                    enableResize={enableResize}
                    boundWidth={boundWidth}
                    boundHeight={boundHeight}
                    showBorder={showBorder}
                    validationSchema={validationSchema}
                >
                    <EditorInner
                        dimensions={
                            noProvider
                                ? dimension
                                : {
                                      width: "100%",
                                      maxWidth: "100%",
                                      height: "auto",
                                  }
                        }
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
                        validationSchema={validationSchema}
                        disabled={disabled}
                    />
                </EditorProvider>
            )}
        </div>
    )
}

export default memo(Editor)
