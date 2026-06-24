/**
 * Schema-extraction helpers (pure functions, no React, no atoms).
 *
 * Relocated faithfully from `@agenta/annotation`'s form controller — logic
 * unchanged, only imports and the kind-agnostic field type adjusted.
 */

import type {Annotation} from "@agenta/entities/annotation"
import {resolveOutputSchema, type Workflow} from "@agenta/entities/workflow"

import type {MetricField} from "./types"

// ============================================================================
// SCHEMA EXTRACTION HELPERS (pure functions, no React)
// ============================================================================

const USEABLE_METRIC_TYPES = ["number", "integer", "float", "boolean", "string", "array"]

/**
 * Extract the outputs schema from an evaluator entity.
 */
export function getOutputsSchema(evaluator: Workflow): {
    properties?: Record<string, unknown>
    required?: string[]
} {
    return (
        (resolveOutputSchema(evaluator.data) as {
            properties?: Record<string, unknown>
            required?: string[]
        } | null) ?? {}
    )
}

/**
 * Derive empty form fields from an evaluator's output schema.
 */
export function getMetricFieldsFromEvaluator(evaluator: Workflow): Record<string, MetricField> {
    const schema = getOutputsSchema(evaluator)?.properties ?? {}
    const fields: Record<string, MetricField> = {}

    for (const [key, rawProp] of Object.entries(schema)) {
        if (!rawProp || typeof rawProp !== "object") continue

        const prop = (rawProp as Record<string, unknown>).anyOf
            ? ((rawProp as Record<string, unknown>).anyOf as unknown[])[0]
            : rawProp
        const propObj = prop as Record<string, unknown>
        const rawType = propObj?.type as string | string[] | undefined

        if (!rawType) continue

        if (Array.isArray(rawType)) {
            const enumValues =
                (propObj.enum as unknown[] | undefined)?.filter(
                    (value) => value !== null && value !== undefined && value !== "",
                ) || []
            const filteredTypes = rawType.filter((value) => value !== "null")
            if (filteredTypes.length === 0) continue
            const baseType = filteredTypes[0]
            fields[key] = {
                value: baseType === "string" ? "" : null,
                type: filteredTypes,
                enum: enumValues,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
            continue
        }

        const type = rawType

        if (type === "array") {
            const items = propObj.items as Record<string, unknown> | undefined
            fields[key] = {
                value: [],
                type: "array",
                items: {
                    type: (typeof items?.type === "string" ? items.type : "string") as string,
                    enum: (items?.enum as string[] | undefined) ?? [],
                },
            }
        } else if (USEABLE_METRIC_TYPES.includes(type)) {
            fields[key] = {
                value: type === "string" ? "" : null,
                type,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
        }
    }

    return fields
}

/**
 * Derive form fields from an existing annotation, filling values from outputs.
 */
export function getMetricsFromAnnotation(
    annotation: Annotation,
    evaluator: Workflow,
): Record<string, MetricField> {
    const schema = getOutputsSchema(evaluator)?.properties ?? {}
    const rawOutputs = (annotation.data?.outputs as Record<string, unknown>) ?? {}

    // Flatten nested structures
    const outputs: Record<string, unknown> = {}
    if (rawOutputs.metrics && typeof rawOutputs.metrics === "object") {
        Object.assign(outputs, rawOutputs.metrics)
    }
    if (rawOutputs.notes && typeof rawOutputs.notes === "object") {
        Object.assign(outputs, rawOutputs.notes)
    }
    if (rawOutputs.extra && typeof rawOutputs.extra === "object") {
        Object.assign(outputs, rawOutputs.extra)
    }
    for (const [k, v] of Object.entries(rawOutputs)) {
        if (k !== "metrics" && k !== "notes" && k !== "extra") {
            outputs[k] = v
        }
    }

    if (!Object.keys(schema).length) {
        return inferFieldsFromOutputs(outputs)
    }

    const fields: Record<string, MetricField> = {}

    for (const [key, rawProp] of Object.entries(schema)) {
        if (!rawProp || typeof rawProp !== "object") continue

        const prop = (rawProp as Record<string, unknown>).anyOf
            ? ((rawProp as Record<string, unknown>).anyOf as unknown[])[0]
            : rawProp
        const propObj = prop as Record<string, unknown>
        const rawType = propObj?.type as string | string[] | undefined

        if (!rawType) continue

        const hasValue = key in outputs
        const value = hasValue ? outputs[key] : undefined

        if (Array.isArray(rawType)) {
            const enumValues =
                (propObj.enum as unknown[] | undefined)?.filter(
                    (item) => item !== null && item !== undefined && item !== "",
                ) || []
            const filteredTypes = rawType.filter((item) => item !== "null")
            if (filteredTypes.length === 0) continue
            const baseType = filteredTypes[0]
            const defaultValue = baseType === "string" ? "" : null
            fields[key] = {
                value: hasValue ? value : defaultValue,
                type: filteredTypes,
                enum: enumValues,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
            continue
        }

        const type = rawType

        if (type === "array") {
            const items = propObj.items as Record<string, unknown> | undefined
            fields[key] = {
                value: value ?? [],
                type: "array",
                items: {
                    type: (typeof items?.type === "string" ? items.type : "string") as string,
                    enum: (items?.enum as string[] | undefined) ?? [],
                },
            }
        } else if (USEABLE_METRIC_TYPES.includes(type)) {
            const defaultValue = type === "string" ? "" : null
            fields[key] = {
                value: hasValue ? value : defaultValue,
                type,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
        }
    }

    return fields
}

function inferFieldType(value: unknown): MetricField | null {
    if (value === null || value === undefined) {
        return {value: null, type: "string"}
    }
    if (typeof value === "boolean") {
        return {value, type: "boolean"}
    }
    if (typeof value === "number") {
        return {value, type: Number.isInteger(value) ? "integer" : "number"}
    }
    if (typeof value === "string") {
        return {value, type: "string"}
    }
    if (Array.isArray(value)) {
        const sample = value.find((entry) => entry !== null && entry !== undefined)
        const itemType =
            typeof sample === "boolean"
                ? "boolean"
                : typeof sample === "number"
                  ? Number.isInteger(sample)
                      ? "integer"
                      : "number"
                  : "string"
        return {
            value,
            type: "array",
            items: {type: itemType, enum: []},
        }
    }
    if (typeof value === "object") {
        return {value: JSON.stringify(value), type: "string"}
    }
    return null
}

function inferFieldsFromOutputs(outputs: Record<string, unknown>) {
    const fields: Record<string, MetricField> = {}
    for (const [key, value] of Object.entries(outputs)) {
        const field = inferFieldType(value)
        if (!field) continue
        fields[key] = field
    }
    return fields
}

export {USEABLE_METRIC_TYPES}
