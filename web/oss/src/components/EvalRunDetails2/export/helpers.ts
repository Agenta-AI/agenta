/**
 * Helper utilities for scenario table CSV export
 */

export const normalizeString = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim()
    }
    return null
}

export const logExportAction = (message: string, payload?: Record<string, unknown>) => {
    if (process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true") {
        console.info(`[EvalRunDetails2][Export] ${message}`, payload ?? {})
    }
}

/**
 * Format a value for CSV export
 */
export const formatExportValue = (value: unknown): string => {
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}
