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

const CodeFoldingPlugin = lazy(() =>
    import("./code/plugins/CodeFoldingPlugin").then((module) => ({
        default: module.CodeFoldingPlugin,
    })),
)
const TabIndentationPlugin = lazy(() =>
    import("@lexical/react/LexicalTabIndentationPlugin").then((module) => ({
        default: module.TabIndentationPlugin,
    })),
)
const ToolbarPlugin = lazy(() =>
    import("./toolbar/ToolbarPlugin").then((module) => ({
        default: module.ToolbarPlugin,
    })),
)
const DebugPlugin = lazy(() =>
    import("./debug/DebugPlugin").then((module) => ({
        default: module.DebugPlugin,
    })),
)
const SingleLinePlugin = lazy(() =>
    import("./singleline/SingleLinePlugin").then((module) => ({
        default: module.SingleLinePlugin,
    })),
)
const CodeEditorPlugin = lazy(() => import("./code"))

const TokenPlugin = lazy(() =>
    import("./token/TokenPlugin").then((module) => ({
        default: module.TokenPlugin,
    })),
)
const AutoCloseTokenBracesPlugin = lazy(() =>
    import("./token/AutoCloseTokenBracesPlugin").then((module) => ({
        default: module.AutoCloseTokenBracesPlugin,
    })),
)
const TokenTypeaheadPlugin = lazy(() =>
    import("./token/TokenTypeaheadPlugin").then((module) => ({
        default: module.TokenMenuPlugin,
    })),
)

const EditorPlugins = ({
    id,
    showToolbar,
    singleLine,
    codeOnly,
    enableTokens,
    debug,
    language,
    placeholder,
    autoFocus,
    handleUpdate,
    initialValue,
    validationSchema,
    tokens,
    templateFormat,
    additionalCodePlugins = [],
}: EditorPluginsProps) => {
    const markdown = useAtomValue(markdownViewAtom(id))

    return (
        <Suspense
            fallback={
                <Skeleton
                    className={clsx(["editor-skeleton", {"pl-2": codeOnly}])}
                    title={false}
                    paragraph={{rows: 4, width: "100%"}}
                />
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
                        initialValue={initialValue}
                        language={language}
                        debug={debug}
                        additionalCodePlugins={additionalCodePlugins}
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
