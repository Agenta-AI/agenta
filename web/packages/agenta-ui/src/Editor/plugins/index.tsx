import {lazy, Suspense} from "react"

import {AutoFocusPlugin} from "@lexical/react/LexicalAutoFocusPlugin"
import {ContentEditable} from "@lexical/react/LexicalContentEditable"
import {LexicalErrorBoundary} from "@lexical/react/LexicalErrorBoundary"
import {HistoryPlugin} from "@lexical/react/LexicalHistoryPlugin"
import {OnChangePlugin} from "@lexical/react/LexicalOnChangePlugin"
import {RichTextPlugin} from "@lexical/react/LexicalRichTextPlugin"
import {Skeleton} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {markdownViewAtom} from "../state/assets/atoms"
import type {EditorPluginsProps} from "../types"

import MarkdownPlugin from "./markdown/markdownPlugin"

const importTabIndentationPlugin = () =>
    import("@lexical/react/LexicalTabIndentationPlugin").then((module) => ({
        default: module.TabIndentationPlugin,
    }))
const importToolbarPlugin = () =>
    import("./toolbar/ToolbarPlugin").then((module) => ({
        default: module.ToolbarPlugin,
    }))
const importDebugPlugin = () =>
    import("./debug/DebugPlugin").then((module) => ({
        default: module.DebugPlugin,
    }))
const importSingleLinePlugin = () =>
    import("./singleline/SingleLinePlugin").then((module) => ({
        default: module.SingleLinePlugin,
    }))
const importCodeEditorPlugin = () => import("./code")
const importNativeCodeOnlyPlugin = () =>
    import("./code/NativeCodeOnlyPlugin").then((module) => ({
        default: module.NativeCodeOnlyPlugin,
    }))

let preloadPromise: Promise<void> | null = null

/**
 * Preloads editor plugin chunks so first editor render avoids Suspense fallback.
 */
export const preloadEditorPlugins = () => {
    if (!preloadPromise) {
        preloadPromise = Promise.all([
            importTabIndentationPlugin(),
            importToolbarPlugin(),
            importDebugPlugin(),
            importSingleLinePlugin(),
            importCodeEditorPlugin(),
            importNativeCodeOnlyPlugin(),
        ])
            .then(() => undefined)
            .catch(() => undefined)
    }

    return preloadPromise
}

const TabIndentationPlugin = lazy(importTabIndentationPlugin)
const ToolbarPlugin = lazy(importToolbarPlugin)
const DebugPlugin = lazy(importDebugPlugin)
const SingleLinePlugin = lazy(importSingleLinePlugin)
const CodeEditorPlugin = lazy(importCodeEditorPlugin)
const NativeCodeOnlyPlugin = lazy(importNativeCodeOnlyPlugin)

const EditorPlugins = ({
    id,
    showToolbar,
    showMarkdownToggleButton,
    singleLine,
    codeOnly,
    largeDocumentMode = false,
    debug,
    language,
    placeholder,
    autoFocus,
    handleUpdate,
    initialValue,
    value,
    hasOnChange = false,
    onPropertyClick,
    disableLongText,
    loadingFallback = "skeleton",
    useNativeCodeNodes = false,
    isDiffView = false,
}: EditorPluginsProps) => {
    const markdown = useAtomValue(markdownViewAtom(id))

    return (
        <Suspense
            fallback={
                loadingFallback === "none" ? null : loadingFallback === "static" ? (
                    <div
                        className={clsx(
                            "editor-input relative outline-none min-h-[inherit] whitespace-pre-wrap break-words",
                            {
                                "single-line whitespace-nowrap overflow-x-auto": singleLine,
                                "code-only": codeOnly,
                            },
                        )}
                    >
                        {value !== undefined ? value : initialValue}
                    </div>
                ) : (
                    <Skeleton
                        className={clsx(["editor-skeleton", {"pl-2": codeOnly}])}
                        title={false}
                        paragraph={{rows: 4, width: "100%"}}
                    />
                )
            }
        >
            <RichTextPlugin
                contentEditable={
                    <ContentEditable
                        className={clsx(
                            `editor-input relative outline-none min-h-[inherit] ${
                                singleLine ? "single-line whitespace-nowrap overflow-x-auto" : ""
                            } ${codeOnly ? "code-only" : ""}`,
                            {
                                "markdown-view": markdown,
                            },
                        )}
                        spellCheck={!codeOnly && !largeDocumentMode}
                        autoCorrect={codeOnly || largeDocumentMode ? "off" : undefined}
                        autoCapitalize={codeOnly || largeDocumentMode ? "off" : undefined}
                        translate={codeOnly || largeDocumentMode ? "no" : undefined}
                        data-gramm="false"
                        data-gramm_editor="false"
                        data-enable-grammarly="false"
                        data-agenta-large-doc={largeDocumentMode ? "true" : "false"}
                    />
                }
                placeholder={
                    <div className="editor-placeholder absolute pointer-events-none text-[#BDC7D1]">
                        {placeholder}
                    </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
            />
            {!isDiffView && <HistoryPlugin />}
            {autoFocus ? <AutoFocusPlugin /> : null}
            {hasOnChange && <OnChangePlugin onChange={handleUpdate} ignoreSelectionChange={true} />}
            {showToolbar && !singleLine && !codeOnly && <ToolbarPlugin />}
            {singleLine && <SingleLinePlugin />}
            {codeOnly && !isDiffView && (
                <>
                    {useNativeCodeNodes ? (
                        <NativeCodeOnlyPlugin
                            initialValue={value !== undefined ? value : initialValue}
                            language={language}
                        />
                    ) : (
                        <CodeEditorPlugin
                            initialValue={value !== undefined ? value : initialValue}
                            language={language ?? "json"}
                            onPropertyClick={onPropertyClick}
                            disableLongText={disableLongText}
                        />
                    )}
                    <TabIndentationPlugin />
                </>
            )}
            {debug && <DebugPlugin />}
            {singleLine || codeOnly ? null : (
                <MarkdownPlugin id={id} largeDocumentMode={largeDocumentMode} />
            )}
        </Suspense>
    )
}

export default EditorPlugins
