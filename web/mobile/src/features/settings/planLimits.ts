import type {BillingUsage, BillingUsageMetric} from "@agenta/settings-ui"

export type PlanLimitKey = "concurrent_tasks" | "projects" | "users"

export interface PlanLimit {
    key: PlanLimitKey
    label: string
    value: string
    note: string
}

/** A usage entry this page can read: a number used, and a limit that is a number or none. */
const readMetric = (raw: unknown): {value: number; limit: number | null} | null => {
    const metric = raw as Partial<BillingUsageMetric> | null | undefined
    if (!metric || typeof metric !== "object") return null
    const value =
        typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : 0
    // null, absent or negative (-1) all mean no limit.
    const limit =
        typeof metric.limit === "number" && Number.isFinite(metric.limit) && metric.limit >= 0
            ? metric.limit
            : null
    return {value, limit}
}

const count = (n: number) => n.toLocaleString("en-US")

/** Each limit tile, in the order the grid shows them; a key the API does not send is skipped. */
const LIMITS: {
    key: PlanLimitKey
    label: string
    read: (m: {value: number; limit: number | null}) => Omit<PlanLimit, "key" | "label">
}[] = [
    {
        key: "concurrent_tasks",
        label: "Concurrent tasks",
        read: ({value, limit}) => ({
            value: limit == null ? "Unlimited" : count(limit),
            note: value > 0 ? `${count(value)} running now` : "Tasks running at once",
        }),
    },
    {
        key: "projects",
        label: "Projects",
        read: ({value, limit}) => ({
            value: limit == null ? "Unlimited" : `${count(value)} of ${count(limit)}`,
            note:
                limit == null
                    ? `${count(value)} in use`
                    : value >= limit
                      ? "At your plan's limit"
                      : "On this plan",
        }),
    },
    {
        key: "users",
        label: "Members",
        read: ({value, limit}) => ({
            value:
                limit == null
                    ? `${count(value)} · unlimited`
                    : `${count(value)} of ${count(limit)}`,
            note:
                limit == null
                    ? "No per-seat price"
                    : value >= limit && limit > 0
                      ? "At your plan's limit"
                      : `Up to ${count(limit)} on this plan`,
        }),
    },
]

export const planLimits = (usage: BillingUsage | null | undefined): PlanLimit[] =>
    LIMITS.flatMap(({key, label, read}) => {
        const metric = readMetric(usage?.[key])
        return metric ? [{key, label, ...read(metric)}] : []
    })
