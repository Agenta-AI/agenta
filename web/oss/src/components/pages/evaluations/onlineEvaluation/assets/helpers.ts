import {inferReferenceOptionKey} from "@/oss/components/pages/observability/assets/filters/referenceUtils"
import type {Filter, FilterConditions} from "@/oss/lib/Types"
import type {
    QueryConditionPayload,
    QueryFilteringPayload,
    QueryRevisionDataPayload,
} from "@/oss/services/onlineEvaluations/api"

const slugify = (value: string) =>
    value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

export const buildQuerySlug = (name?: string) => {
    const normalized = slugify(name ?? "") || "online-evaluation"
    return normalized
}

export const buildEvaluationSlug = (name?: string) => (name ? slugify(name) : "")

export const toFilteringPayload = (filters: Filter[]): QueryFilteringPayload | undefined => {
    if (!filters.length) return undefined

    const conditions: QueryConditionPayload[] = filters
        .map((filter) => {
            const operator =
                filter.operator && filter.operator.trim()
                    ? filter.operator
                    : ("is" as FilterConditions)

            if (filter.field === "references") {
                return {
                    field: filter.field,
                    value: filter.value,
                    operator,
                }
            }

            const condition: QueryConditionPayload = {
                field: filter.field,
                value: filter.value,
                operator,
            }

            if (filter.key && filter.key.trim()) {
                condition.key = filter.key
            }

            return condition
        })
        .filter((condition): condition is QueryConditionPayload =>
            Boolean(condition.field && condition.operator),
        )

    return {
        operator: "and",
        conditions,
    }
}

const collectConditions = (
    node?: QueryFilteringPayload | QueryConditionPayload | null,
): QueryConditionPayload[] => {
    if (!node) return []
    if ((node as QueryFilteringPayload)?.conditions) {
        const filtering = node as QueryFilteringPayload
        return (filtering.conditions || []).flatMap((child) =>
            collectConditions(child as QueryFilteringPayload | QueryConditionPayload),
        )
    }
    const condition = node as QueryConditionPayload
    if (!condition || (!condition.field && !condition.key)) return []
    return [condition]
}

export const fromFilteringPayload = (payload?: QueryFilteringPayload | null): Filter[] => {
    if (!payload) return []
    return collectConditions(payload).map((condition) => {
        const rawOperator = (condition.operator ?? "is").trim()
        const operator = (rawOperator || "is") as FilterConditions
        const key =
            condition.field === "references"
                ? inferReferenceOptionKey(condition.value, condition.key)
                : condition.key
        return {
            field: (condition.field ?? condition.key ?? "") as string,
            key,
            operator,
            value: condition.value,
        }
    })
}

export const toWindowingPayload = ({
    samplingRate,
    historicalRange,
}: {
    samplingRate?: number | null
    historicalRange?: string[]
}): QueryRevisionDataPayload["windowing"] => {
    const windowing: QueryRevisionDataPayload["windowing"] = {}

    if (typeof samplingRate === "number") {
        windowing.rate = Math.min(Math.max(samplingRate / 100, 0), 1)
    }

    if (historicalRange && historicalRange.length === 2) {
        const [oldest, newest] = historicalRange
        windowing.oldest = oldest
        windowing.newest = newest
        windowing.order = "ascending"
    }

    return Object.keys(windowing).length ? windowing : undefined
}

export const parseSamplingRate = (value: unknown): number | null => {
    if (value === undefined || value === null || value === "") return null
    const n = typeof value === "number" ? value : Number(value)
    if (Number.isNaN(n)) return null
    const rounded = Math.round(n)
    return Math.min(Math.max(rounded, 0), 100)
}
