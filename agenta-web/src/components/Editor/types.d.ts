import {EditorState, LexicalEditor} from "lexical"

export interface EditorProps {
    id?: string
    initialValue?: string
    onChange?: (value: {textContent: string; tokens?: unknown[]; value?: string}) => void
    placeholder?: string
    singleLine?: boolean
    codeOnly?: boolean
    language?: string
    showToolbar?: boolean
    enableTokens?: boolean
    enableResize?: boolean
    boundWidth?: boolean
    boundHeight?: boolean
    debug?: boolean
    dimensions: {
        width: number
        height: number
    }
    showBorder?: boolean
}

export interface EditorPluginsProps {
    showToolbar: boolean
    singleLine: boolean
    codeOnly: boolean
    enableTokens: boolean
    debug: boolean
    language?: string
    placeholder?: string
    handleUpdate: (editorState: EditorState, editor: LexicalEditor) => void
}
