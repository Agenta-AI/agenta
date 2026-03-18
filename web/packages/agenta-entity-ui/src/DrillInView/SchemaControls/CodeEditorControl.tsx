/**
 * CodeEditorControl
 *
 * Schema-driven code editor for string values with x-parameters: {code: true}.
 * Uses SharedEditor in codeOnly mode with syntax highlighting.
 */

import {memo, useCallback, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {LabeledField} from "@agenta/ui/components/presentational"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"

export interface CodeEditorControlProps {
    /** The schema property defining constraints */
    schema?: SchemaProperty | null
    /** Display label for the control */
    label?: string
    /** Current value */
    value: string | null | undefined
    /** Change handler */
    onChange: (value: string) => void
    /** Optional description for tooltip */
    description?: string
    /** Whether to show tooltip */
    withTooltip?: boolean
    /** Disable the control */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
}

/**
 * A controlled code editor component for string properties with code hint.
 *
 * Renders a SharedEditor in codeOnly mode with syntax highlighting.
 * Language is detected from the schema or defaults to "python".
 */
export const CodeEditorControl = memo(function CodeEditorControl({
    schema,
    label,
    value,
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    className,
}: CodeEditorControlProps) {
    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    // Detect language from schema hints or default to python
    const language = useMemo(() => {
        const xParams = schema?.["x-parameters"] as Record<string, unknown> | undefined
        return (xParams?.language as string) ?? "python"
    }, [schema])

    const handleChange = useCallback(
        (val: string) => {
            onChange(val)
        },
        [onChange],
    )

    return (
        <LabeledField
            label={label}
            description={tooltipText}
            withTooltip={withTooltip && !!label}
            direction="vertical"
            className={className}
        >
            <EditorProvider>
                <SharedEditor
                    editorType="border"
                    initialValue={value ?? ""}
                    handleChange={handleChange}
                    disabled={disabled}
                    editorProps={{
                        codeOnly: true,
                        language: language as
                            | "code"
                            | "json"
                            | "yaml"
                            | "python"
                            | "javascript"
                            | "typescript"
                            | undefined,
                    }}
                    editorClassName="min-h-[200px]"
                    syncWithInitialValueChanges
                />
            </EditorProvider>
        </LabeledField>
    )
})
