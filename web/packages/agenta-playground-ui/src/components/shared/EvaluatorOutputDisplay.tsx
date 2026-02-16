/**
 * EvaluatorOutputDisplay
 *
 * Schema-driven renderer for evaluator output values.
 * Reads the evaluator's output schema from the runnable bridge and renders
 * each property using SchemaPropertyRenderer (the same controls used for
 * config editing) in read-only/disabled mode.
 *
 * Falls back to a simple JSON display when no schema is available.
 */

import {useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {runnableBridge} from "@agenta/entities/runnable"
import {SchemaPropertyRenderer} from "@agenta/entity-ui"
import {useAtomValue} from "jotai"

/** Convert snake_case/camelCase key to human-readable label */
function formatLabel(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase())
}

// ============================================================================
// PROPS
// ============================================================================

export interface EvaluatorOutputDisplayProps {
    /** The entity ID of the downstream node (evaluator revision) */
    entityId: string
    /** The entity type (e.g. "evaluatorRevision") */
    entityType: string
    /** The extracted output data (e.g. {score: 10, reasoning: "..."}) */
    data: Record<string, unknown>
    /** Node display name (omit when parent wrapper already shows the label) */
    nodeName?: string
    /** Compact mode for inline display (smaller text, tighter spacing) */
    compact?: boolean
}

// ============================================================================
// COMPONENT
// ============================================================================

export function EvaluatorOutputDisplay({
    entityId,
    entityType,
    data,
    nodeName,
    compact = false,
}: EvaluatorOutputDisplayProps) {
    const schemas = useAtomValue(
        useMemo(() => {
            const scoped = runnableBridge.forType(entityType)
            return scoped.schemas(entityId)
        }, [entityId, entityType]),
    ) as {
        outputSchema?: SchemaProperty
    } | null

    const outputSchema = schemas?.outputSchema as SchemaProperty | undefined
    const properties = outputSchema?.properties

    // Determine ordered property keys from schema (respects schema order)
    const propertyKeys = useMemo(() => {
        if (!properties) return Object.keys(data)
        // Use schema property order, then append any extra keys from data
        const schemaKeys = Object.keys(properties)
        const dataKeys = Object.keys(data)
        const extra = dataKeys.filter((k) => !schemaKeys.includes(k))
        return [...schemaKeys, ...extra]
    }, [properties, data])

    if (propertyKeys.length === 0) return null

    return (
        <div className={compact ? "flex flex-col gap-1" : "flex flex-col gap-3"}>
            {/* Node name header (hidden when parent wrapper already shows the label) */}
            {nodeName ? (
                <span
                    className={
                        compact
                            ? "text-xs font-medium text-[var(--ant-color-text-tertiary)]"
                            : "text-sm font-medium text-[var(--ant-color-text)]"
                    }
                >
                    {nodeName}
                </span>
            ) : null}

            {/* Schema-driven fields */}
            {propertyKeys.map((key) => {
                const value = data[key]
                const fieldSchema = properties?.[key] as SchemaProperty | undefined

                if (value === undefined || value === null) return null

                return (
                    <EvaluatorField
                        key={key}
                        fieldKey={key}
                        value={value}
                        schema={fieldSchema}
                        compact={compact}
                    />
                )
            })}
        </div>
    )
}

// ============================================================================
// INDIVIDUAL FIELD
// ============================================================================

function EvaluatorField({
    fieldKey,
    value,
    schema,
    compact,
}: {
    fieldKey: string
    value: unknown
    schema: SchemaProperty | undefined
    compact: boolean
}) {
    const label = schema?.title || formatLabel(fieldKey)

    // For number fields with schema, use SchemaPropertyRenderer for rich display
    if (schema) {
        return (
            <SchemaPropertyRenderer
                schema={schema}
                label={label}
                value={value}
                onChange={() => {}}
                disabled
                withTooltip={!compact}
                className={compact ? "[&_.ant-typography]:!text-xs" : ""}
            />
        )
    }

    // Fallback: render as plain text
    const displayValue = typeof value === "string" ? value : JSON.stringify(value, null, 2)
    return (
        <div className="flex flex-col gap-0.5">
            <span
                className={
                    compact
                        ? "text-[10px] font-medium text-[var(--ant-color-text-tertiary)]"
                        : "text-xs font-medium text-[var(--ant-color-text-secondary)]"
                }
            >
                {label}
            </span>
            <span
                className={
                    compact
                        ? "text-xs text-[var(--ant-color-text-secondary)] leading-relaxed"
                        : "text-sm text-[var(--ant-color-text)] leading-relaxed"
                }
            >
                {displayValue}
            </span>
        </div>
    )
}

export default EvaluatorOutputDisplay
