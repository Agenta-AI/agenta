import {lazy, Suspense} from "react"
import {RichTextPlugin} from "@lexical/react/LexicalRichTextPlugin"
import {ContentEditable} from "@lexical/react/LexicalContentEditable"
import {HistoryPlugin} from "@lexical/react/LexicalHistoryPlugin"
import {AutoFocusPlugin} from "@lexical/react/LexicalAutoFocusPlugin"
import {LexicalErrorBoundary} from "@lexical/react/LexicalErrorBoundary"
import {OnChangePlugin} from "@lexical/react/LexicalOnChangePlugin"
import type {EditorPluginsProps} from "../types"
import {Skeleton} from "antd"

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
const CodeEditorPlugin = lazy(() =>
    import("./code/CodeEditorPlugin").then((module) => ({
        default: module.CodeEditorPlugin,
    })),
)
const TokenPlugin = lazy(() =>
    import("./token/TokenPlugin").then((module) => ({
        default: module.TokenPlugin,
    })),
)

const EditorPlugins = ({
    showToolbar,
    singleLine,
    codeOnly,
    enableTokens,
    debug,
    language,
    placeholder,
    handleUpdate,
}: EditorPluginsProps) => {
    return (
        <Suspense fallback={<Skeleton title={false} paragraph={{rows: 4, width: "100%"}} />}>
            <RichTextPlugin
                contentEditable={
                    <ContentEditable
                        className={`editor-input p-2 outline-none ${
                            singleLine ? "single-line whitespace-nowrap overflow-x-auto" : ""
                        } ${codeOnly ? "code-only" : ""}`}
                    />
                }
                placeholder={<div className="editor-placeholder">{placeholder}</div>}
                ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <AutoFocusPlugin />
            <OnChangePlugin onChange={handleUpdate} />
            {showToolbar && !singleLine && !codeOnly && <ToolbarPlugin />}
            {enableTokens && <TokenPlugin />}
            {singleLine && <SingleLinePlugin />}
            {codeOnly && <CodeEditorPlugin language={language} />}
            {debug && <DebugPlugin />}
        </Suspense>
    )
}

export default EditorPlugins
