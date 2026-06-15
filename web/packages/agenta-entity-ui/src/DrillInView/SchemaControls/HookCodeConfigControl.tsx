/**
 * HookCodeConfigControl
 *
 * Dedicated controls for the fixed code/hook workflow data fields. These fields
 * (url, headers, script, runtime) are not schema-driven, so they render directly
 * with purpose-built controls instead of going through SchemaPropertyRenderer.
 */

import {memo, useCallback, useMemo, useState} from "react"

import {CollapseToggleButton} from "@agenta/ui/components/presentational"
import {LabeledField} from "@agenta/ui/components/presentational"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {CopySimple, Plus, Trash} from "@phosphor-icons/react"
import {Button, Input, Tooltip, Typography} from "antd"
import clsx from "clsx"

type EditorLanguage = "python" | "javascript" | "typescript"

// Map the runtime selection to an editor language (1:1 today; map shields
// against runtime values that don't match an editor language).
const RUNTIME_TO_LANGUAGE: Record<string, EditorLanguage> = {
    python: "python",
    javascript: "javascript",
    typescript: "typescript",
}

function runtimeToLanguage(runtime: string | undefined): EditorLanguage {
    return (runtime && RUNTIME_TO_LANGUAGE[runtime]) || "python"
}

type HeadersValue = Record<string, unknown>

interface HeadersControlProps {
    value: HeadersValue
    onChange: (next: HeadersValue) => void
    disabled?: boolean
}

/** Key/value rows for hook headers, with an Add row. */
const HeadersControl = memo(function HeadersControl({
    value,
    onChange,
    disabled,
}: HeadersControlProps) {
    const rows = useMemo(() => Object.entries(value ?? {}), [value])

    const setRow = useCallback(
        (index: number, key: string, val: string) => {
            const next: HeadersValue = {}
            rows.forEach(([k, v], i) => {
                if (i === index) next[key] = val
                else next[k] = v
            })
            onChange(next)
        },
        [rows, onChange],
    )

    const removeRow = useCallback(
        (index: number) => {
            const next: HeadersValue = {}
            rows.forEach(([k, v], i) => {
                if (i !== index) next[k] = v
            })
            onChange(next)
        },
        [rows, onChange],
    )

    const addRow = useCallback(() => {
        onChange({...value, "": ""})
    }, [value, onChange])

    return (
        <LabeledField label="Headers" direction="vertical">
            <div className="flex flex-col gap-2">
                {rows.map(([key, val], index) => (
                    <div key={index} className="flex items-center gap-2">
                        <Input
                            placeholder="Key"
                            className="basis-1/3 font-mono"
                            value={key}
                            disabled={disabled}
                            onChange={(e) => setRow(index, e.target.value, String(val ?? ""))}
                        />
                        <Input
                            placeholder="Value"
                            className="basis-2/3 font-mono"
                            value={String(val ?? "")}
                            disabled={disabled}
                            onChange={(e) => setRow(index, key, e.target.value)}
                        />
                        <Button
                            type="text"
                            size="small"
                            icon={<Trash size={14} />}
                            disabled={disabled}
                            onClick={() => removeRow(index)}
                        />
                    </div>
                ))}
                <Button
                    variant="outlined"
                    color="default"
                    size="small"
                    icon={<Plus size={14} />}
                    disabled={disabled}
                    onClick={addRow}
                    className="self-start"
                >
                    Header
                </Button>
            </div>
        </LabeledField>
    )
})

interface ScriptEditorProps {
    value: string
    language: EditorLanguage
    onChange: (val: string) => void
    disabled?: boolean
}

/** Script editor with the tool-card chrome: line numbers, copy + collapse. */
const ScriptEditor = memo(function ScriptEditor({
    value,
    language,
    onChange,
    disabled,
}: ScriptEditorProps) {
    const [minimized, setMinimized] = useState(false)

    const header = (
        <div className="w-full flex items-start justify-between py-1">
            <Typography.Text strong className="text-sm pl-2">
                Script
            </Typography.Text>
            <div className="flex items-center gap-1 shrink-0">
                <Tooltip title="Copy">
                    <Button
                        icon={<CopySimple size={14} />}
                        type="text"
                        size="small"
                        className="invisible group-hover/script:visible"
                        onClick={() => navigator.clipboard.writeText(value)}
                    />
                </Tooltip>
                <CollapseToggleButton
                    collapsed={minimized}
                    onToggle={() => setMinimized((v) => !v)}
                    className="!transition-opacity !duration-0 !delay-200 group-hover/script:!delay-0 opacity-50 group-hover/script:opacity-100"
                />
            </div>
        </div>
    )

    return (
        <div className="group/script flex flex-col w-full max-w-full">
            <SharedEditor
                editorType="border"
                initialValue={value}
                handleChange={onChange}
                disabled={disabled}
                editorProps={{codeOnly: true, language, showLineNumbers: true, noProvider: true}}
                noProvider
                syncWithInitialValueChanges
                className={clsx(
                    "group/script",
                    "!pt-[11px] !pb-[11px] [&_.agenta-editor-wrapper]:!mb-0 [&_.editor-code]:!pb-0",
                    "[&_.agenta-editor-wrapper]:!pl-[20px]",
                    minimized && "[&_.agenta-editor-wrapper]:!hidden",
                )}
                state={disabled ? "readOnly" : "filled"}
                header={header}
            />
        </div>
    )
})

export interface HookCodeConfigControlProps {
    /** Which group to render. */
    kind: "hook" | "code"
    /** Current group value, e.g. {url, headers} or {script, runtime}. */
    value: Record<string, unknown> | null | undefined
    /** Emits the full updated group object. */
    onChange: (value: Record<string, unknown>) => void
    disabled?: boolean
    className?: string
}

/** Renders the Hook (url + headers) or Code (script + runtime) section body. */
export const HookCodeConfigControl = memo(function HookCodeConfigControl({
    kind,
    value,
    onChange,
    disabled = false,
    className,
}: HookCodeConfigControlProps) {
    const group = (value ?? {}) as Record<string, unknown>

    const patch = useCallback(
        (field: string, fieldValue: unknown) => {
            onChange({...group, [field]: fieldValue})
        },
        [group, onChange],
    )

    if (kind === "hook") {
        return (
            <div className={clsx("flex flex-col gap-4", className)}>
                <LabeledField label="URL" direction="vertical">
                    <Input
                        placeholder="https://your-service/invoke"
                        className="font-mono"
                        value={(group.url as string) ?? ""}
                        disabled={disabled}
                        onChange={(e) => patch("url", e.target.value)}
                    />
                </LabeledField>
                <HeadersControl
                    value={(group.headers as HeadersValue) ?? {}}
                    onChange={(next) => patch("headers", next)}
                    disabled={disabled}
                />
            </div>
        )
    }

    const language = runtimeToLanguage(group.runtime as string | undefined)

    return (
        <div className={clsx("flex flex-col gap-4", className)}>
            <EditorProvider
                codeOnly
                language={language}
                showToolbar={false}
                enableTokens={false}
                id={`workflow-script-${language}`}
            >
                <ScriptEditor
                    value={(group.script as string) ?? ""}
                    language={language}
                    onChange={(val) => patch("script", val)}
                    disabled={disabled}
                />
            </EditorProvider>
        </div>
    )
})
