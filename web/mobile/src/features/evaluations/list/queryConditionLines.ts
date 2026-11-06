import type {StoredQueryCondition} from "@agenta/entities/evaluationRun"
import {
    fieldConfigByOptionKey,
    getOperator,
    inferReferenceOptionKey,
    type FieldConfig,
} from "@agenta/observability/filters"

/** One condition of a stored query as the old query preview prints it. */
export interface QueryConditionLine {
    field: string
    operator: string
    value: string
}

const NO_VALUE = "—"

const formatValue = (value: unknown): string => {
    if (Array.isArray(value)) {
        const parts = value.map(formatValue).filter((part) => part && part !== NO_VALUE)
        return parts.length ? parts.join(", ") : NO_VALUE
    }
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>
        if (record.label) return String(record.label)
        if (record.value) return String(record.value)
        const entries = Object.entries(record)
            .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
            .map(([key, entry]) => `${key}: ${formatValue(entry)}`)
        return entries.length ? entries.join(", ") : NO_VALUE
    }
    if (value === undefined || value === null || value === "") return NO_VALUE
    return String(value)
}

let fieldConfigs: Map<string, FieldConfig> | null = null
const fieldConfigFor = (field: string, key: string | undefined) => {
    fieldConfigs ??= fieldConfigByOptionKey()
    return fieldConfigs.get(field) ?? (key ? fieldConfigs.get(key) : undefined)
}

const operatorLabel = (operator: string, config: FieldConfig | undefined) => {
    const option = config?.operatorOptions?.find((entry) => entry.value === operator)
    if (option) return option.label
    const known = getOperator(operator as Parameters<typeof getOperator>[0])
    return known?.label ?? operator
}

/**
 * The conditions of a stored query as "field operator value" lines, with the labels of the trace
 * filter ("Trace Type is invocation"), copied from the old app's `FiltersPreview`.
 */
export const queryConditionLines = (
    conditions: readonly StoredQueryCondition[],
): QueryConditionLine[] =>
    conditions.map((condition) => {
        const key =
            condition.field === "references"
                ? inferReferenceOptionKey(
                      condition.value as Parameters<typeof inferReferenceOptionKey>[0],
                      condition.key,
                  )
                : condition.key
        const config = fieldConfigFor(condition.field, key)
        let display = condition.value
        if (config?.toUI) {
            try {
                display = config.toUI(condition.value)
            } catch {
                display = condition.value
            }
        }
        return {
            field: config?.label ?? key ?? condition.field ?? "-",
            operator: operatorLabel(condition.operator, config),
            value: formatValue(display),
        }
    })
