/** Renders the code workflow script editor (runtime picker lives in the section header). */

import {memo, useCallback, useState} from "react"

import {CollapseToggleButton} from "@agenta/ui/components/presentational"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {CopySimple} from "@phosphor-icons/react"
import {Button, Tooltip, Typography} from "antd"
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

export interface CodeConfigControlProps {
    /** Current code group value: {script, runtime}. */
    value: Record<string, unknown> | null | undefined
    /** Emits the full updated group object. */
    onChange: (value: Record<string, unknown>) => void
    disabled?: boolean
    className?: string
}

/** Renders the Code (script + runtime) section body. */
export const CodeConfigControl = memo(function CodeConfigControl({
    value,
    onChange,
    disabled = false,
    className,
}: CodeConfigControlProps) {
    const group = (value ?? {}) as Record<string, unknown>

    const patch = useCallback(
        (field: string, fieldValue: unknown) => {
            onChange({...group, [field]: fieldValue})
        },
        [group, onChange],
    )

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
