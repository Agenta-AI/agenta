/**
 * Minimal query-filter shape consumed by `summarizeQueryFilters`.
 *
 * The runs-table only reads `key`, `field`, `operator`, and `value` off each filter; the
 * full OSS `Filter` type (`@/oss/lib/Types`) carries more fields the summary never touches.
 * Defined locally to keep the data layer free of any `@/oss` import.
 */
export interface QuerySummaryFilter {
    field?: string
    key?: string
    operator?: string
    value?: unknown
}

export const formatFilterValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    if (Array.isArray(value)) {
        const formatted = value
            .map((entry) => formatFilterValue(entry))
            .filter((item) => item && item !== "—")
        return formatted.length ? formatted.join(", ") : "—"
    }
    if (typeof value === "object") {
        const record = value as Record<string, unknown>
        const label =
            (typeof record.label === "string" && record.label.trim()) ||
            (typeof record.name === "string" && record.name.trim()) ||
            (typeof record.slug === "string" && record.slug.trim()) ||
            (typeof record.id === "string" && record.id.trim()) ||
            null
        if (label) return label
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }
    if (typeof value === "string") {
        const trimmed = value.trim()
        return trimmed.length ? trimmed : "—"
    }
    return String(value)
}

export const summarizeQueryFilters = (filters?: QuerySummaryFilter[] | null): string | null => {
    if (!filters || !filters.length) return null
    const parts = filters.map((filter) => {
        const field = filter.key || filter.field || "field"
        const operator = (filter.operator || "is").replace(/_/g, " ")
        const value = formatFilterValue(filter.value)
        return `${field} ${operator} ${value}`
    })
    const summary = parts.slice(0, 2).join(" · ")
    const remaining = parts.length - 2
    return remaining > 0 ? `${summary} +${remaining} more` : summary
}
