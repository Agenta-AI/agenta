import {EditorState, LexicalEditor} from "lexical"

import {CustomRenderFn} from "./form/nodes/NodeTypes"

export interface EditorContextType {
    editor: LexicalEditor | null
    config: Record<string, unknown> | null
}

export interface EditorDiffExtensionConfig {
    originalContent: string
    modifiedContent: string
    language?: "json" | "yaml"
    enableFolding?: boolean
    foldThreshold?: number
    showFoldedLineCount?: boolean
}

export interface EditorProviderProps extends React.HTMLProps<HTMLDivElement> {
    children: React.ReactNode
    dimensions?: {
        width: number | string
        maxWidth?: number | string
        height: number | string
    }
}

export interface EditorProps extends React.HTMLProps<HTMLDivElement> {
    disabled?: boolean
    id?: string
    initialEditorState?: LexicalEditor["_editorState"]
    initialValue?: string
    /** Controlled value - when provided, editor re-hydrates when this changes (for undo/redo support) */
    value?: string
    onChange?: (value: {textContent: string; tokens?: unknown[]; value?: string}) => void
    placeholder?: string
    singleLine?: boolean
    autoFocus?: boolean
    codeOnly?: boolean
    language?: "json" | "yaml" | "code" | "python" | "javascript" | "typescript"
    showToolbar?: boolean
    /** Render inline markdown preview toggle control inside the editor container */
    showMarkdownToggleButton?: boolean
    enableTokens?: boolean
    tokens?: string[]
    /** Template format for prompt variable/tag highlighting */
    templateFormat?: "curly" | "fstring" | "jinja2"
    noProvider?: boolean
    showLineNumbers?: boolean
    /** Custom render function to override node rendering in Form view */
    customRender?: CustomRenderFn
    enableResize?: boolean
    boundWidth?: boolean
    boundHeight?: boolean
    debug?: boolean
    dimensions?: {
        width: number | string
        maxWidth?: number | string
        height: number | string
    }
    showBorder?: boolean
    validationSchema?: Record<string, unknown> | null
    /** Additional plugins to include in code editor */
    additionalCodePlugins?: React.ReactNode[]
    /** Callback when a JSON property key is Cmd/Meta+clicked (for drill-in navigation) */
    onPropertyClick?: (path: string) => void
    /** Optional diff content/config used by DiffHighlight extension runtime */
    diffExtensionConfig?: EditorDiffExtensionConfig
    /** Disable long text node truncation (show full content instead of [N chars]) */
    disableLongText?: boolean
    /** Suspense fallback mode for lazily loaded editor plugins */
    loadingFallback?: "skeleton" | "none" | "static"
    /** Disable code folding plugin/extension registration */
    disableCodeFoldingPlugin?: boolean
    /** Disable indentation-related Enter/bracket indentation plugins/extensions */
    disableIndentationPlugin?: boolean
    /** Use Lexical built-in CodeNode flow instead of custom CodeBlock/CodeLine nodes */
    useNativeCodeNodes?: boolean
}

export interface EditorPluginsProps {
    id: string
    showToolbar: boolean
    showMarkdownToggleButton?: boolean
    singleLine: boolean
    codeOnly: boolean
    autoFocus?: boolean
    debug: boolean
    language?: "json" | "yaml" | "code" | "python" | "javascript" | "typescript"
    placeholder?: string
    /** Initial text value for the editor */
    initialValue: string
    /** Controlled value - when provided, editor re-hydrates when this changes (for undo/redo support) */
    value?: string
    handleUpdate: (
        editorState: EditorState,
        editor: LexicalEditor,
        tags?: ReadonlySet<string>,
    ) => void
    hasOnChange?: boolean
    /** Callback when a JSON property key is Cmd/Meta+clicked (for drill-in navigation) */
    onPropertyClick?: (path: string) => void
    /** Disable long text node truncation (show full content instead of [N chars]) */
    disableLongText?: boolean
    /** Suspense fallback mode for lazily loaded editor plugins */
    loadingFallback?: "skeleton" | "none" | "static"
    /** Use Lexical built-in CodeNode flow instead of custom CodeBlock/CodeLine nodes */
    useNativeCodeNodes?: boolean
    /** When true, skip interactive code editor plugins (diff mode) */
    isDiffView?: boolean
}
