import {EditorState, LexicalEditor} from "lexical"

export interface EditorContextType {
    editor: LexicalEditor | null
    config: any
}

export interface EditorProviderProps extends React.HTMLProps<HTMLDivElement> {
    children: React.ReactNode
    dimensions?: {
        width: number
        height: number
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
    language?: string
    showToolbar?: boolean
    enableTokens?: boolean
    enableResize?: boolean
    boundWidth?: boolean
    boundHeight?: boolean
    debug?: boolean
    dimensions?: {
        width: number
        height: number
    }
    showBorder?: boolean
    validationSchema?: unknown
}

export interface EditorPluginsProps {
    showToolbar: boolean
    singleLine: boolean
    codeOnly: boolean
    autoFocus?: boolean
    enableTokens: boolean
    debug: boolean
    language?: string
    placeholder?: string
    validationSchema?: unknown
    handleUpdate: (editorState: EditorState, editor: LexicalEditor) => void
}
