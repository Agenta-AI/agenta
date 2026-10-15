import type {BillingUsage, BillingUsageMetric} from "@agenta/settings-ui"

export type PlanLimitKey =
    | "concurrent_tasks"
    | "projects"
    | "users"
    | "traces_ingested"
    | "traces_retrieved"
    | "evaluations_run"
    | "events_ingested"
    | "records_ingested"

export interface PlanLimit {
    key: PlanLimitKey
    label: string
    value: string
    note: string
}

/** A usage entry this page can read: a number used, and a limit that is a number or none. */
const readMetric = (
    raw: unknown,
): {value: number; limit: number | null; period: string; scope: string} | null => {
    const metric = raw as Partial<BillingUsageMetric> | null | undefined
    if (!metric || typeof metric !== "object") return null
    const value =
        typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : 0
    // null, absent or negative (-1) all mean no limit.
    const limit =
        typeof metric.limit === "number" && Number.isFinite(metric.limit) && metric.limit >= 0
            ? metric.limit
            : null
    return {value, limit, period: String(metric.period ?? ""), scope: String(metric.scope ?? "")}
}

const count = (n: number) => n.toLocaleString("en-US")

/** Each limit tile, in the order the grid shows them; a key the API does not send is skipped. */
const LIMITS: {
    key: PlanLimitKey
    label: string
    read: (m: NonNullable<ReturnType<typeof readMetric>>) => Omit<PlanLimit, "key" | "label">
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

const quotaWindow = (period: string, scope: string) =>
    `${period === "daily" ? "Today" : period === "monthly" ? "This month" : "In total"}${scope === "user" ? ", per user" : ""}`

/** The pre-credits quotas, shown only in Developer Mode. */
const QUOTAS: typeof LIMITS = (
    [
        ["traces_ingested", "Traces ingested"],
        ["traces_retrieved", "Traces retrieved"],
        ["evaluations_run", "Evaluations run"],
        ["events_ingested", "Events ingested"],
        ["records_ingested", "Records ingested"],
    ] as const
).map(([key, label]) => ({
    key,
    label,
    read: ({value, limit, period, scope}) => ({
        value: limit == null ? count(value) : `${count(value)} of ${count(limit)}`,
        note: quotaWindow(period, scope),
    }),
}))

export const planLimits = (
    usage: BillingUsage | null | undefined,
    {quotas = false}: {quotas?: boolean} = {},
): PlanLimit[] =>
    (quotas ? [...LIMITS, ...QUOTAS] : LIMITS).flatMap(({key, label, read}) => {
        const metric = readMetric(usage?.[key])
        return metric ? [{key, label, ...read(metric)}] : []
    })
