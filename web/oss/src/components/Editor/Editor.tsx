import {forwardRef, useCallback, useEffect, useRef, ReactNode, memo, useState} from "react"

import {$isCodeNode} from "@lexical/code"
import {$convertFromMarkdownString, TRANSFORMERS} from "@lexical/markdown"
import {LexicalComposer} from "@lexical/react/LexicalComposer"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {mergeRegister} from "@lexical/utils"
import clsx from "clsx"
import yaml from "js-yaml"
import {
    COMMAND_PRIORITY_HIGH,
    COMMAND_PRIORITY_LOW,
    EditorState,
    LexicalEditor,
    createCommand,
} from "lexical"
import {$getRoot} from "lexical"
import {v4 as uuidv4} from "uuid"

import FormView from "./form/FormView"
import useEditorConfig from "./hooks/useEditorConfig"
import {useEditorInvariant} from "./hooks/useEditorInvariant"
import {useEditorResize} from "./hooks/useEditorResize"
import EditorPlugins from "./plugins"
import {createHighlightedNodes, TOGGLE_FORM_VIEW} from "./plugins/code"
import {$isCodeBlockNode} from "./plugins/code/nodes/CodeBlockNode"
import {$getEditorCodeAsString} from "./plugins/code/plugins/RealTimeValidationPlugin"
import {$convertToMarkdownStringCustom} from "./plugins/markdown/assets/transformers"
import {ON_CHANGE_COMMAND} from "./plugins/markdown/commands"
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
            value,
            onChange,
            placeholder = "Enter some text...",
            singleLine = false,
            codeOnly = false,
            language,
            templateFormat,
            customRender,
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
            tokens = [],
            additionalCodePlugins = [],
            showLineNumbers = true,
            onPropertyClick,
            disableLongText,
            ...rest
        }: EditorProps,
        ref,
    ) => {
        // EditorWrapper implementation

        useEditorInvariant({
            singleLine,
            enableResize,
            codeOnly,
            enableTokens,
            showToolbar,
            language,
        })

        const [editor] = useLexicalComposerContext()

        const handleUpdate = useCallback(
            (editorState: EditorState, _editor: LexicalEditor) => {
                editor.dispatchCommand(ON_CHANGE_COMMAND, {editorState, _editor})
            },
            [editor],
        )

        useEffect(() => {
            editor.registerCommand(
                ON_CHANGE_COMMAND,
                (payload: {editorState: EditorState; _editor: LexicalEditor}) => {
                    const {editorState, _editor} = payload
                    editorState.read(() => {
                        if (!_editor.isEditable()) return false

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
                            const root = $getRoot()
                            const firstChild = root.getFirstChild()
                            let textContent: string

                            if (
                                $isCodeNode(firstChild) &&
                                firstChild.getLanguage() === "markdown"
                            ) {
                                textContent = firstChild.getTextContent()
                            } else {
                                textContent = $convertToMarkdownStringCustom(
                                    TRANSFORMERS,
                                    undefined,
                                    true,
                                )
                            }

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
                    return true
                },
                COMMAND_PRIORITY_HIGH,
            )
        }, [editor])

        const [view, setView] = useState<"code" | "form">("code")
        const [jsonValue, setJsonValue] = useState<Record<string, unknown>>({})
        const lastTextRef = useRef<string>("")

        // Keep underlying code block in sync when editing in Form view
        useEffect(() => {
            if (view !== "form") return
            editor.update(() => {
                const root = $getRoot()
                const block = root.getChildren().find($isCodeBlockNode)
                if (!block) return
                const lang = (block as any).getLanguage?.() ?? "json"
                const text =
                    lang === "json"
                        ? JSON.stringify(jsonValue, null, 2)
                        : yaml.dump(jsonValue, {indent: 2})
                block.clear()
                createHighlightedNodes(text, lang).forEach((n) => block.append(n))
            })
            // propagate to consumer
            const nextText = JSON.stringify(jsonValue, null, 2)
            if (onChange && lastTextRef.current !== nextText) {
                lastTextRef.current = nextText
                onChange({
                    textContent: nextText,
                    value: nextText,
                    tokens: [],
                })
            }
        }, [jsonValue, view])

        // Register toggle command
        useEffect(() => {
            return mergeRegister(
                editor.registerCommand(
                    TOGGLE_FORM_VIEW,
                    () => {
                        setView((v) => (v === "code" ? "form" : "code"))
                        if (view === "code") {
                            editor.update(() => {
                                const root = $getRoot()
                                const block = root.getChildren().find($isCodeBlockNode)
                                if (!block) return
                                const lang = (block as any).getLanguage?.() ?? "json"
                                const codeLines = block
                                    .getChildren()
                                    .map((l: any) => l.getTextContent())
                                    .join("\n")
                                try {
                                    let obj: any
                                    if (lang === "json") {
                                        obj = JSON.parse(codeLines)
                                    } else {
                                        try {
                                            obj = yaml.load(codeLines)
                                        } catch (e) {
                                            // Fallback: YAML might actually be JSON
                                            obj = JSON.parse(codeLines)
                                        }
                                    }
                                    if (obj && typeof obj === "object") {
                                        setJsonValue(obj as Record<string, unknown>)
                                    }
                                } catch {
                                    // keep previous state to avoid empty form
                                }
                            })
                        } else {
                            // switching from form to code: serialize current jsonValue back into code block
                            editor.update(() => {
                                const root = $getRoot()
                                const block = root.getChildren().find($isCodeBlockNode)
                                if (!block) return
                                const lang = (block as any).getLanguage?.() ?? "json"
                                const newText =
                                    lang === "json"
                                        ? JSON.stringify(jsonValue, null, 2)
                                        : yaml.dump(jsonValue, {indent: 2})
                                const currentText = block
                                    .getChildren()
                                    .map((l: any) => l.getTextContent())
                                    .join("\n")
                                if (currentText === newText) {
                                    return // no changes, keep existing nodes
                                }
                                block.clear()
                                createHighlightedNodes(newText, lang).forEach((n) =>
                                    block.append(n),
                                )
                            })
                        }
                        return true
                    },
                    COMMAND_PRIORITY_LOW,
                ),
            )
        }, [editor, view])

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
                        // Allow re-hydration if content differs (for undo/redo support)
                        const currentContent = $getRoot().getTextContent()
                        const contentChanged = currentContent !== hydrateWithRemoteContent

                        // Skip if editor is editable, already initialized, and content hasn't changed
                        if (editor.isEditable() && isInitRef.current && !contentChanged) {
                            return false
                        }
                        isInitRef.current = true
                        if (hydrateWithRemoteContent) {
                            $convertFromMarkdownString(
                                hydrateWithRemoteContent,
                                TRANSFORMERS,
                                undefined,
                                true,
                            )
                        }
                        return false
                    },
                    COMMAND_PRIORITY_LOW,
                ),
            )
        }, [editor])

        const lastHydratedRef = useRef<string>("")

        // Use controlled value if provided, otherwise fall back to initialValue
        const effectiveValue = value !== undefined ? value : initialValue

        useEffect(() => {
            if (codeOnly) return
            const next = effectiveValue || ""
            // Compare with actual editor content, not just last hydrated value
            // This ensures undo/redo works even when reverting to a previously hydrated value
            let currentContent = ""
            editor.getEditorState().read(() => {
                currentContent = $getRoot().getTextContent()
            })
            // Skip if content already matches (no change needed)
            if (currentContent === next) return
            lastHydratedRef.current = next
            editor.dispatchCommand(ON_HYDRATE_FROM_REMOTE_CONTENT, {
                hydrateWithRemoteContent: next,
                parentId: "",
            })
        }, [effectiveValue])

        return (
            <div className="editor-container w-full overflow-hidden relative min-h-[inherit]">
                <div
                    ref={ref}
                    className={clsx("editor-inner border rounded-lg min-h-[inherit]", {
                        "single-line": singleLine,
                        "code-editor": codeOnly,
                        "no-line-numbers": codeOnly && !showLineNumbers,
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
                    {view === "code" ? (
                        <EditorPlugins
                            id={id}
                            autoFocus={autoFocus}
                            showToolbar={showToolbar}
                            singleLine={singleLine}
                            codeOnly={codeOnly}
                            enableTokens={enableTokens}
                            debug={debug}
                            language={language}
                            templateFormat={templateFormat}
                            placeholder={placeholder}
                            handleUpdate={handleUpdate}
                            initialValue={initialValue}
                            value={value}
                            validationSchema={validationSchema}
                            tokens={tokens}
                            additionalCodePlugins={additionalCodePlugins}
                            onPropertyClick={onPropertyClick}
                            disableLongText={disableLongText}
                        />
                    ) : (
                        <FormView
                            value={jsonValue}
                            onChange={(v) => {
                                setJsonValue(v)
                            }}
                            customRender={customRender}
                        />
                    )}
                    {/* <Button
                        size="small"
                        type="text"
                        className="absolute top-1 right-1 z-10"
                        onClick={() => editor.dispatchCommand(TOGGLE_FORM_VIEW, undefined)}
                    >
                        {view === "code" ? "Form" : "Code"}
                    </Button> */}
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
    value,
    disabled = false,
    className,
    onChange,
    placeholder = "",
    singleLine = false,
    codeOnly = false,
    language,
    templateFormat,
    customRender,
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
    tokens = [],
    additionalCodePlugins = [],
    showLineNumbers = true,
    onPropertyClick,
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
        <div className="agenta-editor-wrapper w-full relative" ref={setContainerElm}>
            {noProvider ? (
                <EditorInner
                    dimensions={dimension}
                    id={id}
                    customRender={customRender}
                    initialValue={initialValue}
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    singleLine={singleLine}
                    codeOnly={codeOnly}
                    language={language}
                    templateFormat={templateFormat}
                    showToolbar={showToolbar}
                    enableTokens={enableTokens}
                    debug={debug}
                    autoFocus={autoFocus}
                    disabled={disabled}
                    validationSchema={validationSchema}
                    tokens={tokens}
                    additionalCodePlugins={additionalCodePlugins}
                    showLineNumbers={showLineNumbers}
                    onPropertyClick={onPropertyClick}
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
                        customRender={customRender}
                        id={id}
                        initialValue={initialValue}
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder}
                        singleLine={singleLine}
                        codeOnly={codeOnly}
                        language={language}
                        templateFormat={templateFormat}
                        showToolbar={showToolbar}
                        enableTokens={enableTokens}
                        debug={debug}
                        autoFocus={autoFocus}
                        validationSchema={validationSchema}
                        disabled={disabled}
                        tokens={tokens}
                        additionalCodePlugins={additionalCodePlugins}
                        showLineNumbers={showLineNumbers}
                        onPropertyClick={onPropertyClick}
                    />
                </EditorProvider>
            )}
        </div>
    )
}

export default memo(Editor)
