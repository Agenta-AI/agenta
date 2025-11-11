import {Filter} from "@/oss/lib/Types"
import {SortResult} from "@/oss/components/Filters/Sort"
import {TraceTabTypes} from "../atoms/controls"

const toNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined) return undefined
    const num = Number(value)
    return Number.isFinite(num) ? num : undefined
}

const toNumberArray = (value: unknown): number[] => {
    if (Array.isArray(value)) {
        return value.map(toNumber).filter((entry): entry is number => entry !== undefined)
    }

    if (typeof value === "string") {
        const trimmed = value.trim()
        if (!trimmed) return []

        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            try {
                const parsed = JSON.parse(trimmed)
                if (Array.isArray(parsed)) {
                    return parsed
                        .map(toNumber)
                        .filter((entry): entry is number => entry !== undefined)
                }
            } catch (error) {
                console.warn("Failed to parse numeric array filter", error)
            }
        }

        return trimmed
            .split(/[\s,;]+/g)
            .map(toNumber)
            .filter((entry): entry is number => entry !== undefined)
    }

    const single = toNumber(value)
    return single === undefined ? [] : [single]
}

const toBetweenPair = (value: unknown): number[] => {
    const values = toNumberArray(value)
    return values.length >= 2 ? values.slice(0, 2) : []
}

const isListOperator = (operator?: string) => operator === "in" || operator === "not_in"
const isBetweenOperator = (operator?: string) => operator === "btwn"

export interface BuildTraceQueryParamsArgs {
    focus: TraceTabTypes
    filters: Filter[]
    sort: SortResult
    limit: number
}

export const buildTraceQueryParams = ({
    focus,
    filters,
    sort,
    limit,
}: BuildTraceQueryParamsArgs): Record<string, unknown> => {
    const params: Record<string, unknown> = {
        size: limit,
        focus: focus === "chat" ? "span" : focus,
    }

    if (filters.length) {
        const sanitised = filters.map(({field, key, operator, value}) => {
            if (field === "references") {
                const refKey = key || "id"
                const normalisedArray = Array.isArray(value)
                    ? value.map((entry) =>
                          typeof entry === "object" && entry !== null ? entry : {[refKey]: entry},
                      )
                    : [{[refKey]: value}]
                return {field, operator, value: normalisedArray}
            }

            if (field?.startsWith("attributes.")) {
                const attributeKey = field.slice("attributes.".length)
                let normalisedValue: unknown = value

                if (isBetweenOperator(operator)) {
                    normalisedValue = toBetweenPair(value)
                } else if (isListOperator(operator)) {
                    normalisedValue = toNumberArray(value)
                } else {
                    const numericValue = toNumber(value)
                    normalisedValue = numericValue === undefined ? undefined : numericValue
                }

                return {field: "attributes", key: attributeKey, operator, value: normalisedValue}
            }

            if (field === "status_code" && value === "STATUS_CODE_OK") {
                return {field, operator: "is_not", value: "STATUS_CODE_ERROR"}
            }

            return {field, operator, value}
        })

        params.filter = JSON.stringify({conditions: sanitised})
    }

    if (sort?.type === "standard" && sort.sorted) {
        params.oldest = sort.sorted
    } else if (sort?.type === "custom" && sort.customRange) {
        const {startTime, endTime} = sort.customRange
        if (startTime) params.oldest = startTime
        if (endTime) params.newest = endTime
    }

    return params
}

export default buildTraceQueryParams
