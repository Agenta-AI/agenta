import {useMemo, useState} from "react"

import {formatCount, formatMetric, niceMax, sum} from "@agenta/observability/analytics"
import {Input, cn} from "@agenta/ui/ui"

import {analyticsColor} from "../colors"
import type {AnalyticsWindowData} from "../useAnalyticsData"

import {AnalyticsCard} from "./AnalyticsCard"

const VISIBLE = 6

export interface FailureRateCardProps {
    data: AnalyticsWindowData
    agentName: (id: string) => string
    rangeLabel: string
    emptyText: (what: string) => {text: string; onClear?: () => void}
    /** `failedOnly` is false for an agent with no failures, so its drawer is not empty. */
    onSelectAgent: (agentId: string, failedOnly: boolean) => void
}

export const FailureRateCard = ({
    data,
    agentName,
    rangeLabel,
    emptyText,
    onSelectAgent,
}: FailureRateCardProps) => {
    const [showAll, setShowAll] = useState(false)
    const [query, setQuery] = useState("")
    const {totals} = data.overview
    const overall = totals.runs ? totals.failed / totals.runs : 0
    // Below this a rate is noise (1 of 2 is not "50% failing"): such rows show muted.
    const minRuns = 5

    // Every agent: the most failures first, so no failure hides behind a run threshold.
    const rows = useMemo(
        () =>
            data.agentOrder
                .map((id) => {
                    const runs = sum(data.agentRuns[id])
                    const failed = sum(data.agentFailed[id] ?? [])
                    return {id, label: agentName(id), runs, failed, rate: runs ? failed / runs : 0}
                })
                .sort((a, b) => b.failed - a.failed || b.rate - a.rate || b.runs - a.runs),
        [data.agentOrder, data.agentRuns, data.agentFailed, agentName],
    )

    const scale = niceMax(Math.max(overall, ...rows.map((r) => r.rate)) * 100) / 100 || 1
    const filtered = rows.filter(
        (row) => !query || row.label.toLowerCase().includes(query.toLowerCase()),
    )
    const shown = showAll ? filtered : filtered.slice(0, VISIBLE)
    const status = data.status.agents
    const empty = totals.failed ? null : emptyText("failed runs")

    return (
        <AnalyticsCard
            title="Failure rate by agent"
            caption={
                totals.failed
                    ? `Overall ${formatMetric("failrate", overall * 100)} · ${formatCount(totals.failed)} of ${formatCount(totals.runs)} runs failed`
                    : rangeLabel
            }
            loading={status.pending || data.status.overview.pending}
            error={status.error}
            onRetry={status.refetch}
            empty={empty}
        >
            <div className="-mt-1 flex flex-col">
                {showAll && rows.length > 10 ? (
                    <Input
                        className="mb-2 mt-2 max-w-[260px]"
                        placeholder="Search agents…"
                        aria-label="Search agents"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                ) : null}
                <div className={cn("flex flex-col", showAll && "max-h-[360px] overflow-y-auto")}>
                    {shown.map((row) => {
                        const above = row.rate > overall
                        const fewRuns = row.runs < minRuns
                        return (
                            <button
                                key={row.id}
                                type="button"
                                onClick={() => onSelectAgent(row.id, row.failed > 0)}
                                title={
                                    fewRuns
                                        ? `Only ${row.runs} runs: too few for a steady rate`
                                        : undefined
                                }
                                className="-mx-2 grid h-9 cursor-pointer grid-cols-[minmax(0,1fr)_minmax(64px,1fr)_48px_64px] sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_54px_92px] items-center gap-3.5 rounded-md border-0 bg-transparent px-2 text-left text-sm hover:bg-accent"
                            >
                                <span className="truncate">{row.label}</span>
                                <span className="relative h-2.5 rounded-full bg-background">
                                    <span
                                        className="absolute inset-y-0 left-0 rounded-full"
                                        style={{
                                            width: `${Math.max(row.failed ? 1 : 0, (row.rate / scale) * 100)}%`,
                                            background: analyticsColor(
                                                above && !fewRuns ? "failAbove" : "failBelow",
                                            ),
                                        }}
                                    />
                                    <span
                                        className="absolute -inset-y-1.5 w-px bg-muted-foreground/60"
                                        style={{left: `${(overall / scale) * 100}%`}}
                                    />
                                </span>
                                <span
                                    className={cn(
                                        "text-right tabular-nums",
                                        fewRuns
                                            ? "text-muted-foreground"
                                            : above && "font-semibold",
                                    )}
                                >
                                    {formatMetric("failrate", row.rate * 100)}
                                </span>
                                <span className="text-right text-xs text-muted-foreground tabular-nums">
                                    {formatCount(row.failed)} of {formatCount(row.runs)}
                                </span>
                            </button>
                        )
                    })}
                </div>
                <div
                    className={cn(
                        "mt-1 grid grid-cols-[minmax(0,1fr)_minmax(64px,1fr)_48px_64px] sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_54px_92px] gap-3.5 text-[11px] text-muted-foreground",
                        rows.length === 0 && "hidden",
                    )}
                >
                    <span />
                    <span className="relative flex justify-between">
                        <span>0%</span>
                        <span
                            className="absolute hidden -translate-x-1/2 sm:inline"
                            style={{left: `${(overall / scale) * 100}%`}}
                        >
                            avg {formatMetric("failrate", overall * 100, true)}
                        </span>
                        <span>{formatMetric("failrate", scale * 100, true)}</span>
                    </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[11px] text-muted-foreground">
                        Click a row to see its runs and why they failed. Muted rates have fewer than{" "}
                        {minRuns} runs.
                    </span>
                    {rows.length > VISIBLE ? (
                        <button
                            type="button"
                            onClick={() => {
                                setShowAll(!showAll)
                                setQuery("")
                            }}
                            className="cursor-pointer border-0 bg-transparent p-0 text-xs text-foreground underline underline-offset-2"
                        >
                            {showAll ? "Show top 6" : `Show all ${rows.length} agents`}
                        </button>
                    ) : null}
                </div>
            </div>
        </AnalyticsCard>
    )
}
