import type {Dispatch, SetStateAction} from "react"

import {MoreOutlined, RightOutlined, DownOutlined} from "@ant-design/icons"
import {Database, GearSix, Note, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Statistic} from "antd"
import {ColumnsType} from "antd/es/table"
import uniqBy from "lodash/uniqBy"
import {NextRouter} from "next/router"

import {getAppValues} from "@/oss/contexts/app.context"
import {calculateAvgScore} from "@/oss/lib/helpers/evaluate"
import {IScenario} from "@/oss/lib/hooks/useEvaluationRunScenarios/types"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {buildEvaluatorMetricColumns} from "@/oss/lib/metricColumnFactory"
import {getMetricConfig, metricPriority} from "@/oss/lib/metrics/utils"
import {summarizeMetric} from "@/oss/lib/metricUtils"
import {EvaluationStatus} from "@/oss/lib/Types"
import {BasicStats} from "@/oss/services/runMetrics/api/types"

import UserAvatarTag from "@agenta/oss/src/components/ui/UserAvatarTag"
import VariantDetailsWithStatus from "@agenta/oss/src/components/VariantDetailsWithStatus"
import {EvaluationRow} from "../types"

import EvaluationStatusCell from "./EvaluationStatusCell"
import MetricDetailsPopover from "./MetricDetailsPopover"
import {formatMetricValue} from "./MetricDetailsPopover/assets/utils"

export const extractEvaluationStatus = (scenarios: IScenario[], status?: EvaluationStatus) => {
    // Derive overall run status if not provided
    let derived: EvaluationStatus = EvaluationStatus.PENDING
    if (scenarios.length) {
        if (scenarios.some((s) => s.status === EvaluationStatus.FAILURE)) {
            derived = EvaluationStatus.FAILURE
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
    collapsedGroups,
    toggleGroup,
}: {
    evaluations: EvaluationRow[]
    runMetricsMap?: Record<string, Record<string, BasicStats>>
    collapsedGroups: Record<string, boolean>
    toggleGroup: (key: string) => void
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
            name: evaluator.name,
            slug: evaluator.slug,
            metrics: evaluator.data.service.format.properties.outputs.properties,
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
    collapsedGroups,
    toggleGroup,
}: {
    runMetricsMap: Record<string, any>
    runMetricKeys: Set<string>
    evaluatorSlugs: Set<string>
    collapsedGroups: Record<string, boolean>
    toggleGroup: (key: string) => void
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
                  title: (
                      <div className="w-full flex items-center justify-start">
                          <span
                              className="cursor-pointer flex items-center gap-1 text-left whitespace-nowrap"
                              onClick={(e) => {
                                  e.stopPropagation()
                                  toggleGroup?.("run")
                              }}
                          >
                              {collapsedGroups?.["run"] ? <RightOutlined /> : <DownOutlined />}
                              Invocation Metrics
                          </span>
                      </div>
                  ),
                  children: collapsedGroups?.["run"] ? [] : runMetricChildren,
              },
          ]
        : []

    return runMetricsGroup
}

export const getColumns = (
    mergedEvaluations: EvaluationRow[],
    router: NextRouter,
    handleNavigation: (revisionId: string) => void,
    setSelectedEvalRecord: Dispatch<SetStateAction<EvaluationRow | undefined>>,
    setIsDeleteEvalModalOpen: Dispatch<SetStateAction<boolean>>,
    runMetricsMap?: Record<string, Record<string, BasicStats>>,
    collapsedGroups?: Record<string, boolean>,
    toggleGroup?: (key: string) => void,
    classes?,
): ColumnsType<EvaluationRow> => {
    const appId = getAppValues().currentApp?.app_id

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
                return record.testset ? (
                    <div>{record.testset.name}</div>
                ) : (
                    <div>
                        {record.testsets?.map((ts) => (
                            <span key={ts.id}>{ts.name}</span>
                        ))}
                    </div>
                )
            },
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value, record) => {
                const isLegacy = !record?.data?.steps
                return !isLegacy ? (
                    <EvaluationStatusCell status={value} runId={record.id} />
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
                return isLegacy ? (
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
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "details",
                                    label: "Open details",
                                    icon: <Note size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        router.push(
                                            `/apps/${appId}/evaluations/single_model_test/${"id" in record ? record.id : record.key}`,
                                        )
                                    },
                                },
                                {
                                    key: "variant",
                                    label: "View variant",
                                    icon: <Rocket size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        handleNavigation(record.variants[0].id)
                                    },
                                },
                                {
                                    key: "view_testset",
                                    label: "View test set",
                                    icon: <Database size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        router.push(`/testsets/${record.testsets?.[0]?.id}`)
                                    },
                                },
                                {type: "divider"},
                                {
                                    key: "delete_eval",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        setSelectedEvalRecord(record)
                                        setIsDeleteEvalModalOpen(true)
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            onClick={(e) => e.stopPropagation()}
                            type="text"
                            icon={<MoreOutlined />}
                        />
                    </Dropdown>
                )
            },
        },
    ]
    const evaluatorMetricColumns = getEvaluatorMetricColumns({
        evaluations: mergedEvaluations,
        runMetricsMap,
        collapsedGroups,
        toggleGroup,
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
    mergedEvaluations.forEach((rec) => {
        if ("evaluators" in rec && Array.isArray(rec.evaluators)) {
            rec?.evaluators?.forEach((e: any) => {
                if (e?.slug) evaluatorSlugs.add(e.slug)
            })
        }
    })

    // Count frequency of each evaluatorSlug
    const evaluatorFrequency = new Map<string, number>()

    mergedEvaluations.forEach((rec) => {
        if ("evaluators" in rec && Array.isArray(rec.evaluators)) {
            rec?.evaluators?.forEach((e: any) => {
                if (e?.slug) {
                    evaluatorFrequency.set(e.slug, (evaluatorFrequency.get(e.slug) || 0) + 1)
                }
            })
        }
    })

    const hasLegacyRun = mergedEvaluations.some((rec) => !rec?.data?.steps)

    const legacyScoreColumns = hasLegacyRun
        ? [
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
                                  className={classes.stat}
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
        : []

    const runMetricsGroup = getRunMetricColumns({
        runMetricsMap,
        runMetricKeys,
        evaluatorSlugs,
        collapsedGroups,
        toggleGroup,
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
