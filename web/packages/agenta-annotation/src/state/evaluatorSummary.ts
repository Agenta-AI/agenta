import {resolveParameters} from "@agenta/entities/workflow"

/**
 * Reads an evaluator revision for display: the human metrics it asks for, its parameters, and a
 * label for its type. No UI library, so the antd views and the /m views show the same facts.
 */

export interface WorkflowRevisionLike {
    version?: number | null
    name?: string | null
    flags?: {is_feedback?: boolean} | null
    data?: Record<string, unknown> | null
}

/** A metric as the evaluator picker lists it. */
export interface HumanMetric {
    name: string
    type: string
}

/** A metric as the queue configuration lists it. */
export interface OutputMetric {
    name: string
    type: string
    required: boolean
    description?: string
}

export interface EvaluatorParameter {
    key: string
    label: string
    displayValue: string
    isMultiline: boolean
}

function getNestedValue(obj: unknown, ...keys: string[]): unknown {
    let current: unknown = obj
    for (const key of keys) {
        if (!current || typeof current !== "object") return undefined
        current = (current as Record<string, unknown>)[key]
    }
    return current
}

function getMetricType(definition: unknown): string {
    if (!definition || typeof definition !== "object") return "unknown"

    const node = definition as Record<string, unknown>
    const explicitType = node.type

    if (typeof explicitType === "string") {
        if (explicitType === "array") {
            const itemType = getMetricType(node.items)
            return itemType === "unknown" ? "array" : `array<${itemType}>`
        }
        return explicitType
    }

    if (Array.isArray(explicitType) && explicitType.every((item) => typeof item === "string")) {
        return explicitType.join(" | ")
    }

    if (Array.isArray(node.enum)) return "enum"
    if (Array.isArray(node.oneOf)) return "union"
    if (Array.isArray(node.anyOf)) return "union"
    if (Array.isArray(node.allOf)) return "composed"

    return "unknown"
}

function parseHumanMetrics(schema: unknown): HumanMetric[] {
    if (!schema || typeof schema !== "object") return []
    const properties = (schema as Record<string, unknown>).properties as
        | Record<string, unknown>
        | undefined
    if (!properties || typeof properties !== "object") return []

    return Object.entries(properties)
        .map(([name, definition]) => {
            if (!definition || typeof definition !== "object") return null
            return {name, type: getMetricType(definition)}
        })
        .filter(Boolean) as HumanMetric[]
}

/** The metrics of an evaluator revision: from the first output schema that lists any. */
export function getHumanMetrics(revision: WorkflowRevisionLike): HumanMetric[] {
    const data = revision.data
    const candidates = [
        getNestedValue(data, "schemas", "outputs"),
        getNestedValue(data, "service", "format", "properties", "outputs"),
        getNestedValue(data, "service", "configuration", "outputs"),
        getNestedValue(data, "configuration", "outputs"),
        getNestedValue(data, "service", "configuration", "format", "properties", "outputs"),
        getNestedValue(data, "configuration", "format", "properties", "outputs"),
    ]

    for (const candidate of candidates) {
        const metrics = parseHumanMetrics(candidate)
        if (metrics.length > 0) return metrics
    }

    return []
}

export function formatHumanMetricLabel(metric: HumanMetric): string {
    return `${metric.name}: ${metric.type}`
}

/** Metrics from a JSON Schema (`data.schemas.outputs`), with their required flag and description. */
export function parseOutputMetrics(schema: unknown): OutputMetric[] {
    if (!schema || typeof schema !== "object") return []
    const node = schema as Record<string, unknown>
    const properties = node.properties as Record<string, unknown> | undefined
    if (!properties || typeof properties !== "object") return []

    const requiredList = Array.isArray(node.required)
        ? (node.required as unknown[]).map(String)
        : []

    return Object.entries(properties)
        .map(([name, definition]) => {
            if (!definition || typeof definition !== "object") return null
            const def = definition as Record<string, unknown>
            let type = "unknown"
            if (typeof def.type === "string") type = def.type
            else if (Array.isArray(def.type))
                type = (def.type as string[]).filter(Boolean).join(" | ")
            else if (Array.isArray(def.enum))
                type = `enum(${(def.enum as unknown[]).map(String).join(", ")})`

            const description =
                typeof def.description === "string" ? def.description.trim() : undefined

            return {name, type, required: requiredList.includes(name), description}
        })
        .filter(Boolean) as OutputMetric[]
}

/** Turns a parameter key (snake_case or camelCase) into a Title Case label. */
function formatParameterLabel(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) return "Parameter"
    const withSpaces = trimmed
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    if (!withSpaces) return "Parameter"
    return withSpaces
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}

function stringifyParameterValue(value: unknown): string {
    if (value == null) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

/** Keys that hold prompts or config blobs, hidden from the parameter list. */
const PARAMETER_KEYS_TO_HIDE = new Set([
    "messages",
    "prompt_template",
    "ag_config",
    "agconfig",
    "agConfig",
])

/** The parameters of an evaluator worth showing: no prompts, no empty values. */
export function extractEvaluatorParameters(
    data: Record<string, unknown> | null | undefined,
): EvaluatorParameter[] {
    const parameters = resolveParameters(data)
    if (!parameters) return []

    return Object.entries(parameters)
        .filter(([key, value]) => {
            if (value === null || value === undefined) return false
            return (
                !PARAMETER_KEYS_TO_HIDE.has(key) && !PARAMETER_KEYS_TO_HIDE.has(key.toLowerCase())
            )
        })
        .map(([key, value]) => {
            const displayValue = stringifyParameterValue(value)
            return {
                key,
                label: formatParameterLabel(key),
                displayValue,
                isMultiline: displayValue.includes("\n"),
            }
        })
        .filter((entry) => entry.displayValue.trim().length > 0)
}

/** A label for the evaluator type in its URI: "agenta:builtin:auto_exact_match:v0" gives "Exact Match". */
export function deriveEvaluatorTypeLabel(uri: string | null | undefined): string | null {
    if (!uri) return null
    const parts = uri.split(":")
    const key = parts.length >= 3 ? parts[2] : null
    if (!key) return null
    const withoutPrefix = key.startsWith("auto_") ? key.slice(5) : key
    return withoutPrefix
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}
