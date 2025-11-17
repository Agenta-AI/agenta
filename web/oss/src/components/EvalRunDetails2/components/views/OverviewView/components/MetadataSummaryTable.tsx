import {memo, useMemo, type ReactNode} from "react"

import {Space, Table, Tag, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"
import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import type {BasicStats} from "@/oss/lib/metricUtils"

import {evaluationQueryRevisionAtomFamily} from "../../../../atoms/query"
import {
    runCreatedAtAtomFamily,
    runDisplayNameAtomFamily,
    runStatusAtomFamily,
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
    runUpdatedAtAtomFamily,
} from "../../../../atoms/runDerived"
import {previewRunMetricStatsSelectorFamily} from "../../../../atoms/runMetrics"
import {evaluationRunIndexAtomFamily} from "../../../../atoms/table/run"
import type {
    QueryConditionPayload,
    QueryFilteringPayload,
} from "../../../../services/onlineEvaluations/api"
import {ApplicationReferenceLabel, TestsetTagList, VariantReferenceLabel} from "../../../reference"
import {useRunMetricData} from "../hooks/useRunMetricData"
import {resolveMetricValue} from "../utils/metrics"

interface MetadataSummaryTableProps {
    runIds: string[]
    projectURL?: string | null
}

const QuerySummaryCell = ({runId}: MetadataCellProps) => {
    const revAtom = useMemo(() => evaluationQueryRevisionAtomFamily(runId), [runId])
    const revQuery = useAtomValueWithSchedule(revAtom, {priority: LOW_PRIORITY}) as any

    const filtering: QueryFilteringPayload | undefined = revQuery?.data?.revision?.filtering
    const windowing: any = revQuery?.data?.revision?.windowing
    const isLoading = Boolean((revQuery as any)?.isLoading || (revQuery as any)?.isPending)

    const formatValue = (v: unknown): string => {
        if (typeof v === "string") return v
        if (typeof v === "number") return String(v)
        if (typeof v === "boolean") return v ? "true" : "false"
        try {
            return JSON.stringify(v)
        } catch {
            return String(v)
        }
    }

    const formatCondition = (c: QueryConditionPayload): string => {
        const op = c.operator || "=="
        const field = c.field || c.key || "field"
        const value = formatValue(c.value)
        return `${field} ${op} ${value}`
    }

    const formatFiltering = (f?: QueryFilteringPayload): string => {
        if (!f) return "—"
        const parts: string[] = []
        for (const cond of f.conditions ?? []) {
            if ((cond as QueryFilteringPayload)?.conditions) {
                parts.push(`(${formatFiltering(cond as QueryFilteringPayload)})`)
            } else {
                parts.push(formatCondition(cond as QueryConditionPayload))
            }
        }
        const op = (f.operator || "and").toUpperCase()
        return parts.length ? parts.join(` ${op} `) : "—"
    }

    const formatSampleRate = (rate: unknown): string => {
        if (typeof rate !== "number" || Number.isNaN(rate)) return "—"
        // Heuristic: if 0<rate<=1 treat as fraction; if 1<rate<=100 treat as percent
        const pct = rate > 0 && rate <= 1 ? rate * 100 : rate
        const rounded = Math.round((pct + Number.EPSILON) * 100) / 100
        return `${rounded}%`
    }

    if (isLoading) return <Typography.Text type="secondary">…</Typography.Text>

    const filtersText = filtering ? formatFiltering(filtering) : "—"
    const sampleRateText = formatSampleRate(windowing?.rate)

    return (
        <div className="flex flex-col">
            <Typography.Text>{`${filtersText}`}</Typography.Text>
            <Typography.Text>{`Sample rate: ${sampleRateText}`}</Typography.Text>
        </div>
    )
}

interface MetadataRowRecord {
    key: string
    label: string
    Cell: (props: MetadataCellProps) => JSX.Element
    shouldDisplay?: (context: MetadataRowContext) => boolean
}

interface MetadataCellProps {
    runId: string
    compareIndex: number
    projectURL?: string | null
}

interface RunReferenceSnapshot {
    runId: string
    invocationRefs: {
        applicationId: string | null
        applicationVariantId: string | null
        variantId: string | null
        rawRefs?: Record<string, any>
    }
    testsetIds: string[]
}

interface MetadataRowContext {
    runIds: string[]
    snapshots: RunReferenceSnapshot[]
}

const RunHeader = ({runId, index}: {runId: string; index: number}) => {
    const name = useAtomValueWithSchedule(
        useMemo(() => runDisplayNameAtomFamily(runId), [runId]),
        {
            priority: LOW_PRIORITY,
        },
    )
    const status = useAtomValueWithSchedule(
        useMemo(() => runStatusAtomFamily(runId), [runId]),
        {
            priority: LOW_PRIORITY,
        },
    )
    return (
        <Space size={8} wrap>
            <Typography.Text strong>{name}</Typography.Text>
            <Tag color={index === 0 ? "geekblue" : "purple"}>
                {index === 0 ? "Base run" : `Comparison ${index}`}
            </Tag>
            {status ? <Tag color="blue">{status}</Tag> : null}
        </Space>
    )
}

const CreatedCell = ({runId}: MetadataCellProps) => {
    const createdAtom = useMemo(() => runCreatedAtAtomFamily(runId), [runId])
    const created = useAtomValueWithSchedule(createdAtom, {priority: LOW_PRIORITY})
    if (!created) return <Typography.Text type="secondary">—</Typography.Text>
    return <Typography.Text>{new Date(created).toLocaleString()}</Typography.Text>
}

const UpdatedCell = ({runId}: MetadataCellProps) => {
    const updatedAtom = useMemo(() => runUpdatedAtAtomFamily(runId), [runId])
    const updated = useAtomValueWithSchedule(updatedAtom, {priority: LOW_PRIORITY})
    if (!updated) return <Typography.Text type="secondary">—</Typography.Text>
    return <Typography.Text>{new Date(updated).toLocaleString()}</Typography.Text>
}

const ApplicationCell = ({runId, projectURL}: MetadataCellProps) => (
    <ApplicationReferenceLabel runId={runId} projectURL={projectURL} />
)

const VariantCell = ({runId}: MetadataCellProps) => <VariantReferenceLabel runId={runId} />

const TestsetsCell = ({runId, projectURL}: MetadataCellProps) => {
    const idsAtom = useMemo(() => runTestsetIdsAtomFamily(runId), [runId])
    const ids = useAtomValueWithSchedule(idsAtom, {priority: LOW_PRIORITY})
    return <TestsetTagList ids={ids} projectURL={projectURL} runId={runId} />
}

const ScenarioCountCell = ({runId}: MetadataCellProps) => {
    const selection = useAtomValueWithSchedule(
        useMemo(
            () =>
                previewRunMetricStatsSelectorFamily({
                    runId,
                    metricKey: "attributes.ag.metrics.tokens.cumulative.total",
                }),
            [runId],
        ),
        {priority: LOW_PRIORITY},
    )
    if (selection.state === "loading") {
        return <Typography.Text type="secondary">…</Typography.Text>
    }
    if (selection.state === "hasError") {
        return <Typography.Text type="secondary">—</Typography.Text>
    }
    const count = selection.stats?.count
    return (
        <Typography.Text>
            {typeof count === "number" ? count.toLocaleString() : "—"}
        </Typography.Text>
    )
}

const formatCurrency = (value: number | undefined | null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—"
    return new Intl.NumberFormat(undefined, {style: "currency", currency: "USD"}).format(value)
}

const formatTokens = (value: number | undefined | null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—"
    if (value < 1_000) return Math.round(value).toLocaleString()
    if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}K`
    return `${(value / 1_000_000).toFixed(1)}M`
}

const formatLatency = (seconds: number | undefined | null) => {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—"
    if (seconds < 1) return `${(seconds * 1_000).toFixed(0)} ms`
    return `${seconds.toFixed(2)} s`
}

const makeMetricCell = (metricKey: string, format: (stats: any) => ReactNode) =>
    memo(({runId}: MetadataCellProps) => {
        const selection = useAtomValueWithSchedule(
            useMemo(
                () => previewRunMetricStatsSelectorFamily({runId, metricKey}),
                [runId, metricKey],
            ),
            {priority: LOW_PRIORITY},
        )
        if (selection.state === "loading") {
            return <Typography.Text type="secondary">…</Typography.Text>
        }
        if (selection.state === "hasError") {
            return <Typography.Text type="secondary">—</Typography.Text>
        }
        return <Typography.Text>{format(selection.stats as any)}</Typography.Text>
    })

const InvocationCostCell = makeMetricCell(
    "attributes.ag.metrics.costs.cumulative.total",
    (stats) => {
        const mean =
            typeof stats?.mean === "number"
                ? stats.mean
                : typeof stats?.sum === "number" && stats?.count
                  ? stats.sum / stats.count
                  : undefined
        return formatCurrency(mean)
    },
)

const InvocationDurationCell = makeMetricCell(
    "attributes.ag.metrics.duration.cumulative",
    (stats) => {
        const meanMs =
            typeof stats?.mean === "number"
                ? stats.mean
                : typeof stats?.sum === "number" && stats?.count
                  ? stats.sum / stats.count
                  : undefined
        return formatLatency(typeof meanMs === "number" ? meanMs / 1_000 : undefined)
    },
)

const InvocationTokensCell = makeMetricCell(
    "attributes.ag.metrics.tokens.cumulative.total",
    (stats) => {
        const mean =
            typeof stats?.mean === "number"
                ? stats.mean
                : typeof stats?.sum === "number" && stats?.count
                  ? stats.sum / stats.count
                  : undefined
        return formatTokens(mean)
    },
)

const InvocationErrorsCell = makeMetricCell("attributes.ag.metrics.errors.cumulative", (stats) => {
    const value =
        typeof stats?.sum === "number"
            ? stats.sum
            : typeof stats?.mean === "number" && stats?.count
              ? stats.mean * stats.count
              : stats?.count
    return typeof value === "number" && Number.isFinite(value)
        ? Math.round(value).toLocaleString()
        : "—"
})

const METADATA_ROWS: MetadataRowRecord[] = [
    {key: "created", label: "Created", Cell: CreatedCell},
    {key: "updated", label: "Updated", Cell: UpdatedCell},
    {
        key: "application",
        label: "Application",
        Cell: ApplicationCell,
        shouldDisplay: ({snapshots}) =>
            snapshots.some(({invocationRefs}) => {
                const refs = invocationRefs?.rawRefs ?? {}
                return Boolean(
                    invocationRefs?.applicationId ||
                        refs?.application ||
                        refs?.application_revision ||
                        refs?.applicationRevision ||
                        refs?.agent ||
                        refs?.agent_revision ||
                        refs?.agentRevision,
                )
            }),
    },
    {
        key: "variant",
        label: "Variant",
        Cell: VariantCell,
        shouldDisplay: ({snapshots}) =>
            snapshots.some(({invocationRefs}) => {
                const refs = invocationRefs?.rawRefs ?? {}
                return Boolean(
                    invocationRefs?.variantId ||
                        invocationRefs?.applicationVariantId ||
                        refs?.variant ||
                        refs?.applicationVariant ||
                        refs?.application_variant,
                )
            }),
    },
    {
        key: "testsets",
        label: "Test sets",
        Cell: TestsetsCell,
        shouldDisplay: ({snapshots}) =>
            snapshots.some(({testsetIds}) => (testsetIds?.length ?? 0) > 0),
    },
    {key: "scenarios", label: "Scenarios evaluated", Cell: ScenarioCountCell},
    {key: "invocation_cost", label: "Invocation cost", Cell: InvocationCostCell},
    {key: "invocation_duration", label: "Invocation duration", Cell: InvocationDurationCell},
    {key: "invocation_tokens", label: "Invocation tokens", Cell: InvocationTokensCell},
    {key: "invocation_errors", label: "Invocation errors", Cell: InvocationErrorsCell},
]

const MetadataSummaryTable = ({runIds, projectURL}: MetadataSummaryTableProps) => {
    const orderedRunIds = useMemo(() => runIds.filter((id): id is string => Boolean(id)), [runIds])
    const {metricSelections} = useRunMetricData(orderedRunIds)
    const runReferenceSnapshotsAtom = useMemo(
        () =>
            atom((get) =>
                orderedRunIds.map((runId) => ({
                    runId,
                    invocationRefs: get(runInvocationRefsAtomFamily(runId)) ?? {
                        applicationId: null,
                        applicationVariantId: null,
                        variantId: null,
                        rawRefs: undefined,
                    },
                    testsetIds: get(runTestsetIdsAtomFamily(runId)) ?? [],
                })),
            ),
        [orderedRunIds],
    )
    const runReferenceSnapshots = useAtomValueWithSchedule(runReferenceSnapshotsAtom, {
        priority: LOW_PRIORITY,
    })

    const rowContext = useMemo<MetadataRowContext>(
        () => ({
            runIds: orderedRunIds,
            snapshots: runReferenceSnapshots,
        }),
        [orderedRunIds, runReferenceSnapshots],
    )

    const evaluatorMetricRows = useMemo<MetadataRowRecord[]>(() => {
        if (!metricSelections.length) return []

        const rows: MetadataRowRecord[] = []

        metricSelections.forEach(({metric, selections}) => {
            if (metric.evaluatorLabel === "Invocation") {
                return
            }

            const baseSelection = selections[0]?.selection
            if (!baseSelection || baseSelection.state !== "hasData" || !baseSelection.stats) {
                return
            }

            const selectionMap = new Map(
                selections.map(({runId, selection}) => [runId, selection] as const),
            )

            const EvaluatorMetricCell = memo(({runId}: MetadataCellProps) => {
                const selection = selectionMap.get(runId)
                if (!selection) {
                    return <Typography.Text type="secondary">—</Typography.Text>
                }
                if (selection.state === "loading") {
                    return <Typography.Text type="secondary">…</Typography.Text>
                }
                if (selection.state !== "hasData" || !selection.stats) {
                    return <Typography.Text type="secondary">—</Typography.Text>
                }

                const stats = selection.stats as BasicStats
                const scenarioCount =
                    typeof stats?.count === "number" && Number.isFinite(stats.count)
                        ? stats.count
                        : undefined
                const resolved = resolveMetricValue(stats, scenarioCount)
                if (!resolved) {
                    return <Typography.Text type="secondary">—</Typography.Text>
                }

                return <Typography.Text>{resolved.formatted}</Typography.Text>
            })

            const evaluatorLabel =
                metric.evaluatorLabel && metric.evaluatorLabel.length
                    ? metric.evaluatorLabel
                    : metric.fallbackEvaluatorLabel || "Evaluator"

            rows.push({
                key: metric.id,
                label: `${evaluatorLabel}: ${metric.displayLabel}`,
                Cell: EvaluatorMetricCell,
            })
        })

        rows.sort((a, b) => a.label.localeCompare(b.label))

        return rows
    }, [metricSelections])

    const hasQueryAnywhereAtom = useMemo(
        () =>
            atom((get) => {
                return orderedRunIds.some((runId) => {
                    const runIndex = get(evaluationRunIndexAtomFamily(runId)) as any | null
                    if (!runIndex) return false
                    const inputKeys: string[] = Array.from(runIndex.inputKeys ?? [])
                    for (const key of inputKeys) {
                        const refs = runIndex.steps?.[key]?.refs ?? {}
                        if (
                            refs?.query ||
                            refs?.queryId ||
                            refs?.query_id ||
                            refs?.queryRevision ||
                            refs?.query_revision ||
                            refs?.queryVariant ||
                            refs?.query_variant
                        ) {
                            return true
                        }
                    }
                    return false
                })
            }),
        [orderedRunIds],
    )
    const anyHasQuery = useAtomValueWithSchedule(hasQueryAnywhereAtom, {priority: LOW_PRIORITY})

    const dataSource = useMemo(() => {
        const base = [...METADATA_ROWS]
        if (anyHasQuery) {
            base.splice(3, 0, {key: "query_config", label: "Query", Cell: QuerySummaryCell})
        }
        const rows = [...base, ...evaluatorMetricRows]
            .filter((row) => (row.shouldDisplay ? row.shouldDisplay(rowContext) : true))
            .map((row) => ({key: row.key, label: row.label, Cell: row.Cell}))
        return rows
    }, [anyHasQuery, evaluatorMetricRows, rowContext])

    const columns = useMemo<ColumnsType<MetadataRowRecord>>(() => {
        const baseColumn = {
            title: "Run",
            dataIndex: "label",
            key: "metric",
            width: 150,
            fixed: "left" as const,
            render: (value: string) => (
                <Typography.Text className="font-medium text-neutral-600">{value}</Typography.Text>
            ),
        }

        const runColumns = orderedRunIds.map((runId, index) => ({
            title: <RunHeader runId={runId} index={index} />,
            dataIndex: runId,
            key: runId,
            render: (_: unknown, record: MetadataRowRecord) => (
                <record.Cell runId={runId} compareIndex={index} projectURL={projectURL} />
            ),
        }))

        return [baseColumn, ...runColumns]
    }, [orderedRunIds, projectURL])

    return (
        <Table<MetadataRowRecord>
            rowKey="key"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={dataSource}
            scroll={{x: "max-content"}}
        />
    )
}

export default memo(MetadataSummaryTable)
