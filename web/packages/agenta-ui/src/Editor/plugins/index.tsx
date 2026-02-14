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

import MarkdownHoverToggleButton from "./markdown/MarkdownHoverToggleButton"
import MarkdownPlugin from "./markdown/markdownPlugin"

const importCodeFoldingPlugin = () =>
    import("./code/plugins/CodeFoldingPlugin").then((module) => ({
        default: module.CodeFoldingPlugin,
    }))

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

const importTokenPlugin = () =>
    import("./token/TokenPlugin").then((module) => ({
        default: module.TokenPlugin,
    }))

const importAutoCloseTokenBracesPlugin = () =>
    import("./token/AutoCloseTokenBracesPlugin").then((module) => ({
        default: module.AutoCloseTokenBracesPlugin,
    }))

const importTokenTypeaheadPlugin = () =>
    import("./token/TokenTypeaheadPlugin").then((module) => ({
        default: module.TokenMenuPlugin,
    }))

let preloadPromise: Promise<void> | null = null

/**
 * Preloads editor plugin chunks so first editor render avoids Suspense fallback.
 */
export const preloadEditorPlugins = () => {
    if (!preloadPromise) {
        preloadPromise = Promise.all([
            importCodeFoldingPlugin(),
            importTabIndentationPlugin(),
            importToolbarPlugin(),
            importDebugPlugin(),
            importSingleLinePlugin(),
            importCodeEditorPlugin(),
            importTokenPlugin(),
            importAutoCloseTokenBracesPlugin(),
            importTokenTypeaheadPlugin(),
        ])
            .then(() => undefined)
            .catch(() => undefined)
    }

    return preloadPromise
}

const CodeFoldingPlugin = lazy(importCodeFoldingPlugin)
const TabIndentationPlugin = lazy(importTabIndentationPlugin)
const ToolbarPlugin = lazy(importToolbarPlugin)
const DebugPlugin = lazy(importDebugPlugin)
const SingleLinePlugin = lazy(importSingleLinePlugin)
const CodeEditorPlugin = lazy(importCodeEditorPlugin)
const TokenPlugin = lazy(importTokenPlugin)
const AutoCloseTokenBracesPlugin = lazy(importAutoCloseTokenBracesPlugin)
const TokenTypeaheadPlugin = lazy(importTokenTypeaheadPlugin)

const EditorPlugins = ({
    id,
    showToolbar,
    showMarkdownToggleButton,
    singleLine,
    codeOnly,
    enableTokens,
    debug,
    language,
    placeholder,
    autoFocus,
    handleUpdate,
    initialValue,
    value,
    validationSchema,
    tokens,
    templateFormat,
    additionalCodePlugins = [],
    onPropertyClick,
    disableLongText,
    loadingFallback = "skeleton",
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
                    />
                }
                placeholder={
                    <div className="editor-placeholder absolute pointer-events-none text-[#BDC7D1]">
                        {placeholder}
                    </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            {autoFocus ? <AutoFocusPlugin /> : null}
            <OnChangePlugin onChange={handleUpdate} ignoreSelectionChange={true} />
            {showToolbar && !singleLine && !codeOnly && <ToolbarPlugin />}
            {showMarkdownToggleButton && !singleLine && !codeOnly ? (
                <MarkdownHoverToggleButton id={id} />
            ) : null}
            {enableTokens && (
                <>
                    <TokenPlugin templateFormat={templateFormat} />
                    <AutoCloseTokenBracesPlugin />
                    <TokenTypeaheadPlugin tokens={tokens || []} />
                </>
            )}
            {singleLine && <SingleLinePlugin />}
            {codeOnly && (
                <>
                    <CodeFoldingPlugin />
                    <CodeEditorPlugin
                        editorId={id}
                        validationSchema={validationSchema}
                        initialValue={value !== undefined ? value : initialValue}
                        language={language === "yaml" ? "yaml" : "json"}
                        debug={debug}
                        additionalCodePlugins={additionalCodePlugins}
                        onPropertyClick={onPropertyClick}
                        disableLongText={disableLongText}
                    />
                    <TabIndentationPlugin />
                </>
            )}
            {debug && <DebugPlugin />}
            {singleLine || codeOnly ? null : <MarkdownPlugin id={id} />}
        </Suspense>
    )
}

export default EditorPlugins
