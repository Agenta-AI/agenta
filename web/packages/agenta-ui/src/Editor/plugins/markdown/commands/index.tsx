import {createCommand, EditorState, LexicalCommand, LexicalEditor} from "lexical"

export const TOGGLE_MARKDOWN_VIEW: LexicalCommand<void> = createCommand("TOGGLE_MARKDOWN_VIEW")

export interface OnChangePayload {
    editorState: EditorState
    _editor: LexicalEditor
}

export const ON_CHANGE_COMMAND: LexicalCommand<OnChangePayload> = createCommand("ON_CHANGE_COMMAND")
