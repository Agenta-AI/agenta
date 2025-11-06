import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import SimpleSharedEditor from "@agenta/oss/src/components/EditorViews/SimpleSharedEditor"
import VirtualizedSharedEditors from "@agenta/oss/src/components/EditorViews/VirtualizedSharedEditors"
import {Collapse, CollapseProps, Tag, Tooltip} from "antd"
import clsx from "clsx"
import {atom, getDefaultStore, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {renderChatMessages} from "@/oss/components/EvalRunDetails/assets/renderChatMessages"
import {STATUS_COLOR} from "@/oss/components/EvalRunDetails/components/EvalRunScenarioStatusTag/assets"
import {
    GeneralAutoEvalMetricColumns,
    GeneralHumanEvalMetricColumns,
} from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/assets/constants"
import {titleCase} from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/assets/flatDataSourceBuilder"
import ScenarioTraceSummary from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/assets/ScenarioTraceSummary"
import {comparisonRunsStepsAtom} from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/hooks/useExpandableComparisonDataSource"
import {useCachedScenarioSteps} from "@/oss/components/EvalRunDetails/hooks/useCachedScenarioSteps"
import {useMetricStepError} from "@/oss/components/EvalRunDetails/hooks/useMetricStepError"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {focusScenarioAtom} from "@/oss/components/EvalRunDetails/state/focusScenarioAtom"
import {urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"
import MetricDetailsPopover from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover"
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import {getStatusLabel} from "@/oss/lib/constants/statusLabels"
import {
    evaluationRunStateFamily,
    runMetricsStatsCacheFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {runScopedMetricDataFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {scenarioMetricSelectorFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {UseEvaluationRunScenarioStepsFetcherResult} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"
import {
    canonicalizeMetricKey,
    getMetricValueWithAliases,
    inferMetricType,
} from "@/oss/lib/metricUtils"
import {EvaluationStatus} from "@/oss/lib/Types"
import {useAppState} from "@/oss/state/appState"

import FocusDrawerContentSkeleton from "../Skeletons/FocusDrawerContentSkeleton"

import RunOutput, {fallbackPrimitive, resolveOnlineOutput} from "./assets/RunOutput"
import RunTraceHeader from "./assets/RunTraceHeader"
import {
    getFromAnnotationOutputs,
    resolveEvaluatorMetricsMap,
    SCENARIO_METRIC_ALIASES,
    asEvaluatorArray,
    extractEvaluatorSlug,
    extractEvaluatorName,
    findAnnotationStepKey,
    collectSlugCandidates,
    collectEvaluatorIdentifiers,
    pickString,
    buildDrawerMetricDefinition,
} from "./lib/helpers"

const EMPTY_COMPARISON_RUN_IDS: string[] = []

type EvaluatorFailure = {status?: string; error?: string} | null

const FOCUS_DRAWER_DEBUG = true

const emptyScenarioMetricsAtom = atom<Record<string, any> | undefined>(undefined)
const emptyStatsAtom = atom<Record<string, any> | undefined>(undefined)
const emptyMetricDataAtom = atom<{value: any; distInfo?: any}>({
    value: undefined,
    distInfo: undefined,
})

export interface DrawerMetricValueCellProps {
    runId: string
    scenarioId?: string
    evaluatorSlug: string
    metricName: string
    metricKey?: string
    fallbackKeys?: string[]
    invocationStepKey?: string
    scenarioStepsResult?: {
        data?: UseEvaluationRunScenarioStepsFetcherResult
        state?: ReturnType<typeof useCachedScenarioSteps>["state"]
        hasResolved?: boolean
        error?: unknown
    }
    context?: EvaluatorContext
    suppressFailure?: boolean
}

interface EvaluatorContext {
    slugCandidates: string[]
    annotationStepKey?: string
    errorStep?: EvaluatorFailure
}

export interface DrawerEvaluatorMetric {
    id: string
    displayName: string
    metricKey?: string
    fallbackKeys?: string[]
}

const EvaluatorFailureDisplay = ({
    status,
    error,
    editorKey,
}: {
    status?: string
    error?: string
    editorKey: string
}) => {
    const tooltipContent =
        typeof error === "string" && error.length
            ? error
            : "Evaluator returned an error for this metric."

    const tagColor =
        status && Object.prototype.hasOwnProperty.call(STATUS_COLOR, status)
            ? (STATUS_COLOR as Record<string, string>)[status]
            : STATUS_COLOR[EvaluationStatus.ERROR]

    const isLongError = tooltipContent.length > 200 || /\n/.test(tooltipContent)

    return (
        <div className="flex w-full flex-col gap-2">
            <Tooltip
                title={<span className="whitespace-pre-wrap">{tooltipContent}</span>}
                classNames={{body: "max-w-[320px] max-h-[320px] overflow-y-auto"}}
            >
                <Tag color={tagColor} bordered={false}>
                    {getStatusLabel(status || EvaluationStatus.ERROR)}
                </Tag>
            </Tooltip>
            {isLongError ? (
                <SimpleSharedEditor
                    key={editorKey}
                    handleChange={() => {}}
                    initialValue={tooltipContent}
                    editorType="borderless"
                    state="readOnly"
                    disabled
                    readOnly
                    editorClassName="!text-xs"
                    placeholder="N/A"
                    className="!w-[97.5%]"
                />
            ) : (
                <div className="rounded-md bg-[#FEF3F2] px-3 py-2 text-xs text-[#A8071A]">
                    {tooltipContent}
                </div>
            )}
        </div>
    )
}

const DrawerMetricValueCell = ({
    runId,
    scenarioId,
    evaluatorSlug,
    metricName,
    metricKey,
    fallbackKeys,
    invocationStepKey,
    scenarioStepsResult,
    context,
    suppressFailure,
}: DrawerMetricValueCellProps) => {
    const fallbackSlugCandidates = useMemo(
        () => collectSlugCandidates(scenarioStepsResult?.data, evaluatorSlug),
        [scenarioStepsResult?.data, evaluatorSlug],
    )

    const slugCandidates = context?.slugCandidates ?? fallbackSlugCandidates

    const fallbackAnnotationStepKey = useMemo(() => {
        if (context?.annotationStepKey !== undefined) return undefined
        return findAnnotationStepKey(scenarioStepsResult?.data, slugCandidates)
    }, [context?.annotationStepKey, scenarioStepsResult?.data, slugCandidates])

    const annotationStepKey = context?.annotationStepKey ?? fallbackAnnotationStepKey

    const stepSlug = invocationStepKey ?? undefined

    const normalizedPrimaryKey = useMemo(() => {
        const trimmedMetricKey = typeof metricKey === "string" ? metricKey.trim() : ""
        if (trimmedMetricKey.length > 0) {
            return trimmedMetricKey.includes(".")
                ? trimmedMetricKey
                : `${evaluatorSlug}.${trimmedMetricKey}`
        }
        const trimmedMetricName = typeof metricName === "string" ? metricName.trim() : ""
        if (trimmedMetricName.length === 0) {
            return evaluatorSlug
        }
        if (trimmedMetricName.includes(".")) {
            return trimmedMetricName
        }
        return `${evaluatorSlug}.${trimmedMetricName}`
    }, [metricKey, metricName, evaluatorSlug])

    const normalizedFallbackKeys = useMemo(() => {
        if (!fallbackKeys || fallbackKeys.length === 0) return []
        return fallbackKeys
            .map((key) => {
                if (!key) return undefined
                const trimmed = String(key).trim()
                if (!trimmed) return undefined
                return trimmed.includes(".") ? trimmed : `${evaluatorSlug}.${trimmed}`
            })
            .filter(Boolean) as string[]
    }, [fallbackKeys, evaluatorSlug])

    const barePrimaryKey = useMemo(() => {
        const prefix = `${evaluatorSlug}.`
        return normalizedPrimaryKey.startsWith(prefix)
            ? normalizedPrimaryKey.slice(prefix.length)
            : normalizedPrimaryKey
    }, [normalizedPrimaryKey, evaluatorSlug])

    const canonicalPrimaryKey = useMemo(
        () => canonicalizeMetricKey(normalizedPrimaryKey),
        [normalizedPrimaryKey],
    )
    const canonicalBareKey = useMemo(() => canonicalizeMetricKey(barePrimaryKey), [barePrimaryKey])

    const hasScenarioId =
        typeof scenarioId === "string" &&
        scenarioId.trim().length > 0 &&
        scenarioId !== "__missing__"
    const safeScenarioId = hasScenarioId ? scenarioId : (`__missing__::${runId}` as string)

    const runScopedAtoms = useMemo(() => {
        if (!hasScenarioId || !runId) {
            return {
                primary: emptyMetricDataAtom,
                canonical: emptyMetricDataAtom,
                bare: emptyMetricDataAtom,
                canonicalBare: emptyMetricDataAtom,
            }
        }

        const args = {
            runId,
            scenarioId: scenarioId as string,
            stepSlug,
        }

        return {
            primary: runScopedMetricDataFamily({...args, metricKey: normalizedPrimaryKey}),
            canonical: runScopedMetricDataFamily({...args, metricKey: canonicalPrimaryKey}),
            bare: runScopedMetricDataFamily({...args, metricKey: barePrimaryKey}),
            canonicalBare: runScopedMetricDataFamily({...args, metricKey: canonicalBareKey}),
        }
    }, [
        barePrimaryKey,
        canonicalBareKey,
        canonicalPrimaryKey,
        hasScenarioId,
        normalizedPrimaryKey,
        runId,
        scenarioId,
        stepSlug,
    ])

    const primaryMetricData = useAtomValue(runScopedAtoms.primary)
    const canonicalMetricData = useAtomValue(runScopedAtoms.canonical)
    const bareMetricData = useAtomValue(runScopedAtoms.bare)
    const canonicalBareMetricData = useAtomValue(runScopedAtoms.canonicalBare)

    const runScopedStats = useAtomValue(runMetricsStatsCacheFamily(runId))

    const runScopedResult = useMemo(() => {
        const candidates = [
            {key: normalizedPrimaryKey, data: primaryMetricData},
            {key: canonicalPrimaryKey, data: canonicalMetricData},
            {key: barePrimaryKey, data: bareMetricData},
            {key: canonicalBareKey, data: canonicalBareMetricData},
        ]

        const resolved = candidates.find((entry) => entry.data?.value !== undefined)
        if (resolved) {
            return {
                value: resolved.data?.value,
                distInfo: resolved.data?.distInfo,
                key: resolved.key,
            }
        }
        return {value: undefined, distInfo: undefined, key: undefined}
    }, [
        bareMetricData,
        barePrimaryKey,
        canonicalBareKey,
        canonicalBareMetricData,
        canonicalMetricData,
        canonicalPrimaryKey,
        normalizedPrimaryKey,
        primaryMetricData,
    ])

    const providedErrorStep = context?.errorStep

    const {errorStep: computedErrorStep} = useMetricStepError({
        runId,
        scenarioId,
        metricKey: normalizedPrimaryKey,
        slugCandidates,
        stepKey: annotationStepKey,
        scenarioStepsResult,
    })

    const errorStep = providedErrorStep ?? computedErrorStep

    const hasFailure = Boolean(errorStep?.status || errorStep?.error)

    const scenarioMetricsAtom = useMemo(() => {
        if (!runId || !hasScenarioId) return emptyScenarioMetricsAtom
        return scenarioMetricSelectorFamily({runId, scenarioId: safeScenarioId})
    }, [hasScenarioId, runId, safeScenarioId])
    const scenarioMetrics = useAtomValue(scenarioMetricsAtom) as Record<string, any> | undefined

    const runMetricsStatsAtom = useMemo(() => {
        if (!runId) return emptyStatsAtom
        return runMetricsStatsCacheFamily(runId)
    }, [runId])
    const runMetricsStatsMap = useAtomValue(runMetricsStatsAtom)

    const buildCandidateKeys = useCallback(
        (base: string): string[] => {
            const candidates: string[] = []
            const push = (candidate?: string) => {
                if (!candidate) return
                if (candidates.includes(candidate)) return
                candidates.push(candidate)
            }

            push(base)

            const slug = stepSlug || base.split(".")[0]
            const withoutSlug =
                slug && base.startsWith(`${slug}.`) ? base.slice(slug.length + 1) : base

            if (slug) {
                push(`${slug}.${withoutSlug}`)
                push(`${slug}.attributes.ag.data.outputs.${withoutSlug}`)
                push(`${slug}.attributes.ag.metrics.${withoutSlug}`)
                push(`attributes.ag.data.outputs.${slug}.${withoutSlug}`)
                push(`attributes.ag.metrics.${slug}.${withoutSlug}`)
            }

            push(`attributes.ag.data.outputs.${withoutSlug}`)
            push(`attributes.ag.metrics.${withoutSlug}`)
            push(`attributes.ag.data.outputs.${base}`)
            push(`attributes.ag.metrics.${base}`)

            return candidates
        },
        [stepSlug],
    )

    const expandCandidateKeys = useCallback(
        (base: string): string[] => {
            const set = new Set<string>()
            buildCandidateKeys(base).forEach((candidate) => set.add(candidate))
            if (stepSlug && !base.startsWith(`${stepSlug}.`)) {
                buildCandidateKeys(`${stepSlug}.${base}`).forEach((candidate) => set.add(candidate))
            }
            if (annotationStepKey && !base.startsWith(`${annotationStepKey}.`)) {
                buildCandidateKeys(`${annotationStepKey}.${base}`).forEach((candidate) =>
                    set.add(candidate),
                )
            }
            return Array.from(set)
        },
        [annotationStepKey, buildCandidateKeys, stepSlug],
    )

    const baseCandidates = useMemo(() => {
        const set = new Set<string>()
        const push = (value?: string) => {
            if (!value) return
            const trimmed = String(value).trim()
            if (!trimmed) return
            set.add(trimmed)
        }

        push(normalizedPrimaryKey)
        push(canonicalPrimaryKey)
        push(barePrimaryKey)
        push(canonicalBareKey)
        push(metricName)
        if (metricName && metricName !== barePrimaryKey) {
            push(canonicalizeMetricKey(metricName))
        }
        normalizedFallbackKeys.forEach((key) => {
            push(key)
            push(canonicalizeMetricKey(key))
            const withoutSlug = key.startsWith(`${evaluatorSlug}.`)
                ? key.slice(evaluatorSlug.length + 1)
                : key
            push(withoutSlug)
            push(canonicalizeMetricKey(withoutSlug))
        })

        return Array.from(set)
    }, [
        normalizedPrimaryKey,
        canonicalPrimaryKey,
        barePrimaryKey,
        canonicalBareKey,
        metricName,
        normalizedFallbackKeys,
        evaluatorSlug,
    ])

    const expandedCandidates = useMemo(() => {
        const set = new Set<string>()
        baseCandidates.forEach((candidate) => {
            expandCandidateKeys(candidate).forEach((expanded) => set.add(expanded))
        })
        return Array.from(set)
    }, [baseCandidates, expandCandidateKeys])

    const resolution = useMemo(() => {
        if (runScopedResult.value !== undefined) {
            return {
                rawValue: runScopedResult.value as any,
                matchedKey: runScopedResult.key,
                distInfo: runScopedResult.distInfo,
            }
        }

        if (!scenarioMetrics || !expandedCandidates.length) {
            return {
                rawValue: undefined as any,
                matchedKey: undefined as string | undefined,
                distInfo: undefined,
            }
        }

        for (const candidate of expandedCandidates) {
            const resolved = getMetricValueWithAliases(scenarioMetrics, candidate)
            if (resolved !== undefined) {
                return {rawValue: resolved, matchedKey: candidate, distInfo: undefined}
            }
        }

        const looseMatchKey = Object.keys(scenarioMetrics).find((key) => {
            if (!key) return false
            if (key === normalizedPrimaryKey) return true
            if (key === canonicalPrimaryKey) return true
            if (key.endsWith(`.${barePrimaryKey}`)) return true
            if (metricName && key.endsWith(`.${metricName}`)) return true
            if (metricName && key.includes(`${metricName}.`)) return true
            if (evaluatorSlug && key.includes(`${evaluatorSlug}.${metricName}`)) return true
            if (evaluatorSlug && key.includes(`${evaluatorSlug}.${barePrimaryKey}`)) return true
            return false
        })

        if (looseMatchKey) {
            const resolved = scenarioMetrics[looseMatchKey]
            if (resolved !== undefined) {
                return {rawValue: resolved, matchedKey: looseMatchKey, distInfo: undefined}
            }
        }

        return {
            rawValue: undefined as any,
            matchedKey: undefined as string | undefined,
            distInfo: undefined,
        }
    }, [
        expandedCandidates,
        normalizedPrimaryKey,
        runId,
        runScopedResult,
        scenarioId,
        scenarioMetrics,
        evaluatorSlug,
    ])

    // Prefer run-scoped/metrics-map value; if it is missing or schema-like, fallback to annotation outputs
    const annotationFallback = useMemo(() => {
        const v = resolution.rawValue
        const isSchemaLike =
            v &&
            typeof v === "object" &&
            !Array.isArray(v) &&
            Object.keys(v as any).length <= 2 &&
            "type" in (v as any)

        const unusable =
            v === undefined ||
            v === null ||
            (typeof v === "string" && !v.trim()) ||
            (typeof v === "number" && Number.isNaN(v)) ||
            isSchemaLike

        if (!unusable) return undefined

        return getFromAnnotationOutputs({
            scenarioStepsResult,
            slugCandidates,
            evaluatorSlug,
            expandedCandidates,
        })
    }, [
        resolution.rawValue,
        scenarioStepsResult,
        slugCandidates,
        evaluatorSlug,
        expandedCandidates,
    ])

    const rawValue = annotationFallback?.value ?? resolution.rawValue
    const matchedKey = annotationFallback?.matchedKey ?? resolution.matchedKey

    const distInfo = useMemo(() => {
        if (resolution.distInfo !== undefined) return resolution.distInfo
        if (!runMetricsStatsMap) return undefined

        if (matchedKey) {
            const direct = runMetricsStatsMap[matchedKey]
            if (direct !== undefined) return direct
            const canonical = canonicalizeMetricKey(matchedKey)
            if (runMetricsStatsMap[canonical] !== undefined) return runMetricsStatsMap[canonical]
        }

        for (const candidate of expandedCandidates) {
            const direct = runMetricsStatsMap[candidate]
            if (direct !== undefined) return direct
            const canonical = canonicalizeMetricKey(candidate)
            if (runMetricsStatsMap[canonical] !== undefined) return runMetricsStatsMap[canonical]
        }

        return undefined
    }, [expandedCandidates, matchedKey, resolution.distInfo, runMetricsStatsMap])

    if (!hasScenarioId || !runId) {
        return (
            <Tag className="bg-[#0517290F] hover:bg-[#05172916]" bordered={false}>
                N/A
            </Tag>
        )
    }

    if (hasFailure) {
        const tooltipContent =
            typeof errorStep?.error === "string" && errorStep.error.length
                ? errorStep.error
                : "Evaluator returned an error for this metric."

        const tagColor =
            errorStep?.status &&
            Object.prototype.hasOwnProperty.call(STATUS_COLOR, errorStep.status)
                ? (STATUS_COLOR as Record<string, string>)[errorStep.status]
                : STATUS_COLOR[EvaluationStatus.ERROR]

        const statusLabel = getStatusLabel(errorStep?.status || EvaluationStatus.ERROR)

        const statusTag = (
            <Tooltip
                title={<span className="whitespace-pre-wrap">{tooltipContent}</span>}
                classNames={{body: "max-w-[320px] max-h-[320px] overflow-y-auto"}}
            >
                <Tag color={tagColor} bordered={false} className="cursor-help">
                    {statusLabel}
                </Tag>
            </Tooltip>
        )

        if (suppressFailure) {
            return statusTag
        }

        return (
            <EvaluatorFailureDisplay
                status={errorStep?.status}
                error={errorStep?.error}
                editorKey={`error-${runId}-${scenarioId}-${evaluatorSlug}-${metricName}`}
            />
        )
    }

    let normalizedValue: any = rawValue

    if (
        normalizedValue !== null &&
        typeof normalizedValue === "object" &&
        !Array.isArray(normalizedValue)
    ) {
        const normalizedObject = normalizedValue as Record<string, any>
        if (Array.isArray(normalizedObject.frequency) && normalizedObject.frequency.length > 0) {
            const entry = normalizedObject.frequency.reduce((max: any, current: any) =>
                (current?.count ?? 0) > (max?.count ?? 0) ? current : max,
            )
            normalizedValue = entry?.value ?? entry
        } else if (typeof normalizedObject.mean === "number") {
            normalizedValue = normalizedObject.mean
        } else if (typeof normalizedObject.score === "number") {
            normalizedValue = normalizedObject.score
        } else {
            const primitive = Object.values(normalizedObject).find(
                (v) => typeof v === "number" || typeof v === "string" || typeof v === "boolean",
            )
            normalizedValue = primitive !== undefined ? primitive : JSON.stringify(normalizedObject)
        }
    }

    if (
        normalizedValue === undefined ||
        normalizedValue === null ||
        (typeof normalizedValue === "number" && Number.isNaN(normalizedValue)) ||
        (typeof normalizedValue === "string" && normalizedValue.trim() === "")
    ) {
        return (
            <Tag className="bg-[#0517290F] hover:bg-[#05172916]" bordered={false}>
                N/A
            </Tag>
        )
    }

    const highlightValue = normalizedValue

    let display: string
    if (typeof normalizedValue === "boolean") {
        display = normalizedValue ? "true" : "false"
    } else if (Array.isArray(normalizedValue)) {
        display = JSON.stringify(normalizedValue)
    } else if (typeof normalizedValue === "object") {
        display = JSON.stringify(normalizedValue)
    } else {
        display = String(formatMetricValue(metricName, normalizedValue))
    }

    const isLongText = display.length > 180 || /\n/.test(display)
    if (isLongText) {
        const editorKey = `${runId}-${scenarioId}-${evaluatorSlug}-${metricName}`
        return (
            <SimpleSharedEditor
                headerName={metricName}
                key={editorKey}
                handleChange={() => {}}
                initialValue={display}
                editorType="borderless"
                state="readOnly"
                disabled
                readOnly
                editorClassName="!text-xs"
                placeholder="N/A"
                className="!w-[97.5%]"
            />
        )
    }

    const hasDistribution =
        distInfo &&
        typeof distInfo === "object" &&
        !Array.isArray(distInfo) &&
        Object.keys(distInfo).length > 0

    const tagNode = (
        <Tag
            className={clsx(
                "max-w-full whitespace-normal break-words break-all bg-[#0517290F] hover:bg-[#05172916]",
                {"cursor-pointer": Boolean(hasDistribution)},
            )}
            bordered={false}
        >
            {display}
        </Tag>
    )

    if (hasDistribution) {
        const inferredType = inferMetricType(highlightValue)
        return (
            <MetricDetailsPopover
                metricKey={metricName}
                extraDimensions={distInfo}
                highlightValue={highlightValue}
                hidePrimitiveTable
                metricType={inferredType}
            >
                {tagNode}
            </MetricDetailsPopover>
        )
    }

    return tagNode
}

interface EvaluatorContextOptions {
    runId: string
    scenarioId?: string
    evaluatorSlug: string
    scenarioStepsResult?: DrawerMetricValueCellProps["scenarioStepsResult"]
}

const useEvaluatorContext = ({
    runId,
    scenarioId,
    evaluatorSlug,
    scenarioStepsResult,
}: EvaluatorContextOptions): EvaluatorContext => {
    const slugCandidates = useMemo(
        () => collectSlugCandidates(scenarioStepsResult?.data, evaluatorSlug),
        [scenarioStepsResult?.data, evaluatorSlug],
    )

    const annotationStepKey = useMemo(
        () => findAnnotationStepKey(scenarioStepsResult?.data, slugCandidates),
        [scenarioStepsResult?.data, slugCandidates],
    )

    const derivedMetricKey =
        evaluatorSlug && evaluatorSlug.length > 0 ? `${evaluatorSlug}.__drawer__` : "__drawer__"

    const {errorStep} = useMetricStepError({
        runId,
        scenarioId,
        metricKey: derivedMetricKey,
        slugCandidates,
        stepKey: annotationStepKey,
        scenarioStepsResult,
    })

    return useMemo(
        () => ({
            slugCandidates,
            annotationStepKey,
            errorStep,
        }),
        [slugCandidates, annotationStepKey, errorStep],
    )
}

interface EvaluatorRunMetricsProps {
    runId: string
    scenarioId?: string
    evaluatorSlug: string
    metrics: DrawerEvaluatorMetric[]
    invocationStepKey?: string
    scenarioStepsResult?: DrawerMetricValueCellProps["scenarioStepsResult"]
    sectionId?: string
    metricRowClassName?: string
}

const EvaluatorRunMetrics = ({
    runId,
    scenarioId,
    evaluatorSlug,
    metrics,
    invocationStepKey,
    scenarioStepsResult,
    sectionId,
    metricRowClassName = "flex flex-col items-start gap-2 mb-3",
}: EvaluatorRunMetricsProps) => {
    const context = useEvaluatorContext({
        runId,
        scenarioId,
        evaluatorSlug,
        scenarioStepsResult,
    })

    const hasFailure = Boolean(context.errorStep?.status || context.errorStep?.error)

    if (!metrics.length) {
        return (
            <div className="flex w-full flex-col items-start gap-2" id={sectionId}>
                {hasFailure ? (
                    <EvaluatorFailureDisplay
                        status={context.errorStep?.status}
                        error={context.errorStep?.error}
                        editorKey={`evaluator-${runId}-${scenarioId ?? "unknown"}-${evaluatorSlug}`}
                    />
                ) : null}
                <Tag className="bg-[#0517290F] hover:bg-[#05172916]" bordered={false}>
                    N/A
                </Tag>
            </div>
        )
    }

    return (
        <div className="flex w-full flex-col items-start gap-2" id={sectionId}>
            {hasFailure ? (
                <EvaluatorFailureDisplay
                    status={context.errorStep?.status}
                    error={context.errorStep?.error}
                    editorKey={`evaluator-${runId}-${scenarioId ?? "unknown"}-${evaluatorSlug}`}
                />
            ) : null}
            {metrics.map((metric) => (
                <div
                    key={`${runId}-${scenarioId ?? "unknown"}-${evaluatorSlug}-${metric.id}`}
                    className={metricRowClassName}
                >
                    <span>{metric.displayName}</span>
                    <DrawerMetricValueCell
                        runId={runId}
                        scenarioId={scenarioId}
                        evaluatorSlug={evaluatorSlug}
                        metricName={metric.displayName}
                        metricKey={metric.metricKey}
                        fallbackKeys={metric.fallbackKeys}
                        invocationStepKey={invocationStepKey}
                        scenarioStepsResult={scenarioStepsResult}
                        context={context}
                        suppressFailure={hasFailure}
                    />
                </div>
            ))}
        </div>
    )
}

interface ScenarioRunMetricsProps {
    runId: string
    scenarioId?: string
    metrics: DrawerEvaluatorMetric[]
    sectionId?: string
    metricRowClassName?: string
}

const ScenarioRunMetrics = ({
    runId,
    scenarioId,
    metrics,
    sectionId,
    metricRowClassName = "flex flex-col items-start gap-2 mb-3",
}: ScenarioRunMetricsProps) => {
    if (!metrics.length) {
        return (
            <div className="flex w-full flex-col items-start gap-2" id={sectionId}>
                <Tag className="bg-[#0517290F] hover:bg-[#05172916]" bordered={false}>
                    N/A
                </Tag>
            </div>
        )
    }

    return (
        <div className="flex w-full flex-col items-start gap-2" id={sectionId}>
            {metrics.map((metric) => (
                <div
                    key={`${runId}-${scenarioId ?? "unknown"}-scenario-${metric.id}`}
                    className={metricRowClassName}
                >
                    <span>{metric.displayName}</span>
                    <DrawerMetricValueCell
                        runId={runId}
                        scenarioId={scenarioId}
                        evaluatorSlug="__scenario__"
                        metricName={metric.displayName}
                        metricKey={metric.metricKey}
                        fallbackKeys={metric.fallbackKeys}
                        suppressFailure
                    />
                </div>
            ))}
        </div>
    )
}

const FocusDrawerContent = () => {
    const router = useRouter()
    const appState = useAppState()
    const evalType = useAtomValue(evalTypeAtom)
    const isOnlineEval = evalType === "online"

    const [windowHight, setWindowHight] = useState(0)
    const [activeKeys, setActiveKeys] = useState<(string | number)[]>([
        "input",
        "output",
        "evaluators",
    ])

    const {data: previewEvaluators} = useEvaluators({preview: true})
    const {data: projectEvaluators} = useEvaluators()

    // atoms
    const focus = useAtomValue(focusScenarioAtom)
    const urlState = useAtomValue(urlStateAtom)
    const scenarioId = focus?.focusScenarioId as string
    const runId = focus?.focusRunId as string
    const rawCompareRunIds = Array.isArray(urlState?.compare) ? urlState.compare : []
    const compareRunIdsKey = rawCompareRunIds.join("|")
    const evaluationRunData = useAtomValue(evaluationRunStateFamily(runId!))
    const comparisonRunIds = useMemo(() => {
        if (!rawCompareRunIds.length) return EMPTY_COMPARISON_RUN_IDS
        return rawCompareRunIds.slice()
    }, [compareRunIdsKey])
    const rawBaseRunId = useMemo(() => {
        const routerValue = router.query?.evaluation_id
        if (Array.isArray(routerValue)) {
            const firstRouterId = routerValue[0]
            if (firstRouterId) return firstRouterId
        } else if (typeof routerValue === "string" && routerValue.length > 0) {
            return routerValue
        }

        const appStateValue = appState.query?.evaluation_id
        if (Array.isArray(appStateValue)) {
            return appStateValue[0] ?? null
        }

        return typeof appStateValue === "string" && appStateValue.length > 0 ? appStateValue : null
    }, [appState.query?.evaluation_id, router.query?.evaluation_id])

    const isBaseRun = useMemo(() => {
        if (evaluationRunData?.isBase !== undefined) {
            return Boolean(evaluationRunData.isBase)
        }
        return rawBaseRunId ? runId === rawBaseRunId : false
    }, [evaluationRunData?.isBase, rawBaseRunId, runId])

    const baseRunId = useMemo(() => {
        if (evaluationRunData?.isBase) return runId
        if (rawBaseRunId && typeof rawBaseRunId === "string") return rawBaseRunId
        return runId
    }, [evaluationRunData?.isBase, rawBaseRunId, runId])

    const comparisonRunsStepsAtomInstance = useMemo(
        () => comparisonRunsStepsAtom(comparisonRunIds),
        [comparisonRunIds],
    )
    const comparisonRunsSteps = useAtomValue(comparisonRunsStepsAtomInstance)
    // // Derive whether to show comparison mode
    const showComparisons = useMemo(
        () => Boolean(isBaseRun && comparisonRunIds.length > 0),
        [isBaseRun, comparisonRunIds],
    )
    const {
        data: scenarioStepsData,
        state: stepState,
        hasResolved: hasResolvedSteps,
        error: scenarioStepsError,
    } = useCachedScenarioSteps(runId, scenarioId)

    const hasScenarioSteps =
        scenarioStepsData && typeof scenarioStepsData === "object"
            ? Object.keys(scenarioStepsData).length > 0
            : false

    const enricedRun = evaluationRunData?.enrichedRun
    const runIndex = evaluationRunData?.runIndex
    const invocationStep = useMemo(
        () => scenarioStepsData?.invocationSteps?.[0],
        [scenarioStepsData],
    )
    const rawInvocationStepKey = useMemo(() => {
        if (!invocationStep) return undefined
        return (
            invocationStep?.stepKey ||
            (invocationStep as any)?.stepkey ||
            (invocationStep as any)?.step_key ||
            undefined
        )
    }, [invocationStep])
    const firstInvocationKey = useMemo(() => {
        if (!runIndex?.invocationKeys || runIndex.invocationKeys.size === 0) return undefined
        for (const key of runIndex.invocationKeys) {
            if (typeof key === "string" && key.length > 0) return key
        }
        return undefined
    }, [runIndex])
    const invocationStepKey = rawInvocationStepKey ?? firstInvocationKey
    const resolvedScenarioId = invocationStep?.scenarioId ?? scenarioId
    const {
        trace,
        value: outputValue,
        rawValue: rawOutputValue,
        messageNodes,
        hasError,
    } = useInvocationResult({
        scenarioId: resolvedScenarioId,
        stepKey: invocationStepKey,
        editorType: "simple",
        viewType: "single",
        runId,
    })

    const displayOutputValue = useMemo(() => {
        if (messageNodes) return undefined

        if (evalType === "online") {
            const sources: unknown[] = [
                rawOutputValue,
                outputValue,
                trace?.data?.outputs,
                trace?.data,
                trace?.outputs,
                trace?.response,
                trace?.tree?.nodes,
                trace?.nodes,
            ]

            const extracted = resolveOnlineOutput(sources)
            const fallback = fallbackPrimitive(outputValue) ?? "N/A"
            return extracted ?? fallback
        }

        return fallbackPrimitive(outputValue) ?? "N/A"
    }, [messageNodes, evalType, rawOutputValue, outputValue, trace])

    const entries = useMemo(() => {
        const normalizeValue = (value: unknown): string => {
            if (value === null || value === undefined) return ""
            if (typeof value === "string") return value
            if (typeof value === "number" || typeof value === "boolean") return String(value)
            try {
                return JSON.stringify(value, null, 2)
            } catch {
                return String(value)
            }
        }

        const map = new Map<string, string>()
        const pushRecord = (record?: Record<string, unknown> | null) => {
            if (!record || typeof record !== "object") return
            Object.entries(record).forEach(([key, value]) => {
                if (!key || key === "testcase_dedup_id" || key === "testcaseId") return
                const normalizedKey = titleCase(key)
                if (map.has(normalizedKey)) return
                map.set(normalizedKey, normalizeValue(value))
            })
        }

        const pushInputsFrom = (source: any, depth = 0) => {
            if (!source || typeof source !== "object" || depth > 4) return
            if (Array.isArray(source)) {
                source.forEach((item) => pushInputsFrom(item, depth + 1))
                return
            }

            Object.entries(source).forEach(([key, value]) => {
                if (!value) return
                const lower = key.toLowerCase()
                if (lower.includes("input")) {
                    if (typeof value === "object") {
                        pushRecord(value as Record<string, unknown>)
                    } else if (lower === "inputs") {
                        map.set(titleCase(key), normalizeValue(value))
                    }
                    return
                }
                if (
                    lower.includes("request") ||
                    lower.includes("parameter") ||
                    lower.includes("payload") ||
                    lower === "data" ||
                    lower === "attributes" ||
                    lower === "body"
                ) {
                    pushInputsFrom(value, depth + 1)
                }
            })
        }

        const inputSteps = scenarioStepsData?.inputSteps
        if (Array.isArray(inputSteps) && inputSteps.length > 0) {
            inputSteps.forEach((inputCol) => {
                const testcaseData =
                    inputCol?.testcase && typeof inputCol.testcase.data === "object"
                        ? (inputCol.testcase.data as Record<string, unknown>)
                        : null
                if (testcaseData) {
                    pushRecord(testcaseData)
                } else {
                    pushRecord(((inputCol as any)?.inputs ?? null) as Record<string, unknown>)
                }
            })
        }

        if (map.size === 0) {
            if (invocationStep && typeof invocationStep === "object") {
                pushInputsFrom(invocationStep)
                const invocationParams = (invocationStep as any)?.invocationParameters
                if (invocationParams && typeof invocationParams === "object") {
                    Object.values(invocationParams as Record<string, any>).forEach((param) => {
                        pushInputsFrom(param)
                    })
                }
                const inlineParameters = (invocationStep as any)?.parameters
                if (inlineParameters && typeof inlineParameters === "object") {
                    pushInputsFrom(inlineParameters)
                }
            }

            const traceSources: any[] = []
            if (invocationStep?.trace) traceSources.push(invocationStep.trace)
            if (trace) traceSources.push(trace)
            traceSources.forEach((source) => {
                pushInputsFrom(source)
                if (Array.isArray(source?.nodes))
                    source.nodes.forEach((node: any) => pushInputsFrom(node))
                if (Array.isArray(source?.tree?.nodes))
                    source.tree.nodes.forEach((node: any) => pushInputsFrom(node))
            })
        }

        if (map.size === 0 && trace) {
            const fallback =
                normalizeValue(
                    trace?.attributes?.ag?.data?.requestBody?.inputs ??
                        trace?.attributes?.ag?.data?.inputs ??
                        trace?.attributes?.inputs ??
                        trace?.inputs ??
                        trace?.data?.inputs,
                ) || ""
            if (fallback) {
                map.set("Inputs", fallback)
            }
        }

        if (map.size === 0 && invocationStep) {
            const fallback =
                normalizeValue(
                    (invocationStep as any)?.inputs ??
                        (invocationStep as any)?.parameters?.inputs ??
                        (invocationStep as any)?.data ??
                        (invocationStep as any)?.result,
                ) || ""
            if (fallback) {
                map.set("Inputs", fallback)
            }
        }

        return Array.from(map.entries()).map(([k, v]) => ({k, v}))
    }, [scenarioStepsData, invocationStep, trace])

    const inputListHeight = useMemo(() => Math.max(windowHight - 120, 240), [windowHight])
    const hasEntryData = entries.length > 0
    const shouldShowTraceSummary =
        isOnlineEval && Boolean(resolvedScenarioId) && Boolean(invocationStepKey)
    const traceJson = useMemo(() => {
        if (!trace) return null
        try {
            return JSON.stringify(trace, null, 2)
        } catch {
            return String(trace)
        }
    }, [trace])

    const traceEditorKey = useMemo(() => {
        const normalize = (value: unknown) =>
            typeof value === "string" && value.trim().length > 0 ? value : undefined

        const fromSource = (source: any): string | undefined => {
            if (!source || typeof source !== "object") return undefined
            return (
                normalize((source as any).trace_id) ??
                normalize((source as any).traceId) ??
                normalize((source as any).id) ??
                (typeof (source as any).span === "object"
                    ? (normalize((source as any).span?.trace_id) ??
                      normalize((source as any).span?.traceId) ??
                      normalize((source as any).span?.id))
                    : undefined)
            )
        }

        return (
            fromSource(trace) ??
            fromSource((invocationStep as any)?.trace) ??
            (scenarioId ? String(scenarioId) : undefined) ??
            "trace"
        )
    }, [trace, invocationStep, scenarioId])

    // Base testcase id to match comparison scenarios by content
    const baseTestcaseId = useMemo(() => {
        const inputSteps = scenarioStepsData?.inputSteps
        const id = inputSteps?.[0]?.testcaseId
        return id
    }, [scenarioStepsData])

    // Map of comparison runId -> matched scenarioId (by testcaseId)
    const matchedComparisonScenarios = useMemo(() => {
        if (!showComparisons || !baseTestcaseId) return [] as {runId: string; scenarioId?: string}[]
        return comparisonRunIds.map((compRunId) => {
            const compMap =
                comparisonRunsSteps && typeof comparisonRunsSteps === "object"
                    ? ((comparisonRunsSteps as Record<string, any>)[compRunId] as any) || {}
                    : {}
            let matchedScenarioId: string | undefined
            for (const [scId, testcaseIds] of Object.entries<any>(compMap)) {
                const first = Array.isArray(testcaseIds) ? testcaseIds[0] : undefined
                if (first && first === baseTestcaseId) {
                    matchedScenarioId = scId
                    break
                }
            }
            return {runId: compRunId, scenarioId: matchedScenarioId}
        })
    }, [showComparisons, baseTestcaseId, comparisonRunsSteps, comparisonRunIds])

    const evaluatorLookupByIdentifier = useMemo(() => {
        const map = new Map<string, any>()
        const register = (entry: any) => {
            const identifiers = collectEvaluatorIdentifiers(entry)
            if (!identifiers.length) return
            identifiers.forEach((identifier) => {
                if (!map.has(identifier)) {
                    map.set(identifier, entry)
                }
            })
        }

        asEvaluatorArray(previewEvaluators).forEach(register)
        asEvaluatorArray(projectEvaluators).forEach(register)
        return map
    }, [previewEvaluators, projectEvaluators])

    const evaluatorMetrics = useMemo(() => {
        const rawEvaluators = enricedRun?.evaluators
        const list = asEvaluatorArray(rawEvaluators)
        return list.map((entry: any, idx: number) => {
            const identifiers = collectEvaluatorIdentifiers(entry)
            let matchedFallback: any
            for (const identifier of identifiers) {
                const candidate = evaluatorLookupByIdentifier.get(identifier)
                if (candidate) {
                    matchedFallback = candidate
                    break
                }
            }

            const slug = extractEvaluatorSlug(entry) ?? extractEvaluatorSlug(matchedFallback)
            const resolvedSlug = slug ?? `evaluator-${idx}`
            const displayName =
                extractEvaluatorName(entry) ??
                extractEvaluatorName(matchedFallback) ??
                resolvedSlug ??
                `Evaluator ${idx + 1}`

            const metrics =
                resolveEvaluatorMetricsMap(entry) ??
                resolveEvaluatorMetricsMap(matchedFallback) ??
                {}

            return {
                name: displayName,
                metrics,
                slug: resolvedSlug,
            }
        })
    }, [enricedRun?.evaluators, evaluatorLookupByIdentifier])

    const scenarioMetricDefinitions = useMemo(() => {
        const columns =
            evalType === "human" || evalType === "online"
                ? GeneralHumanEvalMetricColumns
                : GeneralAutoEvalMetricColumns

        const seen = new Set<string>()

        return columns
            .map((column) => {
                const rawKey = String(column.path || column.name || "").trim()
                if (!rawKey) return undefined
                const definition = buildDrawerMetricDefinition(undefined, rawKey, column)
                const fallback = new Set<string>(definition.fallbackKeys || [])
                fallback.add(rawKey)
                const canonical = canonicalizeMetricKey(rawKey)
                if (canonical) fallback.add(canonical)
                const aliasList = SCENARIO_METRIC_ALIASES[rawKey] || []
                aliasList.forEach((alias) => fallback.add(alias))
                if (canonical && SCENARIO_METRIC_ALIASES[canonical]) {
                    SCENARIO_METRIC_ALIASES[canonical].forEach((alias) => fallback.add(alias))
                }
                if (typeof column.name === "string") {
                    fallback.add(column.name)
                    fallback.add(column.name.toLowerCase())
                    fallback.add(column.name.replace(/\s+/g, ""))
                }

                return {
                    ...definition,
                    displayName: column.name ?? definition.displayName,
                    metricKey: rawKey,
                    fallbackKeys: Array.from(fallback).filter(Boolean),
                }
            })
            .filter((metric): metric is DrawerEvaluatorMetric => {
                if (!metric) return false
                if (seen.has(metric.id)) return false
                seen.add(metric.id)
                return true
            })
    }, [evalType])

    const openAndScrollTo = useCallback((key: string) => {
        // Ensure the related section is expanded when navigating via hash
        setActiveKeys((prev) => {
            const next = new Set(prev)
            next.add(key)
            if (key === "output" || key.startsWith("output-")) next.add("output")
            return Array.from(next)
        })

        // wait for Collapse to render/expand, then scroll
        const tryScroll = (attempt = 0) => {
            const el = document.getElementById(`section-${key}`)
            // element is visible when offsetParent is not null (after expand)
            if (el && el.offsetParent !== null) {
                el.scrollIntoView({behavior: "smooth", block: "start", inline: "nearest"})
            } else if (attempt < 10) {
                requestAnimationFrame(() => tryScroll(attempt + 1))
            }
        }
        requestAnimationFrame(() => tryScroll())
    }, [])

    const handleCollapseChange = useCallback((keys: string[]) => {
        // Check if any dropdown is open by looking for the dropdown menu with the 'open' class
        // This is for improving micro interactions
        const openSelects = document.querySelectorAll(
            ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
        )
        const openDropdowns = document.querySelectorAll(".ant-dropdown:not(.ant-dropdown-hidden)")
        if (openSelects.length > 0 || openDropdowns.length > 0) {
            return
        }
        setActiveKeys(keys)
    }, [])

    useEffect(() => {
        setWindowHight(window.innerHeight)
    }, [scenarioStepsData])

    useEffect(() => {
        const evaluatorSlugs = evaluatorMetrics
            .map((evaluator) => pickString(evaluator.slug))
            .filter(Boolean) as string[]
        if (!evaluatorSlugs.length) return

        setActiveKeys((prev) => {
            const next = new Set(prev)
            let changed = false

            evaluatorSlugs.forEach((slug) => {
                if (!next.has(slug)) {
                    next.add(slug)
                    changed = true
                }
            })

            return changed ? Array.from(next) : prev
        })
    }, [evaluatorMetrics])

    useEffect(() => {
        const hash = appState.asPath?.split("#")[1]?.trim()
        if (!hash) return
        openAndScrollTo(hash)
    }, [appState.asPath, openAndScrollTo])

    // Sync horizontal scroll between the Collapse header (trace) and content box (output)
    const isSyncingScroll = useRef(false)
    useEffect(() => {
        if (!showComparisons) return

        const traceEl = document.querySelector(
            ".trace-scroll-container .ant-collapse-header",
        ) as HTMLDivElement | null
        const outputEl = document.querySelector(
            ".output-scroll-container .ant-collapse-content-box",
        ) as HTMLDivElement | null
        const evalEl = document.querySelector(
            ".evaluator-scroll-container .ant-collapse-content-box",
        ) as HTMLDivElement | null

        if (!traceEl || !outputEl) return

        const sync = (from: HTMLDivElement) => {
            const left = from.scrollLeft
            if (outputEl && from !== outputEl) outputEl.scrollLeft = left
            if (traceEl && from !== traceEl) traceEl.scrollLeft = left
            if (evalEl && from !== evalEl) evalEl.scrollLeft = left
        }

        const onTraceScroll = (e: any) => {
            if (isSyncingScroll.current) return
            isSyncingScroll.current = true
            sync(e.currentTarget as HTMLDivElement)
            requestAnimationFrame(() => (isSyncingScroll.current = false))
        }
        const onOutputScroll = (e: any) => {
            if (isSyncingScroll.current) return
            isSyncingScroll.current = true
            sync(e.currentTarget as HTMLDivElement)
            requestAnimationFrame(() => (isSyncingScroll.current = false))
        }
        const onEvalScroll = (e: any) => {
            if (isSyncingScroll.current) return
            isSyncingScroll.current = true
            sync(e.currentTarget as HTMLDivElement)
            requestAnimationFrame(() => (isSyncingScroll.current = false))
        }

        traceEl.addEventListener("scroll", onTraceScroll)
        outputEl.addEventListener("scroll", onOutputScroll)
        evalEl?.addEventListener("scroll", onEvalScroll)

        return () => {
            traceEl.removeEventListener("scroll", onTraceScroll)
            outputEl.removeEventListener("scroll", onOutputScroll)
            evalEl?.removeEventListener("scroll", onEvalScroll)
        }
    }, [showComparisons, activeKeys])

    const items: CollapseProps["items"] = useMemo(() => {
        if (!scenarioStepsData || !scenarioId) return []

        return [
            {
                key: "input",
                className: "!rounded-none [&_.ant-collapse-header]:!py-2",
                label: (
                    <span id="section-input" className="font-medium">
                        Inputs
                    </span>
                ),
                children: (
                    <div className="flex flex-col gap-4 min-h-0 h-fit scroll-mt-2">
                        {/* {shouldShowTraceSummary ? (
                            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                                {traceJson ? (
                                    <div className="border-t border-slate-200">
                                        <SimpleSharedEditor
                                            key={`trace-json-${traceEditorKey}`}
                                            handleChange={() => {}}
                                            headerName="Trace payload"
                                            initialValue={traceJson}
                                            editorType="borderless"
                                            state="readOnly"
                                            disabled
                                            readOnly
                                            editorClassName="!text-xs"
                                            className="!w-full"
                                            defaultMinimized
                                            editorProps={{codeOnly: true, language: "json"} as any}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        ) : null} */}
                        {hasEntryData ? (
                            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                                <VirtualizedSharedEditors
                                    entries={entries}
                                    overscanCount={1}
                                    estimatedRowHeight={120}
                                    className="h-full"
                                    listHeight={inputListHeight}
                                    renderRow={(entry) => {
                                        // Detect chat-shaped JSON like in CellComponents.tsx
                                        let isChat = false
                                        if (typeof entry.v === "string") {
                                            try {
                                                const parsed = JSON.parse(entry.v)
                                                isChat =
                                                    Array.isArray(parsed) &&
                                                    parsed.every(
                                                        (m: any) => "role" in m && "content" in m,
                                                    )
                                            } catch {
                                                /* ignore */
                                            }
                                        }

                                        if (isChat) {
                                            const nodes = renderChatMessages({
                                                keyPrefix: `${scenarioId}-${entry.k}`,
                                                rawJson: entry.v as string,
                                                view: "single",
                                                editorType: "simple",
                                            })
                                            return (
                                                <div
                                                    key={`${entry.k}-${scenarioId}`}
                                                    className="flex flex-col gap-2 w-full"
                                                >
                                                    {nodes}
                                                </div>
                                            )
                                        }

                                        return (
                                            <SimpleSharedEditor
                                                key={`${entry.k}-${scenarioId}`}
                                                handleChange={() => {}}
                                                headerName={entry.k}
                                                initialValue={String(entry.v)}
                                                editorType="borderless"
                                                state="readOnly"
                                                placeholder="N/A"
                                                disabled
                                                readOnly
                                                editorClassName="!text-xs"
                                                className="!w-[97.5%]"
                                                editorProps={{enableResize: true}}
                                            />
                                        )
                                    }}
                                />
                            </div>
                        ) : !shouldShowTraceSummary ? (
                            <span className="text-gray-400">No inputs available</span>
                        ) : null}
                    </div>
                ),
            },
            {
                key: "trace",
                className:
                    "trace-scroll-container !rounded-none !px-0 [&_.ant-collapse-header]:!px-0 [&_.ant-collapse-header]:overflow-x-auto [&_.ant-collapse-header]:scroll-mr-2 sticky -top-[13px] z-10 bg-white [&_.ant-collapse-header::-webkit-scrollbar]:!w-0 [&_.ant-collapse-header::-webkit-scrollbar]:!h-0",
                collapsible: "disabled",
                disabled: true,
                showArrow: false,
                label: (
                    <section
                        id="section-output"
                        className="shrink-0 h-[40px] px-1 flex items-center border-0 border-b border-t border-solid border-gray-200"
                    >
                        {showComparisons ? (
                            <>
                                <RunTraceHeader
                                    runId={baseRunId}
                                    scenarioId={scenarioId}
                                    stepKey={invocationStepKey}
                                    anchorId={`section-output-${baseRunId}`}
                                    showComparisons={showComparisons}
                                />
                                {matchedComparisonScenarios.map(
                                    ({runId: rId, scenarioId: scId}) => (
                                        <RunTraceHeader
                                            key={`trace-${rId}`}
                                            runId={rId}
                                            scenarioId={scId}
                                            stepKey={invocationStepKey}
                                            anchorId={`section-output-${rId}`}
                                            showComparisons={showComparisons}
                                        />
                                    ),
                                )}
                            </>
                        ) : (
                            <RunTraceHeader
                                runId={runId}
                                scenarioId={scenarioId}
                                stepKey={invocationStepKey}
                                showComparisons={showComparisons}
                            />
                        )}
                    </section>
                ),
            },
            {
                key: "output",
                label: <span className="font-medium">Outputs</span>,
                className: clsx([
                    "output-scroll-container",
                    "!rounded-none !px-0 [&_.ant-collapse-header]:!py-2 [&_.ant-collapse-content-box]:overflow-x-auto [&_.ant-collapse-content-box]:scroll-mr-2 [&_.ant-collapse-content-box::-webkit-scrollbar]:!w-0 [&_.ant-collapse-content-box::-webkit-scrollbar]:!h-0",
                    {"[&_.ant-collapse-content-box]:!px-1": showComparisons},
                ]),
                children: showComparisons ? (
                    <div className="w-full shrink-0 flex items-start">
                        <RunOutput
                            runId={baseRunId}
                            scenarioId={scenarioId}
                            stepKey={invocationStepKey}
                            showComparisons={showComparisons}
                        />
                        {matchedComparisonScenarios.map(({runId: rId, scenarioId: scId}) => (
                            <RunOutput
                                key={`output-${rId}`}
                                runId={rId}
                                scenarioId={scId}
                                stepKey={invocationStepKey}
                                showComparisons={showComparisons}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="min-h-0">
                        {messageNodes ? (
                            messageNodes
                        ) : (
                            <SimpleSharedEditor
                                key={`output-${scenarioId}`}
                                handleChange={() => {}}
                                initialValue={displayOutputValue}
                                headerName="Output"
                                editorType="borderless"
                                state="readOnly"
                                disabled
                                readOnly
                                editorClassName="!text-xs"
                                error={hasError}
                                placeholder="N/A"
                                className="!w-[97.5%]"
                            />
                        )}
                    </div>
                ),
            },
            ...(!showComparisons && scenarioMetricDefinitions.length && runId
                ? [
                      {
                          key: "metrics",
                          label: <span className="font-medium">Metrics</span>,
                          className:
                              "!rounded-none [&_.ant-collapse-header]:!py-2 [&_.ant-collapse-content-box]:!px-2",
                          children: (
                              <ScenarioRunMetrics
                                  runId={runId}
                                  scenarioId={scenarioId}
                                  metrics={scenarioMetricDefinitions}
                                  sectionId="section-scenario-metrics"
                                  metricRowClassName="flex flex-col items-start gap-1 mb-3 ml-2"
                              />
                          ),
                      },
                  ]
                : []),
            ...(showComparisons
                ? [
                      {
                          key: "evaluators",
                          label: null,
                          disabled: true,
                          showArrow: false,
                          className:
                              "evaluator-scroll-container !rounded-none [&_.ant-collapse-header]:!hidden [&_.ant-collapse-content-box]:overflow-x-auto [&_.ant-collapse-content-box]:!px-0 [&_.ant-collapse-content-box::-webkit-scrollbar]:!w-0 [&_.ant-collapse-content-box::-webkit-scrollbar]:!h-0",
                          children: (() => {
                              const runs = [
                                  {runId: baseRunId, scenarioId},
                                  ...matchedComparisonScenarios.map((m) => ({
                                      runId: m.runId,
                                      scenarioId: m.scenarioId,
                                  })),
                              ]

                              // Helper: collect evaluator list for a run
                              const getRunEvaluators = (rId?: string | null) => {
                                  if (!rId) {
                                      return []
                                  }
                                  const rState = getDefaultStore().get(
                                      evaluationRunStateFamily(rId),
                                  )
                                  const evaluators = rState?.enrichedRun?.evaluators || []
                                  return Array.isArray(evaluators)
                                      ? evaluators
                                      : (Object.values(evaluators) as any[])
                              }

                              // Build ordered set of evaluator slugs (base run first, then others)
                              const slugOrder = new Set<string>()
                              const slugName: Record<string, string> = {}
                              runs.forEach(({runId: rId}) => {
                                  const list = getRunEvaluators(rId)
                                  list.forEach((ev: any) => {
                                      slugOrder.add(ev.slug)
                                      if (!slugName[ev.slug]) slugName[ev.slug] = ev.name || ev.slug
                                  })
                              })

                              const baseScenarioStepsResult = {
                                  data: scenarioStepsData,
                                  state: stepState,
                                  hasResolved: hasResolvedSteps,
                                  error: scenarioStepsError,
                              }

                              // Build the vertical list of evaluators with per-run metric columns
                              const orderedSlugs = Array.from(slugOrder)

                              return (
                                  <div className="w-full flex flex-col">
                                      {scenarioMetricDefinitions.length ? (
                                          <div className="w-full" id="section-scenario-metrics">
                                              <div className="w-full shrink-0 flex items-stretch">
                                                  <div className="w-[500px] shrink-0 font-medium px-3 h-[48px] border-0 border-b border-t border-solid border-gray-200 flex items-center sticky left-0 z-10 bg-white">
                                                      <span className="">Scenario metrics</span>
                                                  </div>
                                                  {runs.slice(1).map((_, idx) => (
                                                      <div
                                                          key={`scenario-ph-${idx}`}
                                                          className="w-[480px] shrink-0 h-[48px] border-0 border-b border-t border-solid border-gray-200"
                                                      />
                                                  ))}
                                                  <div className="flex-1 min-w-0 h-[48px] border-0 border-b border-t border-solid border-gray-200" />
                                              </div>
                                              <div className="w-full shrink-0 flex items-start">
                                                  {runs.map(({runId: rId, scenarioId: scId}) => (
                                                      <div
                                                          key={`scenario-metrics-${rId}`}
                                                          className="w-[480px] shrink-0 px-3 border-0 border-r border-solid border-white"
                                                      >
                                                          <ScenarioRunMetrics
                                                              runId={rId}
                                                              scenarioId={scId}
                                                              metrics={scenarioMetricDefinitions}
                                                              sectionId={
                                                                  rId === runId
                                                                      ? "section-scenario-metrics"
                                                                      : undefined
                                                              }
                                                              metricRowClassName="flex flex-col items-start gap-2 mb-3"
                                                          />
                                                      </div>
                                                  ))}
                                              </div>
                                          </div>
                                      ) : null}
                                      {orderedSlugs.map((slug) => {
                                          // Figure out which runs used this evaluator
                                          const usedBy = new Set(
                                              runs
                                                  .filter(({runId: rId, scenarioId: scId}) => {
                                                      if (!scId) return false
                                                      const list = getRunEvaluators(rId)
                                                      return list.some((e: any) => e.slug === slug)
                                                  })
                                                  .map((r) => r.runId),
                                          )

                                          if (usedBy.size === 0) return null

                                          // Union of metric keys across participating runs only
                                          const metricKeyOrder = new Map<
                                              string,
                                              DrawerEvaluatorMetric
                                          >()
                                          runs.forEach(({runId: rId}) => {
                                              if (!usedBy.has(rId)) return
                                              const list = getRunEvaluators(rId)
                                              const ev = list.find((e: any) => e.slug === slug)
                                              const metricsMeta = (ev?.metrics || {}) as Record<
                                                  string,
                                                  any
                                              >

                                              Object.entries(metricsMeta).forEach(
                                                  ([rawKey, meta]) => {
                                                      const definition =
                                                          buildDrawerMetricDefinition(
                                                              slug,
                                                              String(rawKey),
                                                              meta,
                                                          )
                                                      const mapKey = `${slug}::${definition.id}`
                                                      const existing = metricKeyOrder.get(mapKey)
                                                      if (!existing) {
                                                          metricKeyOrder.set(mapKey, definition)
                                                      } else {
                                                          const mergedFallback = new Set<string>([
                                                              ...(existing.fallbackKeys || []),
                                                              ...(definition.fallbackKeys || []),
                                                          ])
                                                          metricKeyOrder.set(mapKey, {
                                                              ...existing,
                                                              metricKey:
                                                                  existing.metricKey ??
                                                                  definition.metricKey,
                                                              fallbackKeys: mergedFallback.size
                                                                  ? Array.from(mergedFallback)
                                                                  : undefined,
                                                          })
                                                      }
                                                  },
                                              )
                                          })

                                          const metricDefs = Array.from(metricKeyOrder.values())
                                          const displayName = slugName[slug] || slug

                                          return (
                                              <div
                                                  key={slug}
                                                  className="w-full"
                                                  id={`section-${slug}`}
                                              >
                                                  <div className="w-full shrink-0 flex items-stretch">
                                                      <div className="w-[500px] shrink-0 font-medium px-3 h-[48px] border-0 border-b border-t border-solid border-gray-200 flex items-center sticky left-0 z-10 bg-white">
                                                          <span className="">{displayName}</span>
                                                      </div>
                                                      {runs.slice(1).map((_, idx) => (
                                                          <div
                                                              key={`ph-${slug}-${idx}`}
                                                              className="w-[480px] shrink-0 h-[48px] border-0 border-b border-t border-solid border-gray-200"
                                                          />
                                                      ))}
                                                      <div className="flex-1 min-w-0 h-[48px] border-0 border-b border-t border-solid border-gray-200" />
                                                  </div>
                                                  <div className="w-full shrink-0 flex items-start">
                                                      {runs.map(
                                                          ({runId: rId, scenarioId: scId}) => {
                                                              const hasThis = usedBy.has(rId)
                                                              return (
                                                                  <div
                                                                      key={`run-${slug}-${rId}`}
                                                                      className="w-[480px] shrink-0 px-3 border-0 border-r border-solid border-white"
                                                                  >
                                                                      {hasThis ? (
                                                                          <EvaluatorRunMetrics
                                                                              runId={rId}
                                                                              scenarioId={scId}
                                                                              evaluatorSlug={slug}
                                                                              metrics={metricDefs}
                                                                              invocationStepKey={
                                                                                  invocationStepKey
                                                                              }
                                                                              scenarioStepsResult={
                                                                                  rId === runId
                                                                                      ? baseScenarioStepsResult
                                                                                      : undefined
                                                                              }
                                                                              sectionId={
                                                                                  rId === runId
                                                                                      ? `section-${slug}`
                                                                                      : undefined
                                                                              }
                                                                              metricRowClassName="flex flex-col items-start gap-2 mb-3"
                                                                          />
                                                                      ) : (
                                                                          // Support structure to preserve column spacing
                                                                          <div className="min-h-[1px]" />
                                                                      )}
                                                                  </div>
                                                              )
                                                          },
                                                      )}
                                                  </div>
                                              </div>
                                          )
                                      })}
                                  </div>
                              )
                          })(),
                      },
                  ]
                : (evaluatorMetrics || []).map((evaluator, idx) => {
                      const metrics = evaluator.metrics
                      const isFirst = idx === 0
                      const prevSlug = evaluatorMetrics?.[idx - 1]?.slug
                      const isPrevOpen = !!(prevSlug && activeKeys.includes(prevSlug))

                      const metricMap = new Map<string, DrawerEvaluatorMetric>()
                      const metricHelper = (meta: any, rawKey: string) => {
                          const definition = buildDrawerMetricDefinition(
                              evaluator.slug,
                              String(rawKey),
                              meta,
                          )
                          const mapKey = `${evaluator.slug}::${definition.id}`
                          const existing = metricMap.get(mapKey)
                          if (!existing) {
                              metricMap.set(mapKey, definition)
                          } else {
                              const mergedFallback = new Set<string>([
                                  ...(existing.fallbackKeys || []),
                                  ...(definition.fallbackKeys || []),
                              ])
                              metricMap.set(mapKey, {
                                  ...existing,
                                  metricKey: existing.metricKey ?? definition.metricKey,
                                  fallbackKeys: mergedFallback.size
                                      ? Array.from(mergedFallback)
                                      : undefined,
                              })
                          }
                      }

                      Object.entries(metrics || {}).forEach(([rawKey, meta]) => {
                          if (meta.properties) {
                              Object.entries(meta.properties).forEach(([propKey, propMeta]) => {
                                  metricHelper(propMeta, `${rawKey}.${propKey}`)
                              })
                          } else {
                              metricHelper(meta, rawKey)
                          }
                      })
                      const metricDefs = Array.from(metricMap.values())

                      if (!evaluator) return null
                      return {
                          key: evaluator.slug,
                          label: (
                              <span id={idx === 0 ? "evaluator" : ""} className="font-medium">
                                  {evaluator.name}
                              </span>
                          ),
                          className: clsx(
                              "[&_.ant-collapse-header]:border-0 [&_.ant-collapse-header]:border-solid [&_.ant-collapse-header]:border-gray-200",
                              "[&_.ant-collapse-header]:!rounded-none [&_.ant-collapse-header]:!py-[9px]",
                              "[&_.ant-collapse-header]:border-b",
                              {
                                  // Top border for first item or when previous evaluator is open
                                  "[&_.ant-collapse-header]:border-t": isFirst || isPrevOpen,
                              },
                          ),
                          children: (
                              <EvaluatorRunMetrics
                                  runId={runId!}
                                  scenarioId={scenarioId!}
                                  evaluatorSlug={evaluator.slug}
                                  metrics={metricDefs}
                                  invocationStepKey={invocationStepKey}
                                  scenarioStepsResult={{
                                      data: scenarioStepsData,
                                      state: stepState,
                                      hasResolved: hasResolvedSteps,
                                      error: scenarioStepsError,
                                  }}
                                  sectionId={`section-${evaluator.slug}`}
                                  metricRowClassName="flex flex-col items-start gap-1 mb-3 w-full"
                              />
                          ),
                      }
                  })),
        ]
    }, [
        entries,
        stepState,
        windowHight,
        rawOutputValue,
        trace,
        enricedRun?.name,
        scenarioId,
        activeKeys,
        messageNodes,
        hasError,
        displayOutputValue,
        comparisonRunIds,
        showComparisons,
        matchedComparisonScenarios,
        baseRunId,
        invocationStepKey,
        invocationStep?.stepkey,
    ])

    if ((!scenarioStepsData && !hasResolvedSteps) || !enricedRun || !runId) {
        return <FocusDrawerContentSkeleton />
    }

    return (
        <section className="h-full flex flex-col gap-2 scroll-smooth pb-2">
            <Collapse
                ghost
                activeKey={activeKeys}
                onChange={handleCollapseChange}
                expandIconPosition="end"
                items={items}
                className="h-full !rounded-none"
            />
        </section>
    )
}

export default FocusDrawerContent
