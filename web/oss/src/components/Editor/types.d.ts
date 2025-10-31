import {EditorState, LexicalEditor} from "lexical"

import {CustomRenderFn} from "./form/nodes/NodeTypes"

export interface EditorContextType {
    editor: LexicalEditor | null
    config: any
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
    onChange?: (value: {textContent: string; tokens?: unknown[]; value?: string}) => void
    placeholder?: string
    singleLine?: boolean
    autoFocus?: boolean
    codeOnly?: boolean
    language?: "json" | "yaml" | "code"
    showToolbar?: boolean
    enableTokens?: boolean
    tokens?: string[]
    /** Template format for prompt variable/tag highlighting */
    templateFormat?: "curly" | "fstring" | "jinja2"
    noProvider?: boolean
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
    validationSchema?: unknown
    /** Additional plugins to include in code editor */
    additionalCodePlugins?: React.ReactNode[]
}

export interface EditorPluginsProps {
    id: string
    showToolbar: boolean
    singleLine: boolean
    codeOnly: boolean
    autoFocus?: boolean
    enableTokens: boolean
    debug: boolean
    language?: "json" | "yaml" | "code"
    placeholder?: string
    /** Initial text value for the editor */
    initialValue: string
    validationSchema?: unknown
    tokens?: string[]
    templateFormat?: "curly" | "fstring" | "jinja2"
    handleUpdate: (editorState: EditorState, editor: LexicalEditor) => void
    /** Additional plugins to include in code editor */
    additionalCodePlugins?: React.ReactNode[]
}
