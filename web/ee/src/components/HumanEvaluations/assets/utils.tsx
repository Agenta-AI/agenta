import type {Dispatch, SetStateAction} from "react"

import UserAvatarTag from "@agenta/oss/src/components/ui/UserAvatarTag"
import VariantDetailsWithStatus from "@agenta/oss/src/components/VariantDetailsWithStatus"
import {GearSix} from "@phosphor-icons/react"
import {Statistic} from "antd"
import {ColumnsType} from "antd/es/table"
import {getDefaultStore} from "jotai"
import uniqBy from "lodash/uniqBy"
import dynamic from "next/dynamic"

import LabelValuePill from "@/oss/components/ui/LabelValuePill"
import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {calculateAvgScore} from "@/oss/lib/helpers/evaluate"
import {IScenario} from "@/oss/lib/hooks/useEvaluationRunScenarios/types"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {buildEvaluatorMetricColumns} from "@/oss/lib/metricColumnFactory"
import {getMetricConfig, metricPriority} from "@/oss/lib/metrics/utils"
import {
    canonicalizeMetricKey,
    getMetricValueWithAliases,
    summarizeMetric,
} from "@/oss/lib/metricUtils"
import {_Evaluation, EvaluationStatus} from "@/oss/lib/Types"
import {BasicStats} from "@/oss/services/runMetrics/api/types"

import {GeneralAutoEvalMetricColumns} from "../../EvalRunDetails/components/VirtualizedScenarioTable/assets/constants"
import {extractPrimaryInvocation, extractEvaluationAppId} from "../../pages/evaluations/utils"
import {EvaluationRow} from "../types"

import EvaluationStatusCell from "./EvaluationStatusCell"
import {LegacyEvalResultCell, LegacyEvalResultCellTitle} from "./LegacyEvalResultCell"
import MetricDetailsPopover from "./MetricDetailsPopover"
import {formatMetricValue} from "./MetricDetailsPopover/assets/utils"

const TableDropdownMenu = dynamic(() => import("./TableDropdownMenu"), {
    ssr: false,
    loading: () => <div className="w-16 h-16"></div>,
})

const ALLOWED_AUTO_INVOCATION_METRIC_KEYS = new Set(
    GeneralAutoEvalMetricColumns.map((column) => canonicalizeMetricKey(column.path)),
)
const isUuidLike = (value: string | undefined): boolean => {
    if (!value) return false
    const trimmed = value.trim()
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
}

const stripVariantSuffix = (value: string | undefined): string | undefined => {
    if (!value) return undefined
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parts = trimmed.split("-")
    if (parts.length <= 1) return trimmed
    const last = parts[parts.length - 1]
    if (/^[0-9a-f]{6,}$/i.test(last)) {
        const candidate = parts.slice(0, -1).join("-")
        return candidate || trimmed
    }
    return trimmed
}

const inferAppNameFromEvaluationName = (name: unknown): string | undefined => {
    if (typeof name !== "string" || !name.trim()) return undefined
    const candidate = stripVariantSuffix(name.trim())
    if (candidate && !isUuidLike(candidate)) return candidate
    return undefined
}

const titleCase = (value: string) =>
    value
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase())

const resolveMetricStats = (
    metrics: Record<string, BasicStats> | undefined,
    candidateKeys: (string | undefined)[],
): BasicStats | undefined => {
    if (!metrics) return undefined
    for (const key of candidateKeys) {
        if (!key) continue
        if (metrics[key]) return metrics[key]
        const canonical = canonicalizeMetricKey(key)
        if (canonical !== key && metrics[canonical]) return metrics[canonical]
        const alias = getMetricValueWithAliases<BasicStats>(metrics, key)
        if (alias) return alias
    }
    return undefined
}

const labelForRunMetric = (canonicalKey: string) => {
    if (canonicalKey.startsWith("attributes.ag.data.")) {
        const tail = canonicalKey.split(".").pop() || canonicalKey
        return titleCase(tail)
    }
    const {label} = getMetricConfig(canonicalKey)
    return label
}

export const extractEvaluationStatus = (
    scenarios: IScenario[],
    status?: EvaluationStatus,
    evalType?: "auto" | "human",
) => {
    if (status === EvaluationStatus.CANCELLED) {
        return {runStatus: EvaluationStatus.CANCELLED, scenarios}
    }
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
        } else if (
            evalType === "auto" &&
            scenarios.some((s) => s.status === EvaluationStatus.RUNNING)
        ) {
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
        .map((evaluator: EvaluatorDto) => {
            const serviceFormat = (evaluator as any)?.data?.service?.format
            let metricsCandidate: Record<string, any> | undefined
            if (serviceFormat && typeof serviceFormat === "object") {
                const properties = (serviceFormat as any)?.properties
                const outputsCandidate =
                    (properties && typeof properties === "object"
                        ? (properties as any).outputs
                        : undefined) ?? (serviceFormat as any).outputs

                if (outputsCandidate && typeof outputsCandidate === "object") {
                    metricsCandidate =
                        (outputsCandidate as any).properties &&
                        typeof (outputsCandidate as any).properties === "object"
                            ? ((outputsCandidate as any).properties as Record<string, any>)
                            : (outputsCandidate as Record<string, any>)
                }
            }

            if (!metricsCandidate) {
                const fallback =
                    (evaluator as any)?.settings_values?.outputs ??
                    (evaluator as any)?.settings?.outputs ??
                    undefined
                if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
                    metricsCandidate = fallback as Record<string, any>
                }
            }

            const metrics = metricsCandidate ?? {}

            return {
                name: evaluator?.name,
                slug: evaluator?.slug,
                metrics,
            }
        })
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
                    collapsible: true,
                    children: buildEvaluatorMetricColumns({
                        evaluator: ev,
                        runMetricsMap,
                    }),
                    renderAggregatedData: ({record}) => {
                        const hasEvaluator = Array.isArray((record as any).evaluators)
                            ? (record as any).evaluators.some(
                                  (e: EvaluatorDto) => e.slug === ev.slug,
                              )
                            : false
                        if (!hasEvaluator) {
                            return <div className="not-available-table-cell" />
                        }

                        const id = "id" in record ? record.id : (record as any).key
                        const metrics = runMetricsMap?.[id]
                        if (!metrics) return <div className="not-available-table-cell" />

                        const pills = Object.keys(ev.metrics || {})
                            .map((metricKey) => {
                                const stats = resolveMetricStats(metrics, [
                                    `${ev.slug}.${metricKey}`,
                                    `${metricKey}`,
                                    `attributes.ag.data.outputs.${metricKey}`,
                                ])
                                const value = summarizeMetric(
                                    stats,
                                    (ev.metrics as any)?.[metricKey]?.type,
                                )
                                if (value == null) return null
                                return (
                                    <LabelValuePill
                                        key={metricKey}
                                        label={metricKey}
                                        value={formatMetricValue(metricKey, value)}
                                        className="!min-w-0 [&_div:first-child]:!min-w-0 [&_div:first-child]:w-fit"
                                    />
                                )
                            })
                            .filter(Boolean)

                        if (!pills.length) return <div className="not-available-table-cell" />

                        return (
                            <div className="flex flex-col items-start gap-1 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                                {pills}
                            </div>
                        )
                    },
                },
            ]
        })
        .flat()

    return evaluatorColumns
}

export const getRunMetricColumns = ({
    runMetricsMap,
    runMetricKeys,
    runMetricKeyAliases,
    runMetricFallbacks,
    evaluatorSlugs,
    evaluators,
    evalType,
}: {
    runMetricsMap: Record<string, any>
    runMetricKeys: Set<string>
    runMetricKeyAliases: Map<string, Set<string>>
    runMetricFallbacks: Map<string, Set<string>>
    evaluatorSlugs: Set<string>
    evaluators: EvaluatorDto[]
    evalType: "auto" | "human"
}) => {
    if (evalType === "auto") {
        const runMetricChildren: ColumnsType<EvaluationRow> = GeneralAutoEvalMetricColumns.map(
            (metricDef) => {
                const canonicalKey = canonicalizeMetricKey(metricDef.path)
                const aliasSet = runMetricKeyAliases.get(canonicalKey) ?? new Set<string>()
                aliasSet.add(canonicalKey)
                aliasSet.add(metricDef.path)
                const fallbackSet = runMetricFallbacks.get(canonicalKey) ?? new Set<string>()
                const aliasCandidates = Array.from(new Set([...aliasSet, ...fallbackSet]))
                const {primary: primaryKey} = getMetricConfig(canonicalKey)

                return {
                    title: () => <span>{metricDef.name}</span>,
                    key: `run__${canonicalKey}`,
                    dataIndex: canonicalKey,
                    onHeaderCell: () => ({style: {minWidth: 160}}),
                    sorter: {
                        compare: (a, b) => {
                            const aId = "id" in a ? a.id : a.key
                            const bId = "id" in b ? b.id : b.key
                            const avStats = resolveMetricStats(runMetricsMap?.[aId], [
                                canonicalKey,
                                ...aliasCandidates,
                            ])
                            const bvStats = resolveMetricStats(runMetricsMap?.[bId], [
                                canonicalKey,
                                ...aliasCandidates,
                            ])
                            const av = avStats?.[primaryKey]
                            const bv = bvStats?.[primaryKey]
                            return Number(av ?? 0) - Number(bv ?? 0)
                        },
                    },
                    render: (_: any, record: EvaluationRow) => {
                        const id = "id" in record ? record.id : record.key
                        const metric = resolveMetricStats(runMetricsMap?.[id], [
                            canonicalKey,
                            ...aliasCandidates,
                        ])

                        if (!metric) return "N/A"

                        const displayValue = metric?.[primaryKey]
                        if (displayValue == null) return "N/A"

                        if (typeof metric === "object") {
                            const {[primaryKey]: _omit, ...rest} = metric
                            if (Object.keys(rest).length) {
                                return (
                                    <MetricDetailsPopover
                                        metricKey={canonicalKey}
                                        primaryLabel={primaryKey}
                                        primaryValue={displayValue}
                                        extraDimensions={rest}
                                    >
                                        <span className="cursor-pointer underline underline-offset-2">
                                            {formatMetricValue(canonicalKey, displayValue)}
                                        </span>
                                    </MetricDetailsPopover>
                                )
                            }
                        }
                        return String(displayValue)
                    },
                }
            },
        )

        const runMetricsGroup = runMetricChildren.length
            ? [
                  {
                      title: "Invocation Metrics",
                      collapsible: true,
                      children: runMetricChildren,
                      renderAggregatedData: ({record}) => {
                          const id = "id" in record ? record.id : record.key
                          const metrics = runMetricsMap?.[id]
                          if (!metrics) return null

                          const pills = GeneralAutoEvalMetricColumns.map((metricDef) => {
                              const canonicalKey = canonicalizeMetricKey(metricDef.path)
                              const aliasSet =
                                  runMetricKeyAliases.get(canonicalKey) ?? new Set<string>()
                              aliasSet.add(canonicalKey)
                              aliasSet.add(metricDef.path)
                              const fallbackSet =
                                  runMetricFallbacks.get(canonicalKey) ?? new Set<string>()
                              const {primary: primaryKey} = getMetricConfig(canonicalKey)
                              const metric = resolveMetricStats(metrics, [
                                  canonicalKey,
                                  ...Array.from(new Set([...aliasSet, ...fallbackSet])),
                              ]) as any
                              const value = metric?.[primaryKey]
                              if (value == null) return null
                              return (
                                  <LabelValuePill
                                      key={canonicalKey}
                                      label={metricDef.name}
                                      value={formatMetricValue(canonicalKey, value)}
                                      className="!min-w-0 [&_div:first-child]:!min-w-0 [&_div:first-child]:w-fit"
                                  />
                              )
                          }).filter(Boolean) as JSX.Element[]

                          if (!pills.length) return null

                          return (
                              <div className="flex flex-col items-start gap-1 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                                  {pills as React.ReactNode[]}
                              </div>
                          )
                      },
                  },
              ]
            : []

        return runMetricsGroup
    }

    let filteredRunMetricKeys = Array.from(runMetricKeys).filter((key) => {
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
        const aliasSet = runMetricKeyAliases.get(metricKey) ?? new Set<string>([metricKey])
        const fallbackSet = runMetricFallbacks.get(metricKey) ?? new Set<string>()
        const aliasCandidates = Array.from(new Set([...aliasSet, ...fallbackSet]))
        const {primary: primaryKey} = getMetricConfig(metricKey)
        const label = labelForRunMetric(metricKey)
        return {
            title: () => <span>{label}</span>,
            key: `run__${metricKey}`,
            dataIndex: metricKey,
            onHeaderCell: () => ({style: {minWidth: 160}}),
            sorter: {
                compare: (a, b) => {
                    const aId = "id" in a ? a.id : a.key
                    const bId = "id" in b ? b.id : b.key
                    const avStats = resolveMetricStats(runMetricsMap?.[aId], [
                        metricKey,
                        ...aliasCandidates,
                    ])
                    const bvStats = resolveMetricStats(runMetricsMap?.[bId], [
                        metricKey,
                        ...aliasCandidates,
                    ])
                    const av = avStats?.[primaryKey]
                    const bv = bvStats?.[primaryKey]
                    return Number(av ?? 0) - Number(bv ?? 0)
                },
            },
            render: (_: any, record: EvaluationRow) => {
                const id = "id" in record ? record.id : record.key
                const metric = resolveMetricStats(runMetricsMap?.[id], [
                    metricKey,
                    ...aliasCandidates,
                ])

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
                  renderAggregatedData: ({record}) => {
                      const id = "id" in record ? record.id : record.key
                      const metrics = runMetricsMap?.[id]
                      if (!metrics) return null

                      const pills = filteredRunMetricKeys
                          .map((metricKey) => {
                              const aliasSet =
                                  runMetricKeyAliases.get(metricKey) ?? new Set([metricKey])
                              const fallbackSet =
                                  runMetricFallbacks.get(metricKey) ?? new Set<string>()
                              const {primary: primaryKey} = getMetricConfig(metricKey)
                              const metric = resolveMetricStats(metrics, [
                                  metricKey,
                                  ...Array.from(new Set([...aliasSet, ...fallbackSet])),
                              ]) as any
                              const value = metric?.[primaryKey]
                              if (value == null) return null
                              return (
                                  <LabelValuePill
                                      key={metricKey}
                                      label={labelForRunMetric(metricKey)}
                                      value={formatMetricValue(metricKey, value)}
                                      className="!min-w-0 [&_div:first-child]:!min-w-0 [&_div:first-child]:w-fit"
                                  />
                              )
                          })
                          .filter(Boolean)
                      if (!pills.length) return null

                      return (
                          <div className="flex flex-col items-start gap-1 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                              {pills}
                          </div>
                      )
                  },
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
    scope = "app",
    baseAppURL,
    extractAppId,
    projectURL,
    resolveAppId,
}: {
    evaluations: EvaluationRow[]
    onVariantNavigation: (params: {revisionId: string; appId?: string}) => void
    setSelectedEvalRecord: Dispatch<SetStateAction<EvaluationRow | undefined>>
    setIsDeleteEvalModalOpen: Dispatch<SetStateAction<boolean>>
    runMetricsMap?: Record<string, Record<string, BasicStats>>
    evalType?: "human" | "auto"
    scope?: "app" | "project"
    baseAppURL: string
    extractAppId: (evaluation: EvaluationRow) => string | undefined
    projectURL: string
    resolveAppId?: (evaluation: EvaluationRow) => string | undefined
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
                const primaryInvocation = extractPrimaryInvocation(record)

                if (
                    "variants" in record &&
                    Array.isArray(record.variants) &&
                    record.variants.length
                ) {
                    return (
                        <VariantDetailsWithStatus
                            variantName={record.variants[0]?.variantName}
                            revision={record.variants[0]?.revision}
                            showStable
                        />
                    )
                }

                if (primaryInvocation?.variantName) {
                    return (
                        <VariantDetailsWithStatus
                            variantName={primaryInvocation.variantName}
                            revision={primaryInvocation.revisionLabel}
                            showStable
                        />
                    )
                }

                return <span>-</span>
            },
        },
        {
            title: "Testset",
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
                    baseAppURL={baseAppURL}
                    extractAppId={extractAppId}
                    scope={scope}
                    projectURL={projectURL}
                    resolveAppId={resolveAppId}
                />
            ),
        },
    ]

    if (scope === "project") {
        baseColumns.splice(1, 0, {
            title: "Application",
            dataIndex: "application",
            key: "application",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_: any, record: EvaluationRow) => {
                const primaryInvocation = extractPrimaryInvocation(record)
                const fallbackVariant = Array.isArray((record as any)?.variants)
                    ? (record as any)?.variants?.[0]
                    : undefined
                const variantAppName =
                    fallbackVariant?.appName ||
                    fallbackVariant?.appSlug ||
                    (typeof fallbackVariant?.app_id === "string"
                        ? fallbackVariant.app_id
                        : undefined)
                const derivedAppId = extractEvaluationAppId(record)
                const strippedPrimaryVariantName = stripVariantSuffix(
                    primaryInvocation?.variantName,
                )
                const strippedFallbackVariantName = stripVariantSuffix(fallbackVariant?.variantName)

                const isAutoEval = evalType === "auto"

                const candidates = isAutoEval
                    ? [
                          (record as any)?.appName,
                          primaryInvocation?.appName,
                          variantAppName,
                          strippedPrimaryVariantName,
                          strippedFallbackVariantName,
                          inferAppNameFromEvaluationName((record as any)?.name),
                          derivedAppId,
                      ]
                    : [(record as any)?.appName, primaryInvocation?.appName, variantAppName]

                const appName = candidates.find((value) => {
                    if (typeof value !== "string") return false
                    const trimmed = value.trim()
                    if (!trimmed) return false
                    return !isUuidLike(trimmed)
                })

                if (appName) return appName
                if (isAutoEval && derivedAppId) return derivedAppId
                return "-"
            },
        })
    }

    const evaluatorMetricColumns = getEvaluatorMetricColumns({
        evaluations,
        runMetricsMap,
    })

    // Find index of Status column
    const statusIdx = baseColumns.findIndex((col) => col.title === "Status")

    // Build run metric columns if runMetricsMap provided
    const runMetricKeyAliases = new Map<string, Set<string>>()
    const runMetricFallbacks = new Map<string, Set<string>>()
    if (runMetricsMap) {
        Object.values(runMetricsMap).forEach((metrics) => {
            Object.keys(metrics || {}).forEach((rawKey) => {
                const canonical = canonicalizeMetricKey(rawKey)
                if (!runMetricKeyAliases.has(canonical)) {
                    runMetricKeyAliases.set(canonical, new Set([canonical]))
                }
                runMetricKeyAliases.get(canonical)!.add(rawKey)

                if (rawKey.startsWith("attributes.ag.data.outputs.") && canonical !== rawKey) {
                    const legacyKey = rawKey.split(".").slice(-1)[0]
                    if (legacyKey) {
                        if (!runMetricFallbacks.has(canonical)) {
                            runMetricFallbacks.set(canonical, new Set())
                        }
                        runMetricFallbacks.get(canonical)!.add(legacyKey)
                    }
                }
            })
        })
    }
    const runMetricKeys = new Set<string>(runMetricKeyAliases.keys())
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

            const evaluators = getDefaultStore().get(evaluatorsAtom)
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
        runMetricsMap: runMetricsMap ?? {},
        runMetricKeys,
        runMetricKeyAliases,
        runMetricFallbacks,
        evaluatorSlugs,
        evaluators: evaluations.flatMap((e) => e.evaluators),
        evalType,
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
