import {createCommand, LexicalCommand} from "lexical"

export const TOGGLE_MARKDOWN_VIEW: LexicalCommand<void> = createCommand("TOGGLE_MARKDOWN_VIEW")
export const ON_CHANGE_COMMAND: LexicalCommand<void> = createCommand("ON_CHANGE_COMMAND")
