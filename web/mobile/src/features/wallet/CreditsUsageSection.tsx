import {useMemo, useState} from "react"

import {formatLocale, useT} from "@agenta/i18n"
import walletUsageCatalog from "@agenta/i18n/catalogs/wallet.usage"
import {sharePercent, sum} from "@agenta/observability/analytics"
import {
    AnalyticsCard,
    ChartLegendRow,
    ChartTooltipPanel,
    TimeChart,
} from "@agenta/observability-ui/analytics"
import {GroupMenu} from "@agenta/ui/filter-menu"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CalendarBlank, Check, LockSimple, Rows} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"

import {AnimatedNumber} from "@/components/AnimatedNumber"

import {
    creditsUsageGroups,
    CREDITS_USAGE_RANGES,
    creditsUsageChart,
    groupLabel,
    rangeDays,
    seriesTotal,
    type CreditsUsageGroup,
    type CreditsUsageRange,
} from "./creditsUsage"
import {fetchWalletUsage, isForbidden} from "./walletApi"
import {formatUsd, MUSD_PER_CREDIT} from "./walletFormat"
import {withSlots} from "./withSlots"

const CHART_HEIGHT = 220

// English keeps its fixed "en-US" format; other languages follow the chosen one.
const credits = (value: number) =>
    value.toLocaleString(formatLocale() ?? "en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    })

const dayLabel = (day: string, withYear = false) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(formatLocale() ?? "en-US", {
        month: "short",
        day: "numeric",
        year: withYear ? "numeric" : undefined,
        timeZone: "UTC",
    })

/** Where credits went over a range: one stacked bar per day, split by the chosen group. */
export const CreditsUsageSection = ({
    projectId,
    canReadUsage,
    checkingAccess,
}: {
    projectId: string
    /** Whether the reader may read where credits went. The API keeps it for `edit_billing`. */
    canReadUsage: boolean
    /** The permission check is still in flight: the section loads rather than locks. */
    checkingAccess: boolean
}) => {
    const t = useT(walletUsageCatalog)
    const [range, setRange] = useState<CreditsUsageRange>(30)
    const [group, setGroup] = useState<CreditsUsageGroup>("category")
    const [hovered, setHovered] = useState<number | null>(null)
    const [hidden, setHidden] = useState<Record<string, boolean>>({})

    const usage = useQuery({
        queryKey: ["wallet", "credits-usage", projectId, range],
        queryFn: () =>
            fetchWalletUsage(projectId, {
                start: new Date(Date.now() - range * 86_400_000).toISOString(),
            }),
        enabled: Boolean(projectId) && canReadUsage,
        refetchInterval: 60_000,
        retry: (count, error) => !isForbidden(error) && count < 2,
    })

    const chart = useMemo(
        () => (usage.data ? creditsUsageChart(usage.data, group, rangeDays(range), t) : null),
        [usage.data, group, range, t],
    )
    const rangeLabel = t("wallet.usage.lastDays", {days: range})
    const total = chart ? sum(chart.total) : 0
    const series = (chart?.series ?? []).map((s) => ({...s, hidden: hidden[s.key]}))
    const labels = chart?.days.map((day) => dayLabel(day)) ?? []
    const bucketTotal = (i: number) =>
        sum(series.filter((s) => !s.hidden).map((s) => s.values[i] ?? 0))
    const toggle = (key: string) => {
        const next = {...hidden, [key]: !hidden[key]}
        if (series.every((s) => next[s.key])) return
        setHidden(next)
    }

    // Locked once the check says no, or when the API refuses after a yes (the role changed
    // since the check). While the check runs, the chart shows its loading state instead.
    const locked = (!canReadUsage && !checkingAccess) || isForbidden(usage.error)

    const controls = (
        <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                        <CalendarBlank data-icon="inline-start" />
                        {rangeLabel}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[180px]">
                    {CREDITS_USAGE_RANGES.map((days) => (
                        <DropdownMenuItem
                            key={days}
                            onSelect={() => {
                                setRange(days)
                                setHovered(null)
                            }}
                            className="justify-between"
                        >
                            {t("wallet.usage.lastDays", {days})}
                            {days === range ? <Check /> : null}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <GroupMenu
                options={creditsUsageGroups(t)}
                value={group}
                onChange={(next) => {
                    setGroup(next)
                    setHidden({})
                    setHovered(null)
                }}
                label={
                    group === "none"
                        ? t("wallet.usage.group")
                        : t("wallet.usage.groupBy", {group: groupLabel(group, t)})
                }
                icon={<Rows size={14} />}
                align="end"
            />
        </div>
    )

    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">
                    {t("wallet.usage.title")}
                </h2>
                {locked ? null : controls}
            </div>
            {locked ? (
                <div className="border-border flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
                    <LockSimple size={22} className="text-muted-foreground" />
                    <span className="font-medium">{t("wallet.usage.locked")}</span>
                    <span className="text-muted-foreground text-sm">
                        {t("wallet.usage.lockedHint")}
                    </span>
                </div>
            ) : (
                <AnalyticsCard
                    title={t("wallet.usage.creditsUsed")}
                    value={withSlots((values) => t("wallet.usage.total", values), {
                        credits: <AnimatedNumber value={credits(total)} />,
                        usd: <AnimatedNumber value={formatUsd(total * MUSD_PER_CREDIT)} />,
                    })}
                    caption={rangeLabel}
                    loading={checkingAccess || usage.isPending}
                    error={usage.isError ? usage.error : null}
                    onRetry={() => void usage.refetch()}
                    empty={total ? null : {text: t("wallet.usage.noCreditsInRange", {days: range})}}
                    chartHeight={CHART_HEIGHT}
                    note={chart?.partial ? t("wallet.usage.partialNote") : null}
                    legend={
                        <ChartLegendRow
                            items={series.map((s) => ({
                                key: s.key,
                                label: t("wallet.usage.legendItem", {
                                    label: s.label,
                                    credits: credits(seriesTotal(s)),
                                    share: sharePercent(seriesTotal(s), total),
                                }),
                                color: s.color,
                                hidden: s.hidden,
                            }))}
                            onToggle={series.length > 1 ? toggle : undefined}
                        />
                    }
                >
                    <TimeChart
                        kind="bar"
                        labels={labels}
                        series={series}
                        formatTick={(v) => credits(v).replace(/\.0$/, "")}
                        height={CHART_HEIGHT}
                        hovered={hovered}
                        onHover={setHovered}
                        tooltip={(i) => (
                            <ChartTooltipPanel
                                title={chart ? dayLabel(chart.days[i], true) : ""}
                                value={t("wallet.usage.creditsAmount", {
                                    credits: credits(bucketTotal(i)),
                                })}
                                rows={series
                                    .filter((s) => !s.hidden && (s.values[i] ?? 0) > 0)
                                    .sort((a, b) => (b.values[i] ?? 0) - (a.values[i] ?? 0))
                                    .map((s) => ({
                                        color: s.color,
                                        label: s.label,
                                        value: credits(s.values[i] ?? 0),
                                        share: sharePercent(s.values[i] ?? 0, bucketTotal(i)),
                                    }))}
                                facts={[
                                    {
                                        label: t("wallet.usage.cost"),
                                        value: formatUsd(bucketTotal(i) * MUSD_PER_CREDIT),
                                    },
                                ]}
                            />
                        )}
                    />
                </AnalyticsCard>
            )}
        </section>
    )
}
