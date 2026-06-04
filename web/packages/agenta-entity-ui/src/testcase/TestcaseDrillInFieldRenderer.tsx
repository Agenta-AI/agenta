import {useCallback, useEffect, useMemo} from "react"

import {
    JsonEditorWithLocalState,
    MessagesField,
    type CoreFieldRendererProps,
    type ViewMode,
} from "@agenta/ui/drill-in"
import {EditorProvider, SET_MARKDOWN_VIEW, useLexicalComposerContext} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
// import {InputNumber, Switch} from "antd"

import {parseCodeString, toCodeString} from "./codeFormat"
import {inferPrimitiveFromText} from "./TestcasePrimitiveValue.utils"

function toDisplayString(value: unknown, viewMode?: ViewMode): string {
    if (viewMode === "yaml") return toCodeString(value, "yaml")
    if (viewMode === "json") return toCodeString(value, "json")
    if (typeof value === "string") return value
    return toCodeString(value, "json")
}

function parseCodeEditorValue(value: string, fallback: unknown, viewMode?: ViewMode): unknown {
    return parseCodeString(value, viewMode === "yaml" ? "yaml" : "json", fallback)
}

function CodeEditor({
    editorId,
    value,
    displayValue,
    viewMode,
    onChange,
    readOnly,
}: {
    editorId: string
    value: unknown
    displayValue: string
    viewMode?: ViewMode
    onChange: (value: unknown) => void
    readOnly?: boolean
}) {
    if (viewMode !== "yaml") {
        return (
            <JsonEditorWithLocalState
                editorKey={editorId}
                initialValue={displayValue}
                onValidChange={(nextValue) => onChange(parseCodeEditorValue(nextValue, value))}
                readOnly={readOnly}
            />
        )
    }

    return (
        <EditorProvider
            key={`${editorId}-provider`}
            id={editorId}
            initialValue={displayValue}
            showToolbar={false}
            codeOnly
            language="yaml"
        >
            <SharedEditor
                id={editorId}
                initialValue={displayValue}
                value={displayValue}
                handleChange={
                    readOnly
                        ? undefined
                        : (nextValue) => onChange(parseCodeEditorValue(nextValue, value, viewMode))
                }
                editorType="border"
                className="min-h-[60px] overflow-hidden"
                disableDebounce
                noProvider
                disabled={readOnly}
                state={readOnly ? "readOnly" : undefined}
                editorProps={{
                    codeOnly: true,
                    language: "yaml",
                    showLineNumbers: true,
                    disableLongText: true,
                }}
            />
        </EditorProvider>
    )
}

/**
 * Drives Lexical's markdown view to match the parent's intent. The dropdown
 * only changes which TextEditor branch is rendered — without this, the editor
 * keeps whatever markdown state it had (default rich text), so picking
 * "Markdown" looked indistinguishable from "Text".
 *
 * Must be rendered inside the EditorProvider's Lexical context so the SET
 * command is delivered to MarkdownPlugin's registered handler.
 */
function MarkdownViewSync({active}: {active: boolean}) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        editor.dispatchCommand(SET_MARKDOWN_VIEW, active)
    }, [editor, active])

    return null
}

function TextEditor({
    editorId,
    value: _value,
    displayValue,
    markdown,
    onChange,
    readOnly,
}: {
    editorId: string
    value: unknown
    displayValue: string
    markdown?: boolean
    onChange: (value: unknown) => void
    readOnly?: boolean
}) {
    // Auto-infer native types from typed text so number / boolean values
    // stop getting stored as strings. Anything that doesn't look exactly
    // like a clean number or boolean literal stays a string — see
    // inferPrimitiveFromText for the precise rules.
    const handleChange = useCallback(
        (next: string) => onChange(inferPrimitiveFromText(next)),
        [onChange],
    )

    return (
        <EditorProvider
            key={`${editorId}-provider`}
            id={editorId}
            initialValue={displayValue}
            showToolbar={false}
            enableTokens
        >
            <MarkdownViewSync active={!!markdown} />
            <SharedEditor
                id={editorId}
                initialValue={displayValue}
                value={displayValue}
                handleChange={readOnly ? undefined : handleChange}
                editorType="border"
                className="overflow-hidden"
                disableDebounce
                noProvider
                disabled={readOnly}
                state={readOnly ? "readOnly" : undefined}
                editorProps={
                    markdown
                        ? {
                              // viewMode dropdown in the field header is now the
                              // canonical way to toggle markdown — keep the
                              // inline button hidden to avoid duplication.
                              showMarkdownToggleButton: false,
                              showToolbar: false,
                              showLineNumbers: false,
                          }
                        : undefined
                }
            />
        </EditorProvider>
    )
}

export function TestcaseDrillInFieldRenderer({
    value,
    editable,
    onChange,
    fullPathKey,
    dataType,
    isRawMode,
    viewMode,
}: CoreFieldRendererProps) {
    const displayValue = useMemo(() => toDisplayString(value, viewMode), [value, viewMode])
    const editorId = `testcase-field-${fullPathKey}`

    const handleMessagesSetValue = useCallback(
        (_path: string[], next: unknown) => onChange(next),
        [onChange],
    )

    if (isRawMode) {
        return (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 p-3 bg-gray-50 rounded-md max-h-[200px] overflow-auto">
                {displayValue}
            </pre>
        )
    }

    // Code modes are explicit format choices and should override type inference.
    if (viewMode === "json" || viewMode === "yaml") {
        return (
            <CodeEditor
                editorId={editorId}
                value={value}
                displayValue={displayValue}
                viewMode={viewMode}
                onChange={onChange}
                readOnly={!editable}
            />
        )
    }

    // Messages render as a schema-aware form for every non-code view (form /
    // text / markdown / unset). Text and markdown are filtered out of the
    // dropdown for messages (see getTestcaseViewOptions), so users only land
    // here via "form" or the default unset state — both should show the form.
    if (dataType === "messages") {
        const originalWasString = typeof value === "string"
        return (
            <MessagesField
                item={{key: fullPathKey, name: fullPathKey, value}}
                stringValue={displayValue}
                fullPath={fullPathKey.split(".")}
                setValue={handleMessagesSetValue}
                valueMode={originalWasString ? "string" : "native"}
            />
        )
    }

    // Schema-aware primitive widgets — disabled in favour of routing all
    // primitive values through TextEditor so the editor doesn't swap mid-typing.
    // The native type is still preserved via inferPrimitiveFromText in
    // TextEditor.handleChange, so the type chip stays accurate. Uncomment the
    // block below if dedicated number/boolean widgets are wanted again.
    // if (dataType === "number") {
    //     return (
    //         <InputNumber
    //             className="w-full"
    //             size="middle"
    //             value={typeof value === "number" ? value : Number(value)}
    //             onChange={(nextValue) => onChange(nextValue ?? 0)}
    //         />
    //     )
    // }
    //
    // if (dataType === "boolean") {
    //     return <Switch checked={Boolean(value)} onChange={onChange} size="small" />
    // }

    if (viewMode === "markdown") {
        return (
            <TextEditor
                editorId={editorId}
                value={value}
                displayValue={displayValue}
                markdown
                onChange={onChange}
                readOnly={!editable}
            />
        )
    }

    if (viewMode === "text") {
        return (
            <TextEditor
                editorId={editorId}
                value={value}
                displayValue={displayValue}
                onChange={onChange}
                readOnly={!editable}
            />
        )
    }

    // Fallback when viewMode is unset: schema-aware editor by dataType.
    if (dataType === "json-object" || dataType === "json-array") {
        return (
            <CodeEditor
                editorId={editorId}
                value={value}
                displayValue={displayValue}
                viewMode={viewMode}
                onChange={onChange}
                readOnly={!editable}
            />
        )
    }

    return (
        <TextEditor
            editorId={editorId}
            value={value}
            displayValue={displayValue}
            onChange={onChange}
            readOnly={!editable}
        />
    )
}
