import {createLogger} from "@agenta/shared/utils"
import {defineExtension} from "lexical"

import {registerSyntaxHighlightCore} from "../core/highlight/register"

interface HighlightCoreConfig {
    disableLongText: boolean
}

const log = createLogger("HighlightCoreExtension", {disabled: true})

export const HighlightCoreExtension = defineExtension({
    name: "@agenta/editor/code/HighlightCore",
    config: {
        disableLongText: false,
    } as HighlightCoreConfig,
    register: (editor, config) => {
        log("register", {
            editorKey: editor.getKey(),
            disableLongText: config.disableLongText,
        })
        const unregister = registerSyntaxHighlightCore(editor, {
            disableLongText: config.disableLongText,
        })
        return () => {
            log("cleanup", {
                editorKey: editor.getKey(),
            })
            unregister()
        }
    },
})
