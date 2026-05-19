import {useMemo} from "react"

import {JsonEditorWithLocalState, type CoreFieldRendererProps} from "@agenta/ui/drill-in"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {InputNumber, Switch} from "antd"
import {dump as dumpYaml, load as loadYaml} from "js-yaml"

function toDisplayString(value: unknown, viewMode?: string): string {
    if (viewMode === "yaml") return dumpYaml(value)
    if (viewMode === "json") return JSON.stringify(value, null, 2) ?? ""
    if (typeof value === "string") return value
    return JSON.stringify(value, null, 2) ?? ""
}

function parseCodeEditorValue(value: string, fallback: unknown, viewMode?: string): unknown {
    try {
        return viewMode === "yaml" ? loadYaml(value) : JSON.parse(value)
    } catch {
        return fallback
    }
}

function CodeEditor({
    editorId,
    value,
    displayValue,
    viewMode,
    onChange,
}: {
    editorId: string
    value: unknown
    displayValue: string
    viewMode?: string
    onChange: (value: unknown) => void
}) {
    if (viewMode !== "yaml") {
        return (
            <JsonEditorWithLocalState
                editorKey={editorId}
                initialValue={displayValue}
                onValidChange={(nextValue) => onChange(parseCodeEditorValue(nextValue, value))}
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
                handleChange={(nextValue) =>
                    onChange(parseCodeEditorValue(nextValue, value, viewMode))
                }
                editorType="border"
                className="min-h-[60px] overflow-hidden"
                disableDebounce
                noProvider
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

function TextEditor({
    editorId,
    value,
    displayValue,
    markdown,
    onChange,
}: {
    editorId: string
    value: unknown
    displayValue: string
    markdown?: boolean
    onChange: (value: unknown) => void
}) {
    /**
     * Coerce string edits back to the original primitive type where possible
     * (boolean / number). Object and array originals become strings on edit —
     * a deliberate one-way switch when the user picks text mode.
     */
    const handleChange = (next: string) => {
        if (typeof value === "boolean") {
            if (next === "true") return onChange(true)
            if (next === "false") return onChange(false)
            return onChange(next)
        }
        if (typeof value === "number") {
            const n = Number(next)
            if (!Number.isNaN(n) && next.trim() !== "") return onChange(n)
            return onChange(next)
        }
        onChange(next)
    }

    return (
        <EditorProvider
            key={`${editorId}-provider`}
            id={editorId}
            initialValue={displayValue}
            showToolbar={false}
            enableTokens
        >
            <SharedEditor
                id={editorId}
                initialValue={displayValue}
                value={displayValue}
                handleChange={handleChange}
                editorType="border"
                className="overflow-hidden"
                disableDebounce
                noProvider
                editorProps={
                    markdown
                        ? {
                              showMarkdownToggleButton: true,
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

    if (!editable || isRawMode) {
        return (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 p-3 bg-gray-50 rounded-md max-h-[200px] overflow-auto">
                {displayValue}
            </pre>
        )
    }

    // View mode takes precedence over data-type inference. This is how the
    // V2 design lets a user view an object as Text, an array as YAML, etc.
    if (viewMode === "json" || viewMode === "yaml") {
        return (
            <CodeEditor
                editorId={editorId}
                value={value}
                displayValue={displayValue}
                viewMode={viewMode}
                onChange={onChange}
            />
        )
    }

    if (viewMode === "markdown") {
        return (
            <TextEditor
                editorId={editorId}
                value={value}
                displayValue={displayValue}
                markdown
                onChange={onChange}
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
            />
        )
    }

    // Fallback when viewMode is unset: schema-aware editor by dataType.
    if (dataType === "json-object" || dataType === "json-array" || dataType === "messages") {
        return (
            <CodeEditor
                editorId={editorId}
                value={value}
                displayValue={displayValue}
                viewMode={viewMode}
                onChange={onChange}
            />
        )
    }

    if (dataType === "number") {
        return (
            <InputNumber
                className="w-full"
                size="middle"
                value={typeof value === "number" ? value : Number(value)}
                onChange={(nextValue) => onChange(nextValue ?? 0)}
            />
        )
    }

    if (dataType === "boolean") {
        return <Switch checked={Boolean(value)} onChange={onChange} size="small" />
    }

    return (
        <TextEditor
            editorId={editorId}
            value={value}
            displayValue={displayValue}
            onChange={onChange}
        />
    )
}
