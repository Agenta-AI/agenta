import type {ReactNode} from "react"

import {
    formatCost,
    formatQueryFiltering,
    formatQuerySampleRate,
    formatDuration,
    formatTokens,
    frequencyBars,
    metricSummary,
    type MetricStats,
    type RunHeader,
    type RunQueryConfig,
    type RunReferences,
} from "@agenta/entities/evaluationRun"

import {RunStatusTag} from "./RunStatusTag"
import type {OverviewMetric, OverviewNames} from "./useRunOverview"

export interface RunSummaryRow {
    key: string
    label: ReactNode
    value: ReactNode
}

export interface RunSummaryInput {
    header: RunHeader
    references: RunReferences | null
    metrics: readonly OverviewMetric[]
    metricsPending: boolean
    names: Pick<OverviewNames, "testsets" | "application" | "variant">
    /** A live run's query: its filtering and sampling rate. Undefined while it loads. */
    query?: RunQueryConfig | null
}

const MISSING = "—"
const PENDING = "…"

const mean = (stats: MetricStats) =>
    stats.mean ?? (stats.sum !== undefined && stats.count ? stats.sum / stats.count : undefined)

/** Cost, duration and tokens show the average per scenario; errors show the total. */
const INVOCATION_ROWS = [
    {id: "cost", label: "Cost (Avg)", format: (s: MetricStats) => fmt(mean(s), formatCost)},
    {
        id: "duration",
        label: "Duration (Avg)",
        format: (s: MetricStats) => fmt(mean(s), formatDuration),
    },
    {id: "tokens", label: "Tokens (Avg)", format: (s: MetricStats) => fmt(mean(s), formatTokens)},
    {
        id: "errors",
        label: "Errors",
        format: (s: MetricStats) =>
            fmt(
                s.sum ??
                    (s.mean !== undefined && s.count !== undefined ? s.mean * s.count : undefined),
                (value) => String(Math.round(value)),
            ),
    },
] as const

function fmt(value: number | undefined, format: (value: number) => string): string {
    return value === undefined ? MISSING : format(value)
}

const dateText = (value: string | null) => (value ? new Date(value).toLocaleString() : MISSING)

function metricValue(stats: MetricStats | null): ReactNode {
    const summary = metricSummary(stats)
    if (summary) return summary.formatted
    const bars = frequencyBars(stats, 3)
    if (bars.length === 0) return MISSING
    return (
        <span className="flex flex-wrap gap-1">
            {bars.map((bar) => (
                <span
                    key={bar.category}
                    className="rounded-control-sm border border-solid border-border px-1.5 text-xs"
                >
                    {bar.category} ({bar.value})
                </span>
            ))}
        </span>
    )
}

const metricRowLabel = (metric: OverviewMetric) => (
    <span className="flex flex-col">
        <span className="text-xs text-muted-foreground">{metric.evaluatorName ?? "--"}</span>
        <span>
            {metric.label}
            {metric.stats?.mean !== undefined ? " (mean)" : ""}
        </span>
    </span>
)

/** The summary rows of one run, in the order the old app lists them. */
export function buildRunSummaryRows({
    header,
    references,
    metrics,
    metricsPending,
    names,
    query,
}: RunSummaryInput): RunSummaryRow[] {
    const rows: RunSummaryRow[] = []
    const testsets = references?.testsets ?? []
    if (testsets.length > 0) {
        rows.push({
            key: "testset",
            label: "Test set",
            value: testsets
                .map((testset, index) => names.testsets[index] ?? testset.testsetId)
                .join(", "),
        })
    }
    rows.push({key: "evaluation", label: "Evaluation", value: header.name})
    // A stopped live run keeps the "running" status on the server: say it is stopped.
    const stopped = header.kind === "online" && !header.flags.isClosed && !header.flags.isActive
    rows.push({
        key: "status",
        label: "Status",
        value: <RunStatusTag status={stopped ? "stopped" : header.status} />,
    })
    if ((references?.queryIds.length ?? 0) > 0) {
        rows.push({
            key: "queries",
            label: "Filters / Queries",
            // The filter itself and the sampling rate, as the old app prints them.
            value:
                query === undefined ? (
                    PENDING
                ) : (
                    <span className="flex flex-col">
                        <span className="break-words">
                            {formatQueryFiltering(query?.filtering)}
                        </span>
                        <span>{`Sample rate: ${formatQuerySampleRate(query?.rate)}`}</span>
                    </span>
                ),
        })
    }
    rows.push({key: "created", label: "Created at", value: dateText(header.createdAt)})
    rows.push({key: "updated", label: "Updated at", value: dateText(header.updatedAt)})
    if (references?.applicationId) {
        rows.push({
            key: "application",
            label: "Application",
            value: names.application ?? references.applicationId,
        })
        const version = references.revisionVersion
        rows.push({
            key: "variant",
            label: "Variant",
            value:
                [names.variant, version !== null ? `v${version}` : null]
                    .filter(Boolean)
                    .join(" ") || MISSING,
        })
    }

    for (const row of INVOCATION_ROWS) {
        const stats = metrics.find((metric) => metric.id === row.id)?.stats ?? null
        rows.push({
            key: row.id,
            label: row.label,
            value: stats ? row.format(stats) : metricsPending ? PENDING : MISSING,
        })
    }

    const evaluatorMetrics = metrics
        .filter((metric) => metric.kind === "evaluator")
        .sort((a, b) =>
            `${a.evaluatorName ?? ""}: ${a.label}`.localeCompare(
                `${b.evaluatorName ?? ""}: ${b.label}`,
            ),
        )
    for (const metric of evaluatorMetrics) {
        rows.push({key: metric.id, label: metricRowLabel(metric), value: metricValue(metric.stats)})
    }
    return rows
}
