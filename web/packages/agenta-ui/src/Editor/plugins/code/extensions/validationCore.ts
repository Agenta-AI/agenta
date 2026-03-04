import {createLogger} from "@agenta/shared/utils"
import {defineExtension} from "lexical"

import {createValidationRuntimeOutput, registerValidationRuntime} from "../core/validation/runtime"

import {CodeModelExtension} from "./codeModel"

interface ValidationCoreConfig {
    editorId: string
}

const log = createLogger("ValidationCoreExtension", {disabled: true})

export const ValidationCoreExtension = defineExtension({
    name: "@agenta/editor/code/ValidationCore",
    config: {
        editorId: "",
    } as ValidationCoreConfig,
    dependencies: [CodeModelExtension],
    build: () => {
        log("build")
        return createValidationRuntimeOutput()
    },
    register: (editor, config, state) => {
        log("register", {
            editorId: config.editorId,
            editorKey: editor.getKey(),
        })
        const modelOutput = state.getDependency(CodeModelExtension).output
        const unregister = registerValidationRuntime(editor, {
            editorId: config.editorId,
            modelOutput,
            output: state.getOutput(),
        })
        return () => {
            log("cleanup", {
                editorId: config.editorId,
                editorKey: editor.getKey(),
            })
            unregister()
        }
    },
})
