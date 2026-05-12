/**
 * CodeEditorControl
 *
 * Schema-driven code editor for string values with x-parameters: {code: true}.
 * Uses SharedEditor in codeOnly mode with syntax highlighting.
 *
 * Language detection (priority order):
 *   1. `schema["x-parameters"].language` — explicit language override
 *   2. `schema["x-parameters"].languageFromField` — sibling field name; the
 *      drill-in `rootData[fieldName]` value is used as the language
 *   3. Heuristic: if `rootData.runtime` is one of {python, javascript,
 *      typescript}, use that (covers the evaluator code-runtime pattern
 *      without needing a schema annotation)
 *   4. Fallback to "python"
 */

import {memo, useCallback, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {LabeledField} from "@agenta/ui/components/presentational"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"

import {useOptionalDrillIn} from "../components/MoleculeDrillInContext"

const SUPPORTED_LANGUAGES = new Set(["code", "json", "yaml", "python", "javascript", "typescript"])

function isSupportedLanguage(value: string): boolean {
    return SUPPORTED_LANGUAGES.has(value)
}

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

    const drillIn = useOptionalDrillIn<{parameters?: Record<string, unknown>} | null>()
    // The drill-in adapter exposes `rootData` already unwrapped to parameters
    // (see PlaygroundConfigSection's `getRootData`), so it's a flat record of
    // the entity's config fields keyed by name.
    const rootData = (drillIn?.rootData as Record<string, unknown> | null | undefined) ?? null

    // Detect language: explicit schema hint → schema-named sibling field →
    // heuristic on `runtime` sibling → "python" fallback.
    const language = useMemo(() => {
        const xParams = schema?.["x-parameters"] as Record<string, unknown> | undefined
        // Normalize + validate the explicit hint so a typo or unexpected
        // casing falls through to the heuristic / "python" fallback rather
        // than being passed straight to the editor with undefined behavior.
        const explicit =
            typeof xParams?.language === "string" ? xParams.language.toLowerCase() : undefined
        if (explicit && isSupportedLanguage(explicit)) return explicit

        const fromFieldName = xParams?.languageFromField as string | undefined
        if (fromFieldName && rootData && typeof rootData[fromFieldName] === "string") {
            const candidate = (rootData[fromFieldName] as string).toLowerCase()
            if (isSupportedLanguage(candidate)) return candidate
        }

        // Heuristic: evaluator code fields ship alongside a `runtime` choice
        // field whose value matches a supported language enum. Use it when
        // present so syntax highlighting tracks the runtime selection.
        const runtime = rootData?.runtime
        if (typeof runtime === "string") {
            const candidate = runtime.toLowerCase()
            if (isSupportedLanguage(candidate)) return candidate
        }

        return "python"
    }, [schema, rootData])

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
