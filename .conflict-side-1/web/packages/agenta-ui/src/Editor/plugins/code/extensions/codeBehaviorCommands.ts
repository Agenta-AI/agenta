import {createLogger} from "@agenta/shared/utils"
import {mergeRegister} from "@lexical/utils"
import {
    $addUpdateTag,
    COMMAND_PRIORITY_HIGH,
    defineExtension,
    KEY_DOWN_COMMAND,
    type LexicalEditor,
    SKIP_SCROLL_INTO_VIEW_TAG,
} from "lexical"

import {registerAutoCloseBracketsCommands} from "../core/commands/registerAutoCloseBracketsCommands"
import {registerAutoFormatAndValidateOnPasteCommands} from "../core/commands/registerAutoFormatAndValidateOnPasteCommands"
import {registerBasicEnterCommands} from "../core/commands/registerBasicEnterCommands"
import {registerClosingBracketIndentationCommands} from "../core/commands/registerClosingBracketIndentationCommands"
import {registerIndentationCommands} from "../core/commands/registerIndentationCommands"
import {registerVerticalNavigationCommands} from "../core/commands/registerVerticalNavigationCommands"

const log = createLogger("CodeBehaviorCommandsExtension", {disabled: true})

function registerSkipScrollCommands(editor: LexicalEditor) {
    return editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
            if (event.key !== "Backspace" && event.key !== "Delete") return false

            $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG)
            return false
        },
        COMMAND_PRIORITY_HIGH,
    )
}

export const CodeBehaviorCommandsExtension = defineExtension({
    name: "@agenta/editor/code/CodeBehaviorCommands",
    config: {
        disableIndentation: false,
        skipScroll: false,
    },
    register: (editor, config) => {
        log("register", {
            editorKey: editor.getKey(),
            disableIndentation: config.disableIndentation,
            skipScroll: config.skipScroll,
        })
        const unregisterCallbacks: (() => void)[] = []
        if (!config.disableIndentation) {
            unregisterCallbacks.push(
                registerIndentationCommands(editor, {
                    skipScroll: config.skipScroll,
                }),
            )
            unregisterCallbacks.push(registerClosingBracketIndentationCommands(editor))
        } else {
            unregisterCallbacks.push(
                registerBasicEnterCommands(editor, {
                    skipScroll: config.skipScroll,
                }),
            )
        }
        if (config.skipScroll) {
            unregisterCallbacks.push(registerSkipScrollCommands(editor))
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
