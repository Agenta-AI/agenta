import {defineExtension} from "lexical"

import {registerDiffHighlightBehavior} from "../plugins/DiffHighlightPlugin"

interface DiffHighlightConfig {
    originalContent: string | null
    modifiedContent: string | null
    language: "json" | "yaml"
    enableFolding: boolean
    foldThreshold: number
    showFoldedLineCount: boolean
}

export const DiffHighlightExtension = defineExtension({
    name: "@agenta/editor/code/DiffHighlight",
    config: {
        originalContent: null,
        modifiedContent: null,
        language: "json",
        enableFolding: false,
        foldThreshold: 5,
        showFoldedLineCount: true,
    } as DiffHighlightConfig,
    register: (editor, config) => {
        return registerDiffHighlightBehavior(editor, {
            originalContent: config.originalContent ?? undefined,
            modifiedContent: config.modifiedContent ?? undefined,
            language: config.language,
            enableFolding: config.enableFolding,
            foldThreshold: config.foldThreshold,
            showFoldedLineCount: config.showFoldedLineCount,
        })
    },
})
