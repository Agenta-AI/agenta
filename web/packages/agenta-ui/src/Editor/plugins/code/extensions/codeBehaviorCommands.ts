import {createLogger} from "@agenta/shared/utils"
import {mergeRegister} from "@lexical/utils"
import {defineExtension} from "lexical"

import {registerAutoCloseBracketsCommands} from "../core/commands/registerAutoCloseBracketsCommands"
import {registerAutoFormatAndValidateOnPasteCommands} from "../core/commands/registerAutoFormatAndValidateOnPasteCommands"
import {registerBasicEnterCommands} from "../core/commands/registerBasicEnterCommands"
import {registerClosingBracketIndentationCommands} from "../core/commands/registerClosingBracketIndentationCommands"
import {registerIndentationCommands} from "../core/commands/registerIndentationCommands"
import {registerVerticalNavigationCommands} from "../core/commands/registerVerticalNavigationCommands"

const log = createLogger("CodeBehaviorCommandsExtension", {disabled: true})

export const CodeBehaviorCommandsExtension = defineExtension({
    name: "@agenta/editor/code/CodeBehaviorCommands",
    config: {
        disableIndentation: false,
    },
    register: (editor, config) => {
        log("register", {
            editorKey: editor.getKey(),
            disableIndentation: config.disableIndentation,
        })
        const unregisterCallbacks: (() => void)[] = []
        if (!config.disableIndentation) {
            unregisterCallbacks.push(registerIndentationCommands(editor))
            unregisterCallbacks.push(registerClosingBracketIndentationCommands(editor))
        } else {
            unregisterCallbacks.push(registerBasicEnterCommands(editor))
        }
        unregisterCallbacks.push(registerAutoCloseBracketsCommands(editor))
        unregisterCallbacks.push(registerVerticalNavigationCommands(editor))
        unregisterCallbacks.push(registerAutoFormatAndValidateOnPasteCommands(editor))

        const unregister = mergeRegister(...unregisterCallbacks)
        return () => {
            log("cleanup", {
                editorKey: editor.getKey(),
            })
            unregister()
        }
    },
})
