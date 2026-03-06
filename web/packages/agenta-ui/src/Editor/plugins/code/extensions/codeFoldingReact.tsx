import {createElement, type ComponentType, useSyncExternalStore} from "react"

import {ExtensionComponent} from "@lexical/react/ExtensionComponent"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {ReactExtension} from "@lexical/react/ReactExtension"
import {useExtensionDependency} from "@lexical/react/useExtensionComponent"
import {configExtension, defineExtension} from "lexical"
import {createPortal} from "react-dom"

import {CodeFoldingCoreExtension} from "./codeFoldingCore"

function CodeFoldingOverlay() {
    const {output: core} = useExtensionDependency(CodeFoldingCoreExtension)
    const [editor] = useLexicalComposerContext()
    const lines = useSyncExternalStore(core.subscribe, core.getLines, core.getLines)

    if (lines.length === 0) {
        return null
    }

    // Portal into the .editor-inner wrapper (outside Lexical's DOM management)
    // so absolute positioning works correctly without interfering with reconciliation.
    const rootElement = editor.getRootElement()
    const portalTarget = rootElement?.closest(".editor-inner") as HTMLElement | null
    if (!portalTarget) {
        return null
    }

    return createPortal(
        <div className="fold-overlay">
            {lines.map((line) => {
                if (!line.foldable) return null
                return (
                    <button
                        key={line.key}
                        className="fold-toggle"
                        style={{
                            top: line.top,
                            height: line.height,
                        }}
                        onClick={() => core.toggleLineByKey(line.key)}
                    >
                        {line.collapsed ? "▸" : "▾"}
                    </button>
                )
            })}
        </div>,
        portalTarget,
    )
}

export const CodeFoldingReactExtension = defineExtension({
    name: "@agenta/editor/code/CodeFoldingReact",
    dependencies: [CodeFoldingCoreExtension],
    build: () => ({Component: CodeFoldingOverlay}),
})

function CodeFoldingReactDecorator() {
    const ExtensionComponentWithNamespace = ExtensionComponent as unknown as ComponentType<{
        "lexical:extension": typeof CodeFoldingReactExtension
    }>

    return createElement(ExtensionComponentWithNamespace, {
        "lexical:extension": CodeFoldingReactExtension,
    })
}

export const CodeFoldingExtension = defineExtension({
    name: "@agenta/editor/code/CodeFolding",
    dependencies: [
        CodeFoldingReactExtension,
        configExtension(ReactExtension, {
            decorators: [CodeFoldingReactDecorator],
        }),
    ],
})
