import {memo, useMemo, type ReactNode} from "react"

import {useAtomValue} from "jotai"

import {formatColumnTitle} from "@/oss/components/Filters/EditColumns/assets/helper"
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import LabelValuePill from "@/oss/components/ui/LabelValuePill"
import {
    SchemaMetricType,
    canonicalizeMetricKey,
    extractPrimitive,
    getMetricValueWithAliases,
    summarizeMetric,
} from "@/oss/lib/metricUtils"

import {scenarioMetricSelectorFamily} from "../../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {TableColumn} from "../../types"
import {CellWrapper} from "../CellComponents"

export interface CollapsedMetricValueCellProps {
    scenarioId: string
    evaluatorSlug?: string
    runId: string
    childrenDefs?: TableColumn[]
}

interface PillEntry {
    label: string
    value: string
}

const includesBooleanType = (metricType?: SchemaMetricType): boolean => {
    if (!metricType) return false
    return Array.isArray(metricType) ? metricType.includes("boolean") : metricType === "boolean"
}

const flattenColumns = (columns?: TableColumn[]): TableColumn[] => {
    if (!columns?.length) return []
    const queue = [...columns]
    const leaves: TableColumn[] = []

    while (queue.length) {
        const column = queue.shift()
        if (!column) continue
        if (column.children && column.children.length) {
            queue.push(...column.children)
        } else {
            leaves.push(column)
        }
    }

    return leaves
}

const toBooleanString = (value: unknown): string | undefined => {
    if (typeof value === "boolean") return value ? "true" : "false"
    if (typeof value === "number") {
        if (value === 1) return "true"
        if (value === 0) return "false"
    }
    if (typeof value === "string") {
        const trimmed = value.trim().toLowerCase()
        if (trimmed === "true" || trimmed === "false") return trimmed
        if (trimmed === "1") return "true"
        if (trimmed === "0") return "false"
    }
    return undefined
}

const extractBooleanFromStats = (value: any): string | undefined => {
    if (!value || typeof value !== "object") return undefined
    const candidates: unknown[] = []
    if (Array.isArray(value.rank) && value.rank.length) {
        candidates.push(value.rank[0]?.value)
    }
    if (Array.isArray(value.frequency) && value.frequency.length) {
        candidates.push(value.frequency[0]?.value)
    }
    if ("mean" in value) candidates.push(value.mean)
    if ("sum" in value) candidates.push(value.sum)
    if ("value" in value) candidates.push((value as any).value)

    for (const candidate of candidates) {
        const boolString = toBooleanString(candidate)
        if (boolString) return boolString
    }
    return undefined
}

const resolveBooleanDisplay = ({
    summarized,
    rawValue,
    metricType,
}: {
    summarized: unknown
    rawValue: unknown
    metricType?: SchemaMetricType
}): string | undefined => {
    const preferBoolean = includesBooleanType(metricType)
    if (preferBoolean) {
        const summaryBool = toBooleanString(summarized)
        if (summaryBool) return summaryBool
        const rawBool =
            toBooleanString(rawValue) ||
            (typeof rawValue === "object" ? extractBooleanFromStats(rawValue) : undefined)
        if (rawBool) return rawBool
    } else {
        const rawBool =
            toBooleanString(rawValue) ||
            (typeof rawValue === "object" ? extractBooleanFromStats(rawValue) : undefined)
        if (rawBool) return rawBool
        const summaryBool = toBooleanString(summarized)
        if (summaryBool) return summaryBool
    }
    return undefined
}

const summariseMetricValue = (value: unknown, metricType?: SchemaMetricType) => {
    if (value === null || value === undefined) return undefined

    if (typeof value === "object" && !Array.isArray(value)) {
        const summary = summarizeMetric(value as any, metricType)
        if (summary !== undefined) return summary

        const primitive = extractPrimitive(value)
        if (primitive !== undefined) return primitive
    }

    return value
}

const buildCandidateKeys = (column: TableColumn, evaluatorSlug?: string): string[] => {
    const keys = new Set<string>()
    const addKey = (key?: string) => {
        if (!key) return
        if (!keys.has(key)) keys.add(key)
        const canonical = canonicalizeMetricKey(key)
        if (canonical !== key && !keys.has(canonical)) {
            keys.add(canonical)
        }
    }

    addKey(column.path)
    addKey(column.fallbackPath)
    if (typeof column.key === "string") addKey(column.key)

    if (column.path?.includes(".")) {
        const tail = column.path.split(".").pop()
        if (tail) addKey(tail)
    }

    if (evaluatorSlug) {
        const ensurePrefixed = (raw?: string) => {
            if (!raw) return
            if (raw.startsWith(`${evaluatorSlug}.`)) {
                addKey(raw)
            } else {
                addKey(`${evaluatorSlug}.${raw}`)
            }
        }

        ensurePrefixed(column.path)
        ensurePrefixed(column.fallbackPath)
        if (typeof column.key === "string") ensurePrefixed(column.key)
    }

    return Array.from(keys).filter(Boolean)
}

const buildLabel = (column: TableColumn) => {
    const raw =
        (typeof column.title === "string" && column.title.trim()) ||
        (typeof column.name === "string" && column.name.trim()) ||
        column.path?.split(".").pop() ||
        (typeof column.key === "string" ? column.key : "") ||
        ""

    const base = raw || "Metric"
    return /\s/.test(base) || base.includes("(") ? base : formatColumnTitle(base)
}

const buildCollapsedPills = ({
    rowMetrics,
    childrenDefs,
    evaluatorSlug,
}: {
    rowMetrics: Record<string, any>
    childrenDefs?: TableColumn[]
    evaluatorSlug?: string
}): PillEntry[] => {
    if (!rowMetrics || typeof rowMetrics !== "object") return []

    const leaves = flattenColumns(childrenDefs)
    if (!leaves.length) return []

    const seenLabels = new Set<string>()
    const result: PillEntry[] = []

    leaves.forEach((column) => {
        const candidateKeys = buildCandidateKeys(column, evaluatorSlug)
        let rawValue: unknown
        let resolvedKey: string | undefined

        for (const key of candidateKeys) {
            if (!key) continue
            if (rowMetrics[key] !== undefined) {
                rawValue = rowMetrics[key]
                resolvedKey = key
                break
            }
            const alias = getMetricValueWithAliases(rowMetrics, key)
            if (alias !== undefined) {
                rawValue = alias
                resolvedKey = key
                break
            }
        }

        if (rawValue === undefined) return

        const summarized = summariseMetricValue(rawValue, column.metricType)
        if (summarized === undefined || summarized === null) return

        const canonicalKey = canonicalizeMetricKey(resolvedKey ?? column.path ?? column.key ?? "")
        const label = buildLabel(column)
        if (!label.trim() || seenLabels.has(label)) return
        const booleanDisplay = resolveBooleanDisplay({
            summarized,
            rawValue,
            metricType: column.metricType,
        })

        const value =
            booleanDisplay ??
            (typeof summarized === "number"
                ? formatMetricValue(canonicalKey, summarized)
                : String(summarized))

        seenLabels.add(label)
        result.push({label, value})
    })

    return result
}

interface BaseCellProps extends CollapsedMetricValueCellProps {
    emptyState: ReactNode
}

const BaseCollapsedMetricValueCell = ({
    scenarioId,
    evaluatorSlug,
    runId,
    childrenDefs,
    emptyState,
}: BaseCellProps) => {
    const rowMetrics = useAtomValue(scenarioMetricSelectorFamily({runId, scenarioId})) || {}

    const pillEntries = useMemo(
        () =>
            buildCollapsedPills({
                rowMetrics,
                childrenDefs,
                evaluatorSlug,
            }),
        [rowMetrics, childrenDefs, evaluatorSlug],
    )

    if (!pillEntries.length) {
        return (
            <CellWrapper>
                {typeof emptyState === "string" ? (
                    <span className="text-gray-500">{emptyState}</span>
                ) : (
                    emptyState
                )}
            </CellWrapper>
        )
    }

    return (
        <CellWrapper>
            <div className="flex flex-col items-start gap-1 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                {pillEntries.map(({label, value}) => (
                    <LabelValuePill
                        key={`${label}-${value}`}
                        label={label}
                        value={value}
                        className="!min-w-0 [&_div:first-child]:!min-w-0 [&_div:first-child]:w-fit"
                    />
                ))}
            </div>
        </CellWrapper>
    )
}

const CollapsedMetricValueCell = memo<CollapsedMetricValueCellProps>((props) => (
    <BaseCollapsedMetricValueCell {...props} emptyState="–" />
))

export const AutoEvalCollapsedMetricValueCell = memo<CollapsedMetricValueCellProps>((props) => (
    <BaseCollapsedMetricValueCell
        {...props}
        emptyState={<div className="not-available-table-cell" />}
    />
))

export default CollapsedMetricValueCell
