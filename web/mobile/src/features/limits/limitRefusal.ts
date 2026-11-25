const LIMIT_REFUSAL_CODES = [
    "project_limit_reached",
    "instance_organization_limit_reached",
] as const

export type LimitRefusalCode = (typeof LIMIT_REFUSAL_CODES)[number]

/** The API's refusal of a new project or organization at the plan's limit. */
export interface LimitRefusal {
    code: LimitRefusalCode
    limit: number
}

/** The limit refusal in an API error (`detail.code`), or null for any other error. */
export const readLimitRefusal = (error: unknown): LimitRefusal | null => {
    const detail = (error as {response?: {data?: {detail?: unknown}}} | null)?.response?.data
        ?.detail as {code?: unknown; limit?: unknown} | undefined
    if (
        !detail ||
        typeof detail !== "object" ||
        !LIMIT_REFUSAL_CODES.includes(detail.code as LimitRefusalCode)
    ) {
        return null
    }
    return {
        code: detail.code as LimitRefusalCode,
        limit: typeof detail.limit === "number" ? detail.limit : 1,
    }
}
