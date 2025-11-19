import {memo, useEffect, useMemo, type ReactNode} from "react"

import {Typography} from "antd"
import {useSetAtomWithSchedule, LOW_PRIORITY} from "jotai-scheduler"

import EvaluatorMetricBar from "@/oss/components/HumanEvaluations/assets/EvaluatorMetricBar"
import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import {resolvedMetricLabelsAtomFamily} from "@/oss/components/References/atoms/resolvedMetricLabels"
import {humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"
import {type BasicStats} from "@/oss/lib/metricUtils"

import {
    buildFrequencyEntries,
    formatEvaluatorMetricValue,
    formatInvocationMetricValue,
    formatPercent,
} from "../../../../../lib/runMetrics/formatters"
import useRunMetricSelection from "../../../hooks/useRunMetricSelection"
import type {EvaluationRunTableRow} from "../../../types"
import type {RunMetricDescriptor} from "../../../types/runMetrics"
import MetricValueWithPopover from "../../common/MetricValueWithPopover"

const RunMetricCellSkeleton = () => <SkeletonLine width="55%" />

const OUTPUT_METRIC_PATH_PREFIX = /^attributes\.ag\.data\.outputs\.?/i

const stripOutputsNamespace = (value?: string | null) => {
    if (!value) return null
    const stripped = value.replace(OUTPUT_METRIC_PATH_PREFIX, "")
    return stripped.length ? stripped : "output"
}

const RunMetricCellContent = memo(
    ({
        record,
        descriptor,
        isVisible = true,
    }: {
        record: EvaluationRunTableRow
        descriptor: RunMetricDescriptor
        isVisible?: boolean
    }) => {
        // console.log("RunMetricCellContent")
        const rawRunId = record.preview?.id ?? record.runId ?? null
        const runId = typeof rawRunId === "string" && rawRunId.trim().length > 0 ? rawRunId : null
        const runScopedMetricPath = runId ? descriptor.metricPathsByRunId?.[runId] : undefined
        const runScopedStepKey = runId ? descriptor.stepKeysByRunId?.[runId] : undefined

        const metricPathForSelection =
            descriptor.kind === "evaluator"
                ? runScopedMetricPath
                : (runScopedMetricPath ?? descriptor.metricPath)

        const stepKeyForSelection =
            descriptor.kind === "evaluator"
                ? runScopedStepKey
                : (runScopedStepKey ?? descriptor.stepKey)

        const metricKeyForSelection =
            descriptor.kind === "evaluator" &&
            (descriptor.metricPathsByRunId || descriptor.stepKeysByRunId) &&
            !metricPathForSelection &&
            !stepKeyForSelection
                ? undefined
                : descriptor.metricKey

        const selection = useRunMetricSelection(
            {
                runId,
                metricKey: metricKeyForSelection,
                metricPath: metricPathForSelection,
                stepKey: stepKeyForSelection,
            },
            {
                enabled: Boolean(isVisible),
            },
        )

        const resolvedLabelAtom = useMemo(
            () => resolvedMetricLabelsAtomFamily(descriptor.id),
            [descriptor.id],
        )
        const setResolvedLabel = useSetAtomWithSchedule(resolvedLabelAtom, {
            priority: LOW_PRIORITY,
        })

        const isGenericOutputsMetric =
            descriptor.kind === "evaluator" &&
            descriptor.metricPath?.startsWith("attributes.ag.data.outputs") &&
            descriptor.metricPath?.endsWith(".outputs")

        useEffect(() => {
            if (!isGenericOutputsMetric) return
            if (selection.state !== "hasData") return
            const resolvedKey = selection.resolvedKey
            if (!resolvedKey) return
            const label = humanizeMetricPath(stripOutputsNamespace(resolvedKey) ?? resolvedKey)
            setResolvedLabel((prev) => (prev === label ? prev : label))
        }, [isGenericOutputsMetric, selection.state, selection.resolvedKey, setResolvedLabel])

        // const resolvedPathsAtom = useMemo(
        //     () => resolvedMetricPathsAtomFamily(descriptor.id),
        //     [descriptor.id],
        // )
        // const setResolvedPaths = useSetAtom(resolvedPathsAtom)

        // useEffect(() => {
        //     if (!runId) return
        //     if (selection.state !== "hasData") return
        //     const resolvedKey = selection.resolvedKey
        //     if (!resolvedKey) return
        //     setResolvedPaths((prev) => {
        //         if (prev[runId] === resolvedKey) {
        //             return prev
        //         }
        //         return {...prev, [runId]: resolvedKey}
        //     })
        // }, [runId, selection.state, selection.resolvedKey, setResolvedPaths])

        if (!runId) {
            return <Typography.Text>—</Typography.Text>
        }

        if (selection.state === "loading") {
            return <RunMetricCellSkeleton />
        }
        if (selection.state === "hasError") {
            return <Typography.Text type="secondary">—</Typography.Text>
        }

        const stats = selection.stats as BasicStats | undefined
        const isUnavailable =
            descriptor.kind === "evaluator" &&
            (descriptor.metricPathsByRunId || descriptor.stepKeysByRunId) &&
            !metricPathForSelection &&
            !stepKeyForSelection

        let display =
            descriptor.kind === "invocation"
                ? formatInvocationMetricValue(
                      metricPathForSelection ?? descriptor.metricPath ?? "",
                      stats,
                  )
                : formatEvaluatorMetricValue(stats, metricPathForSelection)

        let highlight: ReactNode = display
        let fallback: ReactNode = stats ?? display
        let customChildren: ReactNode | undefined

        if (isUnavailable) {
            display = ""
            highlight = display
            fallback = undefined
        }

        if (descriptor.kind === "evaluator" && !isUnavailable) {
            const frequencyEntries = buildFrequencyEntries(stats)
            if (frequencyEntries.length > 0) {
                const total = frequencyEntries.reduce((acc, entry) => acc + entry.count, 0)
                if (total > 0) {
                    const normalized = frequencyEntries.map((entry) => ({
                        label: entry.label,
                        percent: entry.count / total,
                    }))
                    customChildren = (
                        <EvaluatorMetricBar
                            segments={frequencyEntries.map((entry) => ({
                                label: entry.label,
                                value: entry.count,
                            }))}
                        />
                    )
                    display = `${normalized[0]?.label ?? ""} ${formatPercent(normalized[0]?.percent ?? 0)}`
                    highlight = display
                    fallback = stats ?? normalized
                }
            }
        }

        const className = isUnavailable ? "not-available-table-cell" : undefined
        const exportDisplay =
            typeof display === "string" && display.trim().length > 0 ? display : "—"

        return (
            <MetricValueWithPopover
                runId={runId}
                metricKey={descriptor.metricKey}
                metricPath={metricPathForSelection ?? descriptor.metricPath}
                metricLabel={descriptor.label}
                stepKey={stepKeyForSelection ?? descriptor.stepKey}
                stepType={
                    descriptor.kind === "invocation"
                        ? "invocation"
                        : descriptor.kind === "evaluator"
                          ? "annotation"
                          : undefined
                }
                highlightValue={highlight}
                fallbackValue={fallback}
                display={display}
                isPlaceholder={display === "" || display === "—"}
                showScenarioValue={false}
                className={className}
                disablePopover={isUnavailable}
                children={customChildren}
            />
        )
    },
)

export {RunMetricCellSkeleton, RunMetricCellContent}
