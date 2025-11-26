import {memo, useMemo, type ReactNode} from "react"

import {Table, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"
import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import EvalNameTag from "@/oss/components/EvalRunDetails/AutoEvalRun/assets/EvalNameTag"
import {
    EVAL_BG_COLOR,
    EVAL_TAG_COLOR,
} from "@/oss/components/EvalRunDetails/AutoEvalRun/assets/utils"
import RenameEvalButton from "@/oss/components/EvalRunDetails/HumanEvalRun/components/Modals/RenameEvalModal/assets/RenameEvalButton"
import {previewRunMetricStatsSelectorFamily} from "@/oss/components/evaluations/atoms/runMetrics"
import {
    ApplicationReferenceLabel,
    TestsetTagList,
    VariantReferenceLabel,
} from "@/oss/components/References"
import useEvaluatorReference from "@/oss/components/References/hooks/useEvaluatorReference"
import {RunIdProvider} from "@/oss/contexts/RunIdContext"
import type {BasicStats} from "@/oss/lib/metricUtils"
import {projectIdAtom, useProjectData} from "@/oss/state/project"

import {evaluationQueryRevisionAtomFamily} from "../../../../atoms/query"
import {
    runCreatedAtAtomFamily,
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
    runUpdatedAtAtomFamily,
} from "../../../../atoms/runDerived"
import {
    evaluationRunIndexAtomFamily,
    evaluationRunQueryAtomFamily,
} from "../../../../atoms/table/run"
import type {
    QueryConditionPayload,
    QueryFilteringPayload,
} from "../../../../services/onlineEvaluations/api"
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
    label: ReactNode
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

const useRunDetails = (runId: string) => {
    const runAtom = useMemo(() => evaluationRunQueryAtomFamily(runId), [runId])
    return useAtomValueWithSchedule(runAtom, {priority: LOW_PRIORITY})
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
    <div className="inline-flex">
        <ApplicationReferenceLabel runId={runId} projectURL={projectURL} />
    </div>
)

const LegacyVariantCell = memo(({runId}: MetadataCellProps) => (
    <div className="inline-flex">
        <VariantReferenceLabel runId={runId} />
    </div>
))

const MetadataRunNameCell = memo(({runId, compareIndex}: MetadataCellProps) => {
    const runQuery = useRunDetails(runId)
    const runData = runQuery?.data?.camelRun ?? runQuery?.data?.rawRun ?? null
    const isLoading = runQuery?.isPending && !runData
    if (isLoading) {
        return <Typography.Text type="secondary">…</Typography.Text>
    }
    if (!runData) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }
    const color = EVAL_TAG_COLOR?.[compareIndex + 1]
    return (
        <RunIdProvider runId={runId}>
            <div className="group flex items-center justify-between gap-2 w-full">
                <EvalNameTag run={runData} color={color} />
                <span className="opacity-0 transition-opacity group-hover:opacity-100">
                    <RenameEvalButton
                        id={runId}
                        runId={runId}
                        name={runData?.name ?? undefined}
                        description={(runData as any)?.description ?? undefined}
                        type="text"
                        size="small"
                    />
                </span>
            </div>
        </RunIdProvider>
    )
})

const LegacyTestsetsCell = memo(({runId, projectURL}: MetadataCellProps) => {
    const testsetAtom = useMemo(() => runTestsetIdsAtomFamily(runId), [runId])
    const testsetIds = useAtomValueWithSchedule(testsetAtom, {priority: LOW_PRIORITY}) ?? []
    return <TestsetTagList ids={testsetIds} projectURL={projectURL ?? undefined} runId={runId} />
})

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
    {key: "evaluations", label: "Evaluations", Cell: MetadataRunNameCell},
    {key: "created", label: "Created at", Cell: CreatedCell},
    {key: "updated", label: "Updated at", Cell: UpdatedCell},
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
        Cell: LegacyVariantCell,
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
        Cell: LegacyTestsetsCell,
        shouldDisplay: ({snapshots}) =>
            snapshots.some(({testsetIds}) => (testsetIds?.length ?? 0) > 0),
    },
    // {key: "scenarios", label: "Scenarios evaluated", Cell: ScenarioCountCell},
    {key: "invocation_cost", label: "Cost (Total)", Cell: InvocationCostCell},
    {key: "invocation_duration", label: "Duration (Total)", Cell: InvocationDurationCell},
    {key: "invocation_tokens", label: "Tokens (Total)", Cell: InvocationTokensCell},
    {key: "invocation_errors", label: "Errors", Cell: InvocationErrorsCell},
]

const EvaluatorNameLabel = ({evaluatorId}: {evaluatorId: string}) => {
    const projectId = useProjectData()?.projectId
    const x = useEvaluatorReference({evaluatorId, projectId})
    console.log("EvaluatorNameLabel", {x, evaluatorId})
    return x?.reference?.name ?? "--"
}

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

        const rows: {record: MetadataRowRecord; sortKey: string}[] = []

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

            const baseStats = baseSelection.stats as BasicStats | undefined
            const hasMeanValue = typeof baseStats?.mean === "number"

            rows.push({
                sortKey: `${evaluatorLabel}:${metric.displayLabel}`,
                record: {
                    key: metric.id,
                    label: (
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[#586673]">
                                <EvaluatorNameLabel evaluatorId={metric.evaluatorRef?.id} />{" "}
                            </span>
                            <div className="flex items-center gap-2">
                                <span>{metric.displayLabel}</span>
                                {hasMeanValue ? (
                                    <span className="text-[#586673]">(mean)</span>
                                ) : null}
                            </div>
                        </div>
                    ),
                    Cell: EvaluatorMetricCell,
                },
            })
        })

        rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

        return rows.map(({record}) => record)
    }, [metricSelections, rowContext])

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
            base.splice(3, 0, {
                key: "query_config",
                label: "Filters / Queries",
                Cell: QuerySummaryCell,
            })
        }
        const rows = [...base, ...evaluatorMetricRows]
            .filter((row) => (row.shouldDisplay ? row.shouldDisplay(rowContext) : true))
            .map((row) => ({key: row.key, label: row.label, Cell: row.Cell}))
        return rows
    }, [anyHasQuery, evaluatorMetricRows, rowContext])

    const isComparison = orderedRunIds.length > 1

    const columns = useMemo<ColumnsType<MetadataRowRecord>>(() => {
        const baseColumn = {
            title: null,
            dataIndex: "label",
            key: "metric",
            width: 180,
            fixed: "left" as const,
            render: (value: ReactNode) => (
                <div className="text-[#586673] font-medium leading-snug">{value}</div>
            ),
        }

        const runColumns = orderedRunIds.map((runId, index) => ({
            title: null,
            dataIndex: runId,
            key: runId,
            width: 160,
            onCell: (record: MetadataRowRecord) => {
                if (!isComparison || record.key === "query_config" || record.key === "testsets") {
                    return {}
                }
                const tone = (EVAL_BG_COLOR as Record<number, string>)[index + 1]
                return tone ? {style: {backgroundColor: tone}} : {}
            },
            render: (_: unknown, record: MetadataRowRecord) => (
                <record.Cell runId={runId} compareIndex={index} projectURL={projectURL} />
            ),
        }))

        return [baseColumn, ...runColumns]
    }, [isComparison, orderedRunIds, projectURL])

    return (
        <div className="border border-solid border-[#EAEFF5] rounded h-full">
            <div className="py-2 px-3 flex flex-col justify-center border-0 border-b border-solid border-[#EAEFF5]">
                <Typography.Text className="font-medium">Evaluator Scores Overview</Typography.Text>
                <Typography.Text className="text-[#758391]">
                    Average evaluator score across evaluations
                </Typography.Text>
            </div>
            <div className="p-2 w-full flex gap-2 shrink-0">
                <div className="w-full overflow-y-auto">
                    <Table<MetadataRowRecord>
                        className="metadata-summary-table"
                        rowKey="key"
                        size="small"
                        pagination={false}
                        columns={columns}
                        dataSource={dataSource}
                        scroll={{x: "max-content"}}
                        showHeader={false}
                    />
                </div>
            </div>
        </div>
    )
}

export default memo(MetadataSummaryTable)
