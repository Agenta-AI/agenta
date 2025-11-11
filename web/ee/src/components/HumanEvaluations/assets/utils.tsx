import type {Dispatch, SetStateAction} from "react"
import dynamic from "next/dynamic"

import {GearSix} from "@phosphor-icons/react"
import {Statistic} from "antd"
import {ColumnsType} from "antd/es/table"
import uniqBy from "lodash/uniqBy"

import {calculateAvgScore} from "@/oss/lib/helpers/evaluate"
import {IScenario} from "@/oss/lib/hooks/useEvaluationRunScenarios/types"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {buildEvaluatorMetricColumns} from "@/oss/lib/metricColumnFactory"
import {getMetricConfig, metricPriority} from "@/oss/lib/metrics/utils"
import {summarizeMetric} from "@/oss/lib/metricUtils"
import {_Evaluation, EvaluationStatus} from "@/oss/lib/Types"
import {BasicStats} from "@/oss/services/runMetrics/api/types"

import UserAvatarTag from "@agenta/oss/src/components/ui/UserAvatarTag"
import VariantDetailsWithStatus from "@agenta/oss/src/components/VariantDetailsWithStatus"
import {EvaluationRow} from "../types"

import EvaluationStatusCell from "./EvaluationStatusCell"
import MetricDetailsPopover from "./MetricDetailsPopover"
import {formatMetricValue} from "./MetricDetailsPopover/assets/utils"
import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {traceDrawerJotaiStore} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {LegacyEvalResultCell, LegacyEvalResultCellTitle} from "./LegacyEvalResultCell"

const TableDropdownMenu = dynamic(() => import("./TableDropdownMenu"), {
    ssr: false,
    loading: () => <div className="w-16 h-16"></div>,
})

export const extractEvaluationStatus = (scenarios: IScenario[], status?: EvaluationStatus, evalType?: "auto" | "human") => {
    // Derive overall run status if not provided
    let derived: EvaluationStatus = EvaluationStatus.PENDING
    if (scenarios.length) {
        if (scenarios.some((s) => s.status === EvaluationStatus.FAILURE)) {
            derived = EvaluationStatus.FAILURE
        } else if (scenarios.some((s) => s.status === EvaluationStatus.ERRORS)) {
            derived = EvaluationStatus.ERROR
        } else if (scenarios.some((s) => s.status === EvaluationStatus.CANCELLED)) {
            derived = EvaluationStatus.CANCELLED
        } else if (
            scenarios.some((s) =>
                [EvaluationStatus.INCOMPLETE].includes(s.status as EvaluationStatus),
            )
        ) {
            derived = EvaluationStatus.RUNNING
        } else if (scenarios.every((s) => s.status === EvaluationStatus.SUCCESS)) {
            derived = EvaluationStatus.SUCCESS
        } else if (evalType === "auto" && scenarios.some((s) => s.status === EvaluationStatus.RUNNING)) {
            derived = EvaluationStatus.RUNNING
        } else {
            derived = EvaluationStatus.PENDING
        }
    }
    const finalStatus = scenarios.length ? derived : (status ?? derived)

    return {runStatus: finalStatus as EvaluationStatus, scenarios}
}

/**
 * Builds columns configuration for a table based on evaluator metrics.
 *
 * @param {Object} params - The parameters for configuring the columns.
 * @param {EvaluatorDto[]} params.evaluators - Evaluators data for building evaluator metric columns.
 * @param {Record<string, boolean>} params.collapsedGroups - State of collapsed groups for metric columns.
 * @param {Function} params.toggleGroup - Function to toggle the collapsed state of metric groups.
 *
 * @returns {Object} An object containing the configured columns and all metric columns.
 */

export const getEvaluatorMetricColumns = ({
    evaluations,
    runMetricsMap,
}: {
    evaluations: EvaluationRow[]
    runMetricsMap?: Record<string, Record<string, BasicStats>>
}) => {
    // Calculate how many evaluations include each evaluator so we can order
    // the columns by their popularity across runs (descending).
    const evaluatorCounts: Record<string, number> = {}
    evaluations.forEach((evaluation) => {
        evaluation.evaluators?.forEach((ev: EvaluatorDto) => {
            evaluatorCounts[ev.slug] = (evaluatorCounts[ev.slug] ?? 0) + 1
        })
    })

    // Build a unique list of evaluators and sort it by frequency. If two
    // evaluators have the same frequency, fall back to their names for a
    // deterministic ordering.
    const evaluators = uniqBy(
        evaluations.flatMap((evaluation) => evaluation.evaluators),
        "slug",
    )
        .filter(Boolean)
        .map((evaluator: EvaluatorDto) => ({
            name: evaluator?.name,
            slug: evaluator?.slug,
            metrics: evaluator?.data.service.format.properties.outputs.properties,
        }))
        .sort((a, b) => {
            const diff = (evaluatorCounts[b.slug] ?? 0) - (evaluatorCounts[a.slug] ?? 0)
            return diff !== 0 ? diff : a.name.localeCompare(b.name)
        })

    const evaluatorColumns = evaluators
        .flatMap((ev) => {
            const keys = Object.keys(ev.metrics || {})
            if (!keys.length) return []
            return [
                {
                    key: ev.slug,
                    title: ev.name ?? ev.slug,
                    children: buildEvaluatorMetricColumns({
                        evaluator: ev,
                        runMetricsMap,
                    }),
                },
            ]
        })
        .flat()

    return evaluatorColumns
}

export const getRunMetricColumns = ({
    runMetricsMap,
    runMetricKeys,
    evaluatorSlugs,
}: {
    runMetricsMap: Record<string, any>
    runMetricKeys: Set<string>
    evaluatorSlugs: Set<string>
}) => {
    const filteredRunMetricKeys = Array.from(runMetricKeys).filter((key) => {
        const dotIdx = key.indexOf(".")
        if (dotIdx === -1) return true
        const slug = key.slice(0, dotIdx)
        return !evaluatorSlugs.has(slug)
    })

    // Sort keys with shared priority helper
    filteredRunMetricKeys.sort((a, b) => {
        const [pa, sa] = metricPriority(a)
        const [pb, sb] = metricPriority(b)
        if (pa !== pb) return pa - pb
        if (sa !== sb) return sa - sb
        return a.localeCompare(b)
    })

    const runMetricChildren: ColumnsType<EvaluationRow> = filteredRunMetricKeys.map((metricKey) => {
        const {primary: primaryKey, label} = getMetricConfig(metricKey)
        return {
            title: () => <span>{label}</span>,
            key: `run__${metricKey}`,
            dataIndex: metricKey,
            onHeaderCell: () => ({style: {minWidth: 160}}),
            sorter: {
                compare: (a, b) => {
                    const aId = "id" in a ? a.id : a.key
                    const bId = "id" in b ? b.id : b.key
                    const av = runMetricsMap?.[aId]?.[metricKey]?.[primaryKey]
                    const bv = runMetricsMap?.[bId]?.[metricKey]?.[primaryKey]
                    return Number(av ?? 0) - Number(bv ?? 0)
                },
            },
            render: (_: any, record: EvaluationRow) => {
                const id = "id" in record ? record.id : record.key
                const metric = runMetricsMap?.[id]?.[metricKey] as any

                if (!metric) return "N/A"

                const displayValue = metric?.[primaryKey]
                if (displayValue == null) return "N/A"

                if (typeof metric === "object") {
                    const {[primaryKey]: _omit, ...rest} = metric
                    if (Object.keys(rest).length) {
                        return (
                            <MetricDetailsPopover
                                metricKey={metricKey}
                                primaryLabel={primaryKey}
                                primaryValue={displayValue}
                                extraDimensions={rest}
                            >
                                <span className="cursor-pointer underline underline-offset-2">
                                    {formatMetricValue(metricKey, displayValue)}
                                </span>
                            </MetricDetailsPopover>
                        )
                    }
                }
                return String(displayValue)
            },
        }
    })

    const runMetricsGroup = runMetricChildren.length
        ? [
              {
                  title: "Invocation Metrics",
                  collapsible: true,
                  children: runMetricChildren,
              },
          ]
        : []

    return runMetricsGroup
}

export const getColumns = ({
    evaluations,
    onVariantNavigation,
    setSelectedEvalRecord,
    setIsDeleteEvalModalOpen,
    runMetricsMap,
    evalType,
}: {
    evaluations: EvaluationRow[]
    onVariantNavigation: (revisionId: string) => void
    setSelectedEvalRecord: Dispatch<SetStateAction<EvaluationRow | undefined>>
    setIsDeleteEvalModalOpen: Dispatch<SetStateAction<boolean>>
    runMetricsMap?: Record<string, Record<string, BasicStats>>
    evalType?: "human" | "auto"
}): ColumnsType<EvaluationRow> => {
    const baseColumns: ColumnsType<EvaluationRow> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            fixed: "left",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_: any, record: EvaluationRow) => {
                return "name" in record ? record.name : record.key
            },
        },
        {
            title: "Variant",
            dataIndex: "variants",
            key: "variants",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_: any, record: EvaluationRow) => {
                if ("variants" in record && Array.isArray(record.variants)) {
                    return (
                        <VariantDetailsWithStatus
                            variantName={record.variants[0]?.variantName}
                            revision={record.variants[0]?.revision}
                        />
                    )
                }
                return null
            },
        },
        {
            title: "Test set",
            dataIndex: "testsetName",
            key: "testsetName",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return record.testset
                    ? record.testset.name
                    : record.testsets?.map((ts) => <span key={ts.id}>{ts.name}</span>)
            },
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            onHeaderCell: () => ({
                style: {minWidth: 180},
            }),
            render: (value, record) => {
                const isLegacy = !record?.data?.steps

                return !isLegacy ? (
                    <EvaluationStatusCell status={value} runId={record.id} evalType={evalType} />
                ) : (
                    <div className="not-available-table-cell"></div>
                )
            },
        },
        // Evaluator metric columns will be injected here dynamically below
        {
            title: "Created by",
            dataIndex: "createdBy",
            key: "createdBy",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value, record) => {
                const isLegacy = !record?.data?.steps
                return isLegacy || !value?.user?.username ? (
                    <div className="not-available-table-cell"></div>
                ) : (
                    <UserAvatarTag modifiedBy={value?.user.username} />
                )
            },
        },
        {
            title: "Created on",
            dataIndex: "createdAt",
            key: "createdAt",
            sorter: (a, b) => {
                return (a?.createdAtTimestamp ?? 0) - (b?.createdAtTimestamp ?? 0)
            },
            defaultSortOrder: "descend",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
        },
        {
            title: <GearSix size={16} />,
            key: "key",
            width: 56,
            fixed: "right",
            align: "center",
            render: (_, record) => (
                <TableDropdownMenu
                    record={record}
                    evalType={evalType}
                    setSelectedEvalRecord={setSelectedEvalRecord}
                    setIsDeleteEvalModalOpen={setIsDeleteEvalModalOpen}
                    onVariantNavigation={onVariantNavigation}
                />
            ),
        },
    ]

    const evaluatorMetricColumns = getEvaluatorMetricColumns({
        evaluations,
        runMetricsMap,
    })

    // Find index of Status column
    const statusIdx = baseColumns.findIndex((col) => col.title === "Status")

    // Build run metric columns if runMetricsMap provided
    const runMetricKeys = new Set<string>()
    if (runMetricsMap) {
        Object.values(runMetricsMap).forEach((metrics) => {
            Object.keys(metrics).forEach((k) => runMetricKeys.add(k))
        })
    }
    // Exclude evaluator metric keys of form "slug.metric" when slug matches known evaluators
    const evaluatorSlugs = new Set<string>()
    evaluations.forEach((rec) => {
        if ("evaluators" in rec && Array.isArray(rec.evaluators)) {
            rec?.evaluators?.forEach((e: any) => {
                if (e?.slug) evaluatorSlugs.add(e.slug)
            })
        }
    })

    // Count frequency of each evaluatorSlug
    const evaluatorFrequency = new Map<string, number>()

    evaluations.forEach((rec) => {
        if ("evaluators" in rec && Array.isArray(rec.evaluators)) {
            rec?.evaluators?.forEach((e: any) => {
                if (e?.slug) {
                    evaluatorFrequency.set(e.slug, (evaluatorFrequency.get(e.slug) || 0) + 1)
                }
            })
        }
    })

    const hasLegacyRun = evaluations.some((rec) => !rec?.data?.steps)
    let legacyScoreColumns: ColumnsType<EvaluationRow> = []

    if (hasLegacyRun) {
        if (evalType === "human") {
            legacyScoreColumns = [
                {
                    title: (
                        <div className="flex flex-col">
                            <span>Average score</span>
                            <span>(legacy)</span>
                        </div>
                    ),
                    dataIndex: "averageScore",
                    key: "averageScore",
                    onHeaderCell: () => ({
                        style: {minWidth: 160},
                    }),
                    render: (_, record) => {
                        const isLegacy = !record?.data?.steps
                        const score = calculateAvgScore(record)
                        return isLegacy ? (
                            <span>
                                <Statistic
                                    className="[&_.ant-statistic-content-value]:text-sm [&_.ant-statistic-content-value]:text-primary [&_.ant-statistic-content-suffix]:text-sm [&_.ant-statistic-content-suffix]:text-primary"
                                    value={score}
                                    precision={score <= 99 ? 2 : 1}
                                    suffix="%"
                                />
                            </span>
                        ) : (
                            <div className="not-available-table-cell" />
                        )
                    },
                },
            ]
        } else if (evalType === "auto") {
            const legacyAutoEvals = evaluations.filter((rec) => !rec?.data?.steps)

            const evaluators = traceDrawerJotaiStore.get(evaluatorsAtom)
            const evaluatorConfigs = uniqBy(
                legacyAutoEvals
                    ?.map((item) =>
                        item.aggregated_results?.map((item) => ({
                            ...item.evaluator_config,
                            evaluator: evaluators?.find(
                                (e) => e.key === item.evaluator_config.evaluator_key,
                            ),
                        })),
                    )
                    .flat(),
                "id",
            )

            legacyScoreColumns = [
                {
                    title: "Results",
                    key: "results",
                    align: "left",
                    collapsible: true,
                    onHeaderCell: () => ({style: {minWidth: 240}}),
                    children: evaluatorConfigs?.map((evaluator) => ({
                        title: () => <LegacyEvalResultCellTitle evaluator={evaluator} />,
                        key: evaluator?.name,
                        onHeaderCell: () => ({style: {minWidth: 240}}),
                        render: (_, record) => {
                            if (!evaluators?.length) return

                            const matchingResults = record.aggregated_results?.filter(
                                (result) => result.evaluator_config.id === evaluator?.id,
                            )

                            if (!matchingResults?.length) {
                                return null
                            }

                            return <LegacyEvalResultCell matchingResults={matchingResults} />
                        },
                    })),
                },
            ]
        }
    }

    const runMetricsGroup = getRunMetricColumns({
        runMetricsMap,
        runMetricKeys,
        evaluatorSlugs,
    })

    // Insert metric columns after Status
    if (statusIdx !== -1) {
        return [
            ...baseColumns.slice(0, statusIdx + 1),
            // ...metricColumns,
            ...evaluatorMetricColumns,
            ...legacyScoreColumns,
            ...runMetricsGroup,
            ...baseColumns.slice(statusIdx + 1),
        ]
    }
    return baseColumns
}

export const getMetricSummaryValue = (
    metric: BasicStats | undefined,
    metricType?: string,
): string | number | undefined => {
    // Delegates to central helper to keep behaviour consistent
    return summarizeMetric(metric, metricType as any)
}
