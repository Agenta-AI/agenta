import {createLogger} from "@agenta/shared/utils"
import {defineExtension} from "lexical"

import {registerCodeVirtualizationCore} from "../core/virtualization/controller"

interface CodeVirtualizationConfig {
    lineThreshold: number
    overscanLines: number
    activeLineOverscan: number
    estimatedLineHeight: number
    minVisibleLines: number
    freezeWindowOnScroll: boolean
}

const log = createLogger("CodeVirtualizationExtension", {disabled: true})

export const CodeVirtualizationExtension = defineExtension({
    name: "@agenta/editor/code/CodeVirtualization",
    config: {
        lineThreshold: 1200,
        overscanLines: 180,
        activeLineOverscan: 220,
        estimatedLineHeight: 24,
        minVisibleLines: 120,
        freezeWindowOnScroll: false,
    } as CodeVirtualizationConfig,
    register: (editor, config) => {
        log("register", {
            editorKey: editor.getKey(),
            ...config,
        })
        const unregister = registerCodeVirtualizationCore(editor, {
            lineThreshold: config.lineThreshold,
            overscanLines: config.overscanLines,
            activeLineOverscan: config.activeLineOverscan,
            estimatedLineHeight: config.estimatedLineHeight,
            minVisibleLines: config.minVisibleLines,
            freezeWindowOnScroll: config.freezeWindowOnScroll,
        })
        return () => {
            log("cleanup", {
                editorKey: editor.getKey(),
            })
            unregister()
        }
    },
})
