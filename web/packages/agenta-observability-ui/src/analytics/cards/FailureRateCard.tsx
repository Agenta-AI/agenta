import {useMemo, useState} from "react"

import {formatCount, formatMetric, sum} from "@agenta/observability/analytics"
import {cn} from "@agenta/ui/ui"

import {analyticsColor} from "../colors"
import type {AnalyticsWindowData, FailureReasons} from "../useAnalyticsData"

import {AnalyticsCard} from "./AnalyticsCard"

const VISIBLE = 6
// Below this a rate is noise (1 of 2 is not "50% failing"), so it reads muted.
const MIN_RUNS = 5
const GRID = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_76px_52px] items-center gap-3 text-sm"

export interface FailureRateCardProps {
    data: AnalyticsWindowData
    failures: FailureReasons
    agentName: (id: string) => string
    rangeLabel: string
    emptyText: (what: string) => {text: string; onClear?: () => void}
    onSelectAgent: (agentId: string) => void
}

/** The agents whose runs failed, most failures first, with each agent's main reason. */
export const FailureRateCard = ({
    data,
    failures,
    agentName,
    rangeLabel,
    emptyText,
    onSelectAgent,
}: FailureRateCardProps) => {
    const [showAll, setShowAll] = useState(false)
    const {totals} = data.overview
    const overall = totals.runs ? totals.failed / totals.runs : 0

    const rows = useMemo(
        () =>
            data.agentOrder
                .map((id) => {
                    const runs = sum(data.agentRuns[id])
                    const failed = sum(data.agentFailed[id] ?? [])
                    return {id, runs, failed, rate: runs ? failed / runs : 0}
                })
                .filter((row) => row.failed > 0)
                .sort((a, b) => b.failed - a.failed || b.rate - a.rate),
        [data.agentOrder, data.agentRuns, data.agentFailed],
    )
    const shown = showAll ? rows : rows.slice(0, VISIBLE)
    const clean = data.agentOrder.length - rows.length
    const status = data.status.agents

    return (
        <AnalyticsCard
            title="Failures by agent"
            caption={
                totals.failed
                    ? `${formatCount(totals.failed)} failed · ${rows.length} ${rows.length === 1 ? "agent" : "agents"}`
                    : rangeLabel
            }
            loading={status.pending || data.status.overview.pending}
            error={status.error}
            onRetry={status.refetch}
            empty={totals.failed ? null : emptyText("failed runs")}
        >
            <div className="flex flex-col">
                <div className={cn(GRID, "h-7 text-xs text-muted-foreground")}>
                    <span>Agent</span>
                    <span>Main reason</span>
                    <span className="text-right">Failed</span>
                    <span className="text-right">Rate</span>
                </div>
                {shown.map((row) => {
                    const few = row.runs < MIN_RUNS
                    const high = !few && row.rate > overall
                    return (
                        <button
                            key={row.id}
                            type="button"
                            onClick={() => onSelectAgent(row.id)}
                            title={
                                few ? `Only ${row.runs} runs: too few for a steady rate` : undefined
                            }
                            className={cn(
                                GRID,
                                "h-10 cursor-pointer border-0 border-t border-solid border-border bg-transparent px-0 text-left hover:bg-accent/40",
                            )}
                        >
                            <span className="truncate text-foreground">{agentName(row.id)}</span>
                            <span className="truncate text-muted-foreground">
                                {failures.mainReason(row.id) ?? "—"}
                            </span>
                            <span className="text-right tabular-nums text-foreground">
                                {formatCount(row.failed)}
                                <span className="text-muted-foreground">
                                    {" "}
                                    / {formatCount(row.runs)}
                                </span>
                            </span>
                            <span
                                className={cn(
                                    "text-right tabular-nums",
                                    few ? "text-muted-foreground" : "text-foreground",
                                )}
                                style={high ? {color: analyticsColor("textBad")} : undefined}
                            >
                                {formatMetric("failrate", row.rate * 100, true)}
                            </span>
                        </button>
                    )
                })}
                <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-border pt-2 text-xs text-muted-foreground">
                    <span>
                        {clean > 0
                            ? `${clean} other ${clean === 1 ? "agent" : "agents"} had no failures`
                            : null}
                    </span>
                    {rows.length > VISIBLE ? (
                        <button
                            type="button"
                            onClick={() => setShowAll(!showAll)}
                            className="cursor-pointer border-0 bg-transparent p-0 text-xs text-foreground underline underline-offset-2"
                        >
                            {showAll ? `Show top ${VISIBLE}` : `Show all ${rows.length}`}
                        </button>
                    ) : null}
                </div>
            </div>
        </AnalyticsCard>
    )
}
