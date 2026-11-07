import {type TranslationKey} from "@agenta/i18n"
import {t} from "@agenta/i18n/billing"
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
    label: TranslationKey<"billing" | "common">
    read: (m: NonNullable<ReturnType<typeof readMetric>>) => Omit<PlanLimit, "key" | "label">
}[] = [
    {
        key: "concurrent_tasks",
        label: "billing.planLimits.concurrentTasks",
        read: ({value, limit}) => ({
            value: limit == null ? t("billing.planLimits.unlimited") : count(limit),
            note:
                value > 0
                    ? t("billing.planLimits.runningNow", {running: count(value)})
                    : t("billing.planLimits.tasksRunningAtOnce"),
        }),
    },
    {
        key: "projects",
        label: "billing.planLimits.projects",
        read: ({value, limit}) => ({
            value:
                limit == null
                    ? t("billing.planLimits.unlimited")
                    : t("billing.planLimits.usedOfLimit", {
                          used: count(value),
                          limit: count(limit),
                      }),
            note:
                limit == null
                    ? t("billing.planLimits.inUse", {used: count(value)})
                    : value >= limit
                      ? t("billing.planLimits.atLimit")
                      : t("billing.planLimits.onThisPlan"),
        }),
    },
    {
        key: "users",
        label: "billing.planLimits.members",
        read: ({value, limit}) => ({
            value:
                limit == null
                    ? t("billing.planLimits.usedUnlimited", {used: count(value)})
                    : t("billing.planLimits.usedOfLimit", {
                          used: count(value),
                          limit: count(limit),
                      }),
            note:
                limit == null
                    ? t("billing.planLimits.noPerSeatPrice")
                    : value >= limit && limit > 0
                      ? t("billing.planLimits.atLimit")
                      : t("billing.planLimits.upToOnThisPlan", {limit: count(limit)}),
        }),
    },
]

const quotaWindow = (period: string, scope: string) => {
    const perUser = scope === "user"
    if (period === "daily")
        return perUser ? t("billing.planLimits.todayPerUser") : t("billing.planLimits.today")
    if (period === "monthly")
        return perUser
            ? t("billing.planLimits.thisMonthPerUser")
            : t("billing.planLimits.thisMonth")
    return perUser ? t("billing.planLimits.inTotalPerUser") : t("billing.planLimits.inTotal")
}

/** The pre-credits quotas, shown only in Developer Mode. */
const QUOTAS: typeof LIMITS = (
    [
        ["traces_ingested", "billing.planLimits.tracesIngested"],
        ["traces_retrieved", "billing.planLimits.tracesRetrieved"],
        ["evaluations_run", "billing.planLimits.evaluationsRun"],
        ["events_ingested", "billing.planLimits.eventsIngested"],
        ["records_ingested", "billing.planLimits.recordsIngested"],
    ] as const
).map(([key, label]) => ({
    key,
    label,
    read: ({value, limit, period, scope}) => ({
        value:
            limit == null
                ? count(value)
                : t("billing.planLimits.usedOfLimit", {used: count(value), limit: count(limit)}),
        note: quotaWindow(period, scope),
    }),
}))

export const planLimits = (
    usage: BillingUsage | null | undefined,
    {quotas = false}: {quotas?: boolean} = {},
): PlanLimit[] =>
    (quotas ? [...LIMITS, ...QUOTAS] : LIMITS).flatMap(({key, label, read}) => {
        const metric = readMetric(usage?.[key])
        return metric ? [{key, label: t(label), ...read(metric)}] : []
    })
