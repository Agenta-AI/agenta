/**
 * RunnableOutputValue
 *
 * Schema-aware renderer for a single runnable output field value.
 * Uses the output schema (from runnable bridge) to determine rendering:
 * - boolean → colored Tag
 * - number/integer → formatted number
 * - string → plain text
 * - object/array → JSON stringified
 *
 * Entity-agnostic: accepts value + optional schema, no atom reads.
 * Can be used anywhere evaluator/runnable output values need display.
 */

import {memo} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {Tag} from "antd"
import clsx from "clsx"

import {resolveAnyOfSchema} from "../DrillInView/SchemaControls/schemaUtils"

// ============================================================================
// VALUE FORMATTING
// ============================================================================

/**
 * Resolve the effective type of a schema property.
 * Handles anyOf/oneOf nullable wrappers.
 */
function resolveSchemaType(schema?: SchemaProperty | null): string | undefined {
    if (!schema) return undefined
    const resolved = resolveAnyOfSchema(schema)
    return (resolved?.type as string) ?? undefined
}

/**
 * Format a number for display.
 * Rounds to a reasonable number of decimal places.
 */
function formatDisplayNumber(value: number): string {
    if (Number.isInteger(value)) return String(value)
    // Up to 4 significant decimal places
    return Number(value.toPrecision(6)).toString()
}

/**
 * Format a raw output value to a display string.
 * Schema-aware: uses schema type when available, falls back to typeof inference.
 */
export function formatOutputValue(value: unknown, schema?: SchemaProperty | null): string {
    if (value === null || value === undefined) return "—"

    const schemaType = resolveSchemaType(schema)
    const effectiveType = schemaType ?? typeof value

    switch (effectiveType) {
        case "boolean":
            return String(value)
        case "number":
        case "integer":
            return typeof value === "number" ? formatDisplayNumber(value) : String(value)
        case "string":
            return typeof value === "string" ? value : String(value)
        default:
            if (typeof value === "object") {
                try {
                    return JSON.stringify(value)
                } catch {
                    return String(value)
                }
            }
            return String(value)
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface RunnableOutputValueProps {
    /** The output value to display */
    value: unknown
    /** Optional JSON Schema for the field (used for type-driven rendering) */
    schema?: SchemaProperty | null
    /** Additional CSS classes */
    className?: string
}

/**
 * Renders a single runnable output value with schema-aware formatting.
 *
 * - Booleans render as colored Tags (green for true, default for false)
 * - Numbers render as formatted text
 * - Strings render as plain text
 * - Objects/arrays render as JSON strings
 */
const RunnableOutputValue = memo(function RunnableOutputValue({
    value,
    schema,
    className,
}: RunnableOutputValueProps) {
    if (value === null || value === undefined) {
        return <span className={clsx("text-[var(--ant-color-text-quaternary)]", className)}>—</span>
    }

    const schemaType = resolveSchemaType(schema)
    const effectiveType = schemaType ?? typeof value

    // Boolean → colored Tag
    if (effectiveType === "boolean" || typeof value === "boolean") {
        const boolVal = typeof value === "boolean" ? value : value === "true"
        return (
            <Tag color={boolVal ? "green" : "default"} className={clsx("!m-0 text-xs", className)}>
                {String(value)}
            </Tag>
        )
    }

    // Number → formatted, with optional range from schema min/max
    if (effectiveType === "number" || effectiveType === "integer" || typeof value === "number") {
        const display = typeof value === "number" ? formatDisplayNumber(value) : String(value)
        const resolved = schema ? resolveAnyOfSchema(schema) : null
        const hasRange =
            resolved && typeof resolved.maximum === "number" && typeof resolved.minimum === "number"

        if (hasRange) {
            return (
                <span className={className}>
                    {display}
                    <span className="text-[var(--ant-color-text-quaternary)] ml-1">
                        / {formatDisplayNumber(resolved.maximum as number)}
                    </span>
                </span>
            )
        }
        return <span className={className}>{display}</span>
    }

    // String → plain text
    if (typeof value === "string") {
        return <span className={className}>{value}</span>
    }

    // Object/array → JSON
    const jsonStr = (() => {
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    })()

    return <span className={className}>{jsonStr}</span>
})

export default RunnableOutputValue
