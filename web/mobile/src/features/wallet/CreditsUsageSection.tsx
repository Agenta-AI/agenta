import {useMemo, useState} from "react"

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
    CREDITS_USAGE_GROUPS,
    CREDITS_USAGE_RANGES,
    creditsUsageChart,
    groupLabel,
    rangeDays,
    seriesTotal,
    type CreditsUsageGroup,
    type CreditsUsageRange,
} from "./creditsUsage"
import {fetchWalletUsage} from "./walletApi"
import {formatUsd, MUSD_PER_CREDIT} from "./walletFormat"

const CHART_HEIGHT = 220

const isForbidden = (error: unknown): boolean =>
    (error as {response?: {status?: number}} | null)?.response?.status === 403

const credits = (value: number) =>
    value.toLocaleString("en-US", {minimumFractionDigits: 1, maximumFractionDigits: 1})

const dayLabel = (day: string, withYear = false) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: withYear ? "numeric" : undefined,
        timeZone: "UTC",
    })

/** Where credits went over a range: one stacked bar per day, split by the chosen group. */
export const CreditsUsageSection = ({projectId}: {projectId: string}) => {
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
        enabled: Boolean(projectId),
        refetchInterval: 60_000,
        // The detail is owner-only; a 403 is an answer, not a failure to retry.
        retry: (count, error) => !isForbidden(error) && count < 2,
    })

    const chart = useMemo(
        () => (usage.data ? creditsUsageChart(usage.data, group, rangeDays(range)) : null),
        [usage.data, group, range],
    )
    const rangeLabel = `Last ${range} days`
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
                            Last {days} days
                            {days === range ? <Check /> : null}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <GroupMenu
                options={CREDITS_USAGE_GROUPS}
                value={group}
                onChange={(next) => {
                    setGroup(next)
                    setHidden({})
                    setHovered(null)
                }}
                label={group === "none" ? "Group" : `Group: ${groupLabel(group)}`}
                icon={<Rows size={14} />}
                align="end"
            />
        </div>
    )

    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">Usage</h2>
                {isForbidden(usage.error) ? null : controls}
            </div>
            {isForbidden(usage.error) ? (
                <div className="border-border flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
                    <LockSimple size={22} className="text-muted-foreground" />
                    <span className="font-medium">Usage details are owner-only</span>
                    <span className="text-muted-foreground text-sm">
                        Only the organization owner can see where credits were used.
                    </span>
                </div>
            ) : (
                <AnalyticsCard
                    title="Credits used"
                    value={
                        <>
                            <AnimatedNumber value={credits(total)} /> credits ·{" "}
                            <AnimatedNumber value={formatUsd(total * MUSD_PER_CREDIT)} />
                        </>
                    }
                    caption={rangeLabel}
                    loading={usage.isPending}
                    error={usage.isError ? usage.error : null}
                    onRetry={() => void usage.refetch()}
                    empty={
                        total ? null : {text: `No credits used in the ${rangeLabel.toLowerCase()}`}
                    }
                    chartHeight={CHART_HEIGHT}
                    note={
                        chart?.partial
                            ? "Only the newest 5,000 charges in this range are split by this group."
                            : null
                    }
                    legend={
                        <ChartLegendRow
                            items={series.map((s) => ({
                                key: s.key,
                                label: `${s.label} ${credits(seriesTotal(s))} · ${sharePercent(seriesTotal(s), total)}`,
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
                                value={`${credits(bucketTotal(i))} credits`}
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
                                        label: "Cost",
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
