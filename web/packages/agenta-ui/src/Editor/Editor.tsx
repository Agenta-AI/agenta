import {
    forwardRef,
    useCallback,
    useEffect,
    useRef,
    ReactNode,
    memo,
    useState,
    useMemo,
    type CSSProperties,
} from "react"

import {createLogger} from "@agenta/shared/utils"
import {$isCodeNode} from "@lexical/code"
import {$convertFromMarkdownString, TRANSFORMERS} from "@lexical/markdown"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {LexicalExtensionComposer} from "@lexical/react/LexicalExtensionComposer"
import {mergeRegister} from "@lexical/utils"
import clsx from "clsx"
import yaml from "js-yaml"
import {
    COMMAND_PRIORITY_HIGH,
    COMMAND_PRIORITY_LOW,
    EditorState,
    LexicalEditor,
    type AnyLexicalExtensionArgument,
    configExtension,
    createCommand,
    defineExtension,
    type InitialEditorStateType,
} from "lexical"
import {$getRoot} from "lexical"
import {v4 as uuidv4} from "uuid"

import FormView from "./form/FormView"
import useEditorConfig from "./hooks/useEditorConfig"
import {useEditorInvariant} from "./hooks/useEditorInvariant"
import {useEditorResize} from "./hooks/useEditorResize"
import EditorPlugins from "./plugins"
import {createHighlightedNodes, TOGGLE_FORM_VIEW} from "./plugins/code"
import {
    ENTER_KEY_UPDATE_TAG,
    HIGHLIGHT_ONLY_UPDATE_TAG,
} from "./plugins/code/core/highlight/updateTags"
import {CodeBehaviorCommandsExtension} from "./plugins/code/extensions/codeBehaviorCommands"
import {CodeFoldingExtension} from "./plugins/code/extensions/codeFoldingReact"
import {CodeModelExtension} from "./plugins/code/extensions/codeModel"
import {CodeVirtualizationExtension} from "./plugins/code/extensions/codeVirtualization"
import {DiffHighlightExtension} from "./plugins/code/extensions/diffHighlight"
import {HighlightCoreExtension} from "./plugins/code/extensions/highlightCore"
import {PropertyClickExtension} from "./plugins/code/extensions/propertyClick"
import {ValidationCoreExtension} from "./plugins/code/extensions/validationCore"
import {ValidationExtension} from "./plugins/code/extensions/validationReact"
import {$isCodeBlockNode} from "./plugins/code/nodes/CodeBlockNode"
import {$getEditorCodeAsString} from "./plugins/code/plugins/RealTimeValidationPlugin"
import {$getLineCount} from "./plugins/code/utils/segmentUtils"
import {$convertToMarkdownStringCustom} from "./plugins/markdown/assets/transformers"
import {ON_CHANGE_COMMAND} from "./plugins/markdown/commands"
import {TokenBehaviorExtension} from "./plugins/token/extensions/tokenBehavior"
import type {EditorProps} from "./types"

export const ON_HYDRATE_FROM_REMOTE_CONTENT = createCommand<{
    hydrateWithRemoteContent: string
    parentId: string
}>("ON_HYDRATE_FROM_REMOTE_CONTENT")
const extensionFlowLog = createLogger("EditorExtensionFlow", {disabled: true})
const onChangeLog = createLogger("EditorOnChange", {disabled: true})
const DEBUG_ENTER_ON_CHANGE_PROFILE = true
const SLOW_ON_CHANGE_THRESHOLD_MS = 80
const LARGE_DOC_LINE_NUMBER_DISABLE_CHAR_THRESHOLD = 50000
const LARGE_DOC_LINE_NUMBER_DISABLE_LINE_THRESHOLD = 1200
/** Debounce delay for onChange serialization during rapid structural edits (Enter key) */
const LARGE_DOC_ON_CHANGE_DEBOUNCE_MS = 150
const EMPTY_TOKENS: string[] = []

function getNow(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now()
    }
    return Date.now()
}

function $getNativeCodeAsString(): string {
    const root = $getRoot()
    const codeNode = root.getChildren().find($isCodeNode)
    if ($isCodeNode(codeNode)) {
        return codeNode.getTextContent()
    }
    return root.getTextContent()
}

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
            tokens = EMPTY_TOKENS,
            additionalCodePlugins = [],
            showLineNumbers = true,
            onPropertyClick,
            disableLongText,
            loadingFallback = "skeleton",
            disableCodeFoldingPlugin = false,
            disableIndentationPlugin = false,
            useNativeCodeNodes = false,
            diffExtensionConfig,
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
            (editorState: EditorState, _editor: LexicalEditor, tags?: ReadonlySet<string>) => {
                if (!onChange) {
                    return
                }
                editor.dispatchCommand(ON_CHANGE_COMMAND, {editorState, _editor, tags})
            },
            [editor, onChange],
        )

        useEffect(() => {
            if (!onChange) {
                return
            }

            return editor.registerCommand(
                ON_CHANGE_COMMAND,
                (payload: {
                    editorState: EditorState
                    _editor: LexicalEditor
                    tags?: ReadonlySet<string>
                }) => {
                    const {editorState, _editor, tags} = payload
                    const updateTags = tags ?? new Set<string>()
                    if (updateTags.has(HIGHLIGHT_ONLY_UPDATE_TAG)) {
                        return true
                    }
                    const isEnterUpdate = updateTags.has(ENTER_KEY_UPDATE_TAG)

                    // For Enter key updates on large code documents, debounce the
                    // serialization to avoid O(n) $getEditorCodeAsString() traversal
                    // on every keystroke. The serialization runs after LARGE_DOC_ON_CHANGE_DEBOUNCE_MS
                    // of idle time, batching rapid Enter presses into a single serialize.
                    if (codeOnly && isEnterUpdate) {
                        if (onChangeDebounceRef.current != null) {
                            clearTimeout(onChangeDebounceRef.current)
                        }
                        onChangeDebounceRef.current = setTimeout(() => {
                            onChangeDebounceRef.current = null
                            editor.getEditorState().read(() => {
                                if (!editor.isEditable()) return
                                const textContent = useNativeCodeNodes
                                    ? $getNativeCodeAsString()
                                    : $getEditorCodeAsString(editor)
                                onChange({value: textContent, textContent, tokens: []})
                            })
                        }, LARGE_DOC_ON_CHANGE_DEBOUNCE_MS)
                        return true
                    }

                    const onChangeStartMs = getNow()
                    editorState.read(() => {
                        if (!_editor.isEditable()) return false

                        if (codeOnly) {
                            const serializeStartMs = getNow()
                            const textContent = useNativeCodeNodes
                                ? $getNativeCodeAsString()
                                : $getEditorCodeAsString(_editor)
                            const serializeMs = getNow() - serializeStartMs
                            const result = {
                                value: textContent,
                                textContent,
                                tokens: [], // You can extract tokens if needed
                            }
                            const callbackStartMs = getNow()
                            onChange(result)
                            const callbackMs = getNow() - callbackStartMs
                            const totalMs = getNow() - onChangeStartMs
                            if (
                                (DEBUG_ENTER_ON_CHANGE_PROFILE && isEnterUpdate) ||
                                totalMs >= SLOW_ON_CHANGE_THRESHOLD_MS
                            ) {
                                onChangeLog("updateProfile", {
                                    editorId: id,
                                    isEnterUpdate,
                                    codeOnly: true,
                                    contentLength: textContent.length,
                                    serializeMs: Number(serializeMs.toFixed(2)),
                                    callbackMs: Number(callbackMs.toFixed(2)),
                                    totalMs: Number(totalMs.toFixed(2)),
                                })
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

                            lastEmittedTextRef.current = result.textContent
                            const callbackStartMs = getNow()
                            onChange(result)
                            const callbackMs = getNow() - callbackStartMs
                            const totalMs = getNow() - onChangeStartMs
                            if (
                                (DEBUG_ENTER_ON_CHANGE_PROFILE && isEnterUpdate) ||
                                totalMs >= SLOW_ON_CHANGE_THRESHOLD_MS
                            ) {
                                onChangeLog("updateProfile", {
                                    editorId: id,
                                    isEnterUpdate,
                                    codeOnly: false,
                                    contentLength: result.textContent.length,
                                    callbackMs: Number(callbackMs.toFixed(2)),
                                    totalMs: Number(totalMs.toFixed(2)),
                                })
                            }
                        }
                    })
                    return true
                },
                COMMAND_PRIORITY_HIGH,
            )
        }, [codeOnly, editor, onChange])

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
                const blockLang = $isCodeBlockNode(block) ? block.getLanguage() : null
                const lang = blockLang === "json" || blockLang === "yaml" ? blockLang : "json"
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
                                const lang =
                                    ($isCodeBlockNode(block) ? block.getLanguage() : null) ?? "json"
                                const codeLines = block
                                    .getChildren()
                                    .map((l) => l.getTextContent())
                                    .join("\n")
                                try {
                                    let obj: Record<string, unknown>
                                    if (lang === "json") {
                                        obj = JSON.parse(codeLines) as Record<string, unknown>
                                    } else {
                                        try {
                                            obj = yaml.load(codeLines) as Record<string, unknown>
                                        } catch (e) {
                                            // Fallback: YAML might actually be JSON
                                            obj = JSON.parse(codeLines) as Record<string, unknown>
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
                                const blockLang2 = $isCodeBlockNode(block)
                                    ? block.getLanguage()
                                    : null
                                const lang2 =
                                    blockLang2 === "json" || blockLang2 === "yaml"
                                        ? blockLang2
                                        : "json"
                                const newText =
                                    lang2 === "json"
                                        ? JSON.stringify(jsonValue, null, 2)
                                        : yaml.dump(jsonValue, {indent: 2})
                                const currentText = block
                                    .getChildren()
                                    .map((l) => l.getTextContent())
                                    .join("\n")
                                if (currentText === newText) {
                                    return // no changes, keep existing nodes
                                }
                                block.clear()
                                createHighlightedNodes(newText, lang2).forEach((n) =>
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
        const lastEmittedTextRef = useRef<string>("")
        const onChangeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

        // Use controlled value if provided, otherwise fall back to initialValue
        const effectiveValue = value !== undefined ? value : initialValue
        const shouldDisableLineNumbersForLargeDoc = useMemo(() => {
            if (!codeOnly || !showLineNumbers) {
                return false
            }

            const text = effectiveValue || ""
            if (text.length >= LARGE_DOC_LINE_NUMBER_DISABLE_CHAR_THRESHOLD) {
                return true
            }

            let lineCount = 1
            for (let i = 0; i < text.length; i++) {
                if (text.charCodeAt(i) === 10) {
                    lineCount += 1
                    if (lineCount >= LARGE_DOC_LINE_NUMBER_DISABLE_LINE_THRESHOLD) {
                        return true
                    }
                }
            }

            return false
        }, [codeOnly, effectiveValue, showLineNumbers])

        const [isLargeDocByRuntimeLineCount, setIsLargeDocByRuntimeLineCount] = useState(false)
        const isLargeDocByRuntimeLineCountRef = useRef(false)

        useEffect(() => {
            isLargeDocByRuntimeLineCountRef.current = false

            if (!codeOnly || !showLineNumbers) {
                setIsLargeDocByRuntimeLineCount(false)
                return
            }
            // If we already know from raw text size that this is a large doc,
            // runtime line-count tracking is redundant and adds update-path overhead.
            if (shouldDisableLineNumbersForLargeDoc) {
                setIsLargeDocByRuntimeLineCount(false)
                return
            }

            const refreshLargeDocState = () => {
                let lineCount = 0
                editor.getEditorState().read(() => {
                    const root = $getRoot()
                    const codeBlock = root.getChildren().find($isCodeBlockNode)
                    if ($isCodeBlockNode(codeBlock)) {
                        lineCount = $getLineCount(codeBlock)
                    }
                })
                const isLargeLineCount = lineCount >= LARGE_DOC_LINE_NUMBER_DISABLE_LINE_THRESHOLD

                if (isLargeDocByRuntimeLineCountRef.current === isLargeLineCount) {
                    return
                }

                isLargeDocByRuntimeLineCountRef.current = isLargeLineCount
                setIsLargeDocByRuntimeLineCount(isLargeLineCount)
            }

            refreshLargeDocState()

            return mergeRegister(
                editor.registerRootListener(() => {
                    refreshLargeDocState()
                }),
                editor.registerUpdateListener(({dirtyElements, dirtyLeaves}) => {
                    if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
                        return
                    }
                    refreshLargeDocState()
                }),
            )
        }, [codeOnly, editor, showLineNumbers, shouldDisableLineNumbersForLargeDoc])

        const shouldEnableLargeDocOptimizations =
            shouldDisableLineNumbersForLargeDoc || isLargeDocByRuntimeLineCount

        const hasExplicitHeight = useMemo(() => {
            const height = dimensions?.height
            if (height == null) {
                return false
            }
            if (typeof height === "number") {
                return height > 0
            }
            const normalized = height.trim().toLowerCase()
            if (!normalized) {
                return false
            }
            return (
                normalized !== "auto" &&
                normalized !== "fit-content" &&
                normalized !== "max-content" &&
                normalized !== "min-content" &&
                normalized !== "unset" &&
                normalized !== "initial" &&
                normalized !== "inherit"
            )
        }, [dimensions?.height])

        const editorInnerStyle = useMemo<CSSProperties | undefined>(() => {
            const style: CSSProperties = {}

            if (dimensions?.width) {
                style.width = dimensions.width
            }
            if (hasExplicitHeight && dimensions?.height) {
                style.height = dimensions.height
            }

            // Virtualization needs a bounded scroll container.
            // If caller did not provide a fixed height, apply a large-doc default.
            if (codeOnly && shouldEnableLargeDocOptimizations && !hasExplicitHeight) {
                style.maxHeight = "70vh"
                style.overflow = "auto"
            }

            return Object.keys(style).length > 0 ? style : undefined
        }, [
            codeOnly,
            dimensions?.height,
            dimensions?.width,
            hasExplicitHeight,
            shouldEnableLargeDocOptimizations,
        ])

        useEffect(() => {
            if (!codeOnly) {
                return
            }

            extensionFlowLog("largeDocClassState", {
                editorId: id,
                showLineNumbers,
                shouldDisableLineNumbersForLargeDoc,
                isLargeDocByRuntimeLineCount,
                shouldEnableLargeDocOptimizations,
            })
        }, [
            codeOnly,
            id,
            isLargeDocByRuntimeLineCount,
            shouldDisableLineNumbersForLargeDoc,
            shouldEnableLargeDocOptimizations,
            showLineNumbers,
        ])

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
                        "large-doc-optimizations": codeOnly && shouldEnableLargeDocOptimizations,
                        "no-line-numbers": codeOnly && !showLineNumbers,
                    })}
                    style={editorInnerStyle}
                >
                    {view === "code" ? (
                        <EditorPlugins
                            id={id}
                            autoFocus={autoFocus}
                            showToolbar={showToolbar}
                            singleLine={singleLine}
                            codeOnly={codeOnly}
                            debug={debug}
                            language={language}
                            placeholder={placeholder}
                            handleUpdate={handleUpdate}
                            hasOnChange={Boolean(onChange)}
                            initialValue={initialValue}
                            value={value}
                            onPropertyClick={onPropertyClick}
                            disableLongText={disableLongText}
                            loadingFallback={loadingFallback}
                            useNativeCodeNodes={useNativeCodeNodes}
                            isDiffView={Boolean(diffExtensionConfig)}
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
    tokens = EMPTY_TOKENS,
    templateFormat = "curly",
    autoFocus = false,
    debug = false,
    enableResize = false,
    boundWidth = true,
    boundHeight,
    showBorder = true,
    validationSchema,
    children,
    dimensions,
    onPropertyClick,
    diffExtensionConfig,
    disableLongText = false,
    disableCodeFoldingPlugin = false,
    disableIndentationPlugin = false,
    useNativeCodeNodes = false,
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
        useNativeCodeNodes,
    })

    const extension = useMemo(() => {
        if (!config) {
            extensionFlowLog("skip extension build: no config", {
                id,
            })
            return null
        }

        const extensionDependencies: AnyLexicalExtensionArgument[] = []
        const extensionDependencyLabels: string[] = []
        const shouldMountModelExtension = validationSchema !== undefined
        const shouldMountValidationExtensions = validationSchema != null

        if (codeOnly && !useNativeCodeNodes) {
            if (diffExtensionConfig) {
                // Diff-only: minimal extension set (read-only view)
                extensionDependencies.push(
                    CodeVirtualizationExtension,
                    configExtension(DiffHighlightExtension, {
                        originalContent: diffExtensionConfig.originalContent,
                        modifiedContent: diffExtensionConfig.modifiedContent,
                        language:
                            diffExtensionConfig.language ?? (language === "yaml" ? "yaml" : "json"),
                        enableFolding: diffExtensionConfig.enableFolding ?? false,
                        foldThreshold: diffExtensionConfig.foldThreshold ?? 5,
                        showFoldedLineCount: diffExtensionConfig.showFoldedLineCount ?? true,
                    }),
                )
                extensionDependencyLabels.push(
                    "@agenta/editor/code/CodeVirtualization",
                    "@agenta/editor/code/DiffHighlight",
                )
            } else {
                // Interactive editor: full extension set
                extensionDependencies.push(
                    configExtension(CodeBehaviorCommandsExtension, {
                        disableIndentation: disableIndentationPlugin,
                    }),
                    CodeVirtualizationExtension,
                    configExtension(HighlightCoreExtension, {
                        disableLongText,
                    }),
                )
                extensionDependencyLabels.push(
                    "@agenta/editor/code/CodeBehaviorCommands",
                    "@agenta/editor/code/CodeVirtualization",
                    "@agenta/editor/code/HighlightCore",
                )
                if (!disableCodeFoldingPlugin) {
                    extensionDependencies.push(CodeFoldingExtension)
                    extensionDependencyLabels.push("@agenta/editor/code/CodeFolding")
                }
                if (shouldMountModelExtension) {
                    extensionDependencies.push(
                        configExtension(CodeModelExtension, {
                            editorId: id,
                            schema: validationSchema ?? undefined,
                        }),
                    )
                    extensionDependencyLabels.push("@agenta/editor/code/CodeModel")
                }
                if (shouldMountValidationExtensions) {
                    extensionDependencies.push(
                        configExtension(ValidationCoreExtension, {
                            editorId: id,
                        }),
                        ValidationExtension,
                    )
                    extensionDependencyLabels.push(
                        "@agenta/editor/code/ValidationCore",
                        "@agenta/editor/code/Validation",
                    )
                }
                if (onPropertyClick) {
                    extensionDependencies.push(
                        configExtension(PropertyClickExtension, {
                            onPropertyClick,
                            language: language ?? "json",
                        }),
                    )
                    extensionDependencyLabels.push("@agenta/editor/code/PropertyClick")
                }
            }
        }

        if (enableTokens) {
            extensionDependencies.push(
                configExtension(TokenBehaviorExtension, {
                    templateFormat,
                    tokens: tokens || [],
                }),
            )
            extensionDependencyLabels.push("@agenta/editor/token/TokenBehavior")
        }

        extensionFlowLog("build extension", {
            id,
            codeOnly,
            useNativeCodeNodes,
            enableTokens,
            hasValidationSchema: validationSchema != null,
            hasModelPipeline: shouldMountModelExtension,
            hasValidationPipeline: shouldMountValidationExtensions,
            hasPropertyClick: Boolean(onPropertyClick),
            hasDiffConfig: Boolean(diffExtensionConfig),
            disableCodeFoldingPlugin,
            disableIndentationPlugin,
            dependencyCount: extensionDependencies.length,
            dependencies: extensionDependencyLabels,
        })

        return defineExtension({
            name: "@agenta/ui/editor/root",
            namespace: config.namespace,
            onError: config.onError,
            nodes: config.nodes,
            theme: config.theme,
            editable: config.editable,
            $initialEditorState: config.editorState as InitialEditorStateType,
            dependencies: extensionDependencies.length > 0 ? extensionDependencies : undefined,
        })
    }, [
        codeOnly,
        config,
        diffExtensionConfig,
        disableLongText,
        disableCodeFoldingPlugin,
        disableIndentationPlugin,
        enableTokens,
        id,
        language,
        onPropertyClick,
        templateFormat,
        tokens,
        useNativeCodeNodes,
        validationSchema,
    ])

    useEffect(() => {
        extensionFlowLog("render provider", {
            id,
            hasExtension: Boolean(extension),
        })
    }, [extension, id])

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
            {extension ? (
                <LexicalExtensionComposer extension={extension} contentEditable={null}>
                    {children}
                </LexicalExtensionComposer>
            ) : null}
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
    tokens = EMPTY_TOKENS,
    additionalCodePlugins = [],
    showLineNumbers = true,
    onPropertyClick,
    diffExtensionConfig,
    disableLongText = false,
    loadingFallback = "skeleton",
    disableCodeFoldingPlugin = false,
    disableIndentationPlugin = false,
    useNativeCodeNodes = false,
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
                    loadingFallback={loadingFallback}
                    disableLongText={disableLongText}
                    disableCodeFoldingPlugin={disableCodeFoldingPlugin}
                    disableIndentationPlugin={disableIndentationPlugin}
                    useNativeCodeNodes={useNativeCodeNodes}
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
                    tokens={tokens}
                    templateFormat={templateFormat}
                    autoFocus={autoFocus}
                    debug={debug}
                    enableResize={enableResize}
                    boundWidth={boundWidth}
                    boundHeight={boundHeight}
                    showBorder={showBorder}
                    validationSchema={validationSchema}
                    onPropertyClick={onPropertyClick}
                    diffExtensionConfig={diffExtensionConfig}
                    disableLongText={disableLongText}
                    disableCodeFoldingPlugin={disableCodeFoldingPlugin}
                    disableIndentationPlugin={disableIndentationPlugin}
                    useNativeCodeNodes={useNativeCodeNodes}
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
                        loadingFallback={loadingFallback}
                        disableLongText={disableLongText}
                        disableCodeFoldingPlugin={disableCodeFoldingPlugin}
                        disableIndentationPlugin={disableIndentationPlugin}
                        useNativeCodeNodes={useNativeCodeNodes}
                    />
                </EditorProvider>
            )}
        </div>
    )
}

export default memo(Editor)
