import {defineExtension} from "lexical"

import {createCodeFoldingCoreOutput, registerCodeFoldingCore} from "../core/folding/controller"

import {HighlightCoreExtension} from "./highlightCore"

export const CodeFoldingCoreExtension = defineExtension({
    name: "@agenta/editor/code/CodeFoldingCore",
    dependencies: [HighlightCoreExtension],
    build: (editor) => createCodeFoldingCoreOutput(editor),
    register: (editor, _config, state) => {
        return registerCodeFoldingCore(editor, state.getOutput())
    },
})
