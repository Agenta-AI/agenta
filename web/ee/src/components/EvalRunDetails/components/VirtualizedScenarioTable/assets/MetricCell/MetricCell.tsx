import {type ReactNode, memo, useCallback, useMemo} from "react"

import {Tag, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"
import MetricDetailsPopover from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover" // adjust path if necessary
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils" // same util used elsewhere
import {Expandable} from "@/oss/components/Tables/ExpandableCell"
import {getStatusLabel} from "@/oss/lib/constants/statusLabels"
import {
    evaluationRunStateFamily,
    getCurrentRunId,
    loadableScenarioStepFamily,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {runScopedMetricDataFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {EvaluationStatus} from "@/oss/lib/Types"

import {STATUS_COLOR_TEXT} from "../../../EvalRunScenarioStatusTag/assets"
import {CellWrapper} from "../CellComponents" // CellWrapper is default export? need to check.

import {AnnotationValueCellProps, MetricCellProps, MetricValueCellProps} from "./types"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {loadable, selectAtom} from "jotai/utils"
import {UseEvaluationRunScenarioStepsFetcherResult} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import deepEqual from "fast-deep-equal"

/*
 * MetricCell – common renderer for metric columns (scenario-level or evaluator-level).
 * Props:
 *  - metricKey: base metric name (without evaluator slug)
 *  - fullKey: full metric path as used in maps (e.g. "evaluator.slug.score")
 *  - value: value for current scenario row
 *  - distInfo: pre-computed distribution / stats for popover (optional)
 *  - metricType: primitive type from evaluator schema ("number", "boolean", "array", etc.)
 */

const MetricCell = memo<MetricCellProps>(
    ({
        hidePrimitiveTable = true,
        scenarioId,
        metricKey,
        fullKey,
        value,
        distInfo,
        metricType,
        isComparisonMode,
    }) => {
        if (value === undefined || value === null) {
            if (isComparisonMode) {
                return (
                    <CellWrapper>
                        <div className="not-available-table-cell" />
                    </CellWrapper>
                )
            }
            return null
        }

        if (typeof value === "object" && Object.keys(value || {}).length === 0) {
            if (isComparisonMode) {
                return (
                    <CellWrapper>
                        <div className="not-available-table-cell" />
                    </CellWrapper>
                )
            }
            return null
        }

        const frequency = value?.frequency || value?.freq

        if (frequency && frequency?.length > 0) {
            const mostFrequent = frequency.reduce((max, current) =>
                current.count > max.count ? current : max,
            ).value
            value = mostFrequent
        }

        // Non-numeric arrays rendered as Tag list
        let formatted: ReactNode = formatMetricValue(metricKey, value)

        if (metricType === "boolean" && Array.isArray(value as any)) {
            const trueEntry = (distInfo as any).frequency.find((f: any) => f.value === true)
            const total = (distInfo as any).count ?? 0
            if (total) {
                return (
                    <div className="flex w-full gap-4">
                        <div className="flex flex-col text-xs leading-snug w-full grow">
                            <div className="flex flex-col w-full gap-1">
                                <div className="flex justify-between text-xs gap-2">
                                    <span className="text-[#95DE64] font-medium">true</span>
                                    <span className="text-[#97A4B0] font-medium">false</span>
                                </div>
                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div className="flex h-full">
                                        <div
                                            className="h-full bg-[#95DE64]"
                                            style={{
                                                width: `${((trueEntry?.count ?? 0) / total) * 100}%`,
                                            }}
                                        />
                                        <div
                                            className="h-full bg-[#97A4B0] text-xs"
                                            style={{
                                                width: `${((total - (trueEntry?.count ?? 0)) / total) * 100}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="self-stretch flex items-center justify-center">
                            {(((trueEntry?.count ?? 0) / total) * 100).toFixed(2)}
                        </div>
                    </div>
                )
            }
        }

        if (metricType === "array" || Array.isArray(value)) {
            const values = Array.isArray(value) ? value : [value]
            // const Component = metricType === "string" ? "span" : Tag
            formatted =
                metricType === "string" ? (
                    <div className="list-disc">
                        {values.map((it: any) => (
                            <li key={String(it)} className="capitalize">
                                {String(it)}
                            </li>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {values.map((it: any) => (
                            <Tag key={String(it)} className="capitalize">
                                {String(it)}
                            </Tag>
                        ))}
                    </div>
                )
        } else if (typeof value === "object") {
            // Extract primitive when wrapped in an object (e.g. { score, value, ... })
            if ("score" in value) value = (value as any).score
            else {
                const prim = Object.values(value || {}).find(
                    (v) => typeof v === "number" || typeof v === "string",
                )
                value = prim !== undefined ? prim : JSON.stringify(value)
            }
        }

        // Boolean metrics – show raw value
        if (metricType === "boolean") {
            formatted = String(value)
        }

        // Wrap in popover when distInfo present
        if (distInfo && metricType !== "string") {
            return (
                <CellWrapper>
                    <MetricDetailsPopover
                        metricKey={metricKey}
                        extraDimensions={distInfo}
                        highlightValue={value}
                        hidePrimitiveTable={hidePrimitiveTable}
                        metricType={metricType}
                    >
                        <span className="cursor-pointer underline underline-offset-2">
                            {formatted}
                        </span>
                    </MetricDetailsPopover>
                </CellWrapper>
            )
        }

        return (
            <CellWrapper>
                <Expandable expandKey={`${scenarioId}-${metricKey}-${fullKey}`}>
                    {formatted}
                </Expandable>
            </CellWrapper>
        )
    },
)

// --- Wrapper cell that fetches the value from atoms ----------------------

const failureRunTypes = [EvaluationStatus.FAILED, EvaluationStatus.FAILURE, EvaluationStatus.ERROR]

export const MetricValueCell = memo<MetricValueCellProps>(
    ({scenarioId, metricKey, fallbackKey, fullKey, metricType, evalType, runId}) => {
        const param = useMemo(
            () => ({runId, scenarioId, metricKey}),
            [runId, scenarioId, metricKey],
        )

        const fallbackParam = useMemo(
            () =>
                fallbackKey && fallbackKey !== metricKey
                    ? ({runId, scenarioId, metricKey: fallbackKey} as const)
                    : param,
            [fallbackKey, metricKey, param, runId, scenarioId],
        )

        const urlState = useAtomValue(urlStateAtom)
        const isComparisonMode = Boolean(urlState.compare && urlState.compare.length > 0)

        let value, distInfo
        const result = useAtomValue(runScopedMetricDataFamily(param as any))
        const fallbackResult = useAtomValue(runScopedMetricDataFamily(fallbackParam as any))

        value = result.value
        distInfo = result.distInfo

        if ((value === undefined || value === null) && fallbackResult) {
            value = fallbackResult.value
            distInfo = distInfo ?? fallbackResult.distInfo
        }
        const loadable = useAtomValue(loadableScenarioStepFamily({scenarioId, runId}))

        // TODO: remove this from here and create a function or something to also use in somewhere else
        // Last minute implementation for eval-checkpoint
        const errorStep = useMemo(() => {
            if (evalType !== "auto") return null
            if (loadable.state === "loading") return null
            const [evalSlug, key] = metricKey.split(".")
            if (!key) return null // if does not have key that means it's not an evaluator metric
            const _step = loadable.data?.steps?.find((s) => s.stepKey === evalSlug)

            if (!_step) {
                const invocationStep = loadable.data?.invocationSteps?.find(
                    (s) => s.scenarioId === scenarioId,
                )

                if (failureRunTypes.includes(invocationStep?.status)) {
                    return {
                        status: invocationStep?.status,
                        error: invocationStep?.error?.stacktrace || invocationStep?.error?.message,
                    }
                }
                return null
            }

            if (failureRunTypes.includes(_step?.status)) {
                return {
                    status: _step?.status,
                    error: _step?.error?.stacktrace || _step?.error?.message,
                }
            }

            return null
        }, [loadable])

        // TODO: create a separate component for error
        if (errorStep?.status || errorStep?.error) {
            return (
                <Tooltip
                    title={errorStep?.error}
                    classNames={{body: "max-w-[200px] max-h-[300px] overflow-y-auto"}}
                >
                    <span
                        className={clsx(
                            STATUS_COLOR_TEXT[errorStep?.status],
                            "text-wrap cursor-help",
                        )}
                    >
                        {getStatusLabel(errorStep?.status)}
                    </span>
                </Tooltip>
            )
        }

        return (
            <MetricCell
                scenarioId={scenarioId}
                metricKey={metricKey}
                fullKey={fullKey}
                value={value}
                distInfo={distInfo}
                metricType={metricType}
                isComparisonMode={isComparisonMode}
            />
        )
    },
)

// --- Annotation value cell -----------------------------------------------
// It's a hot fix until we fix the backend issue for annotation metrics
// In the backend the metrics endpoint is not returning all the type of annotation metrics
const OUTPUTS_PREFIX = "data.outputs."
const OUTPUT_SECTION_KEYS = ["metrics", "notes", "extra"] as const

const getNestedValue = (source: any, path?: string): any => {
    if (!source || !path) return undefined
    const segments = path.split(".").filter(Boolean)
    if (!segments.length) return undefined
    return segments.reduce<any>((acc, segment) => {
        if (acc === undefined || acc === null) return undefined
        return acc[segment]
    }, source)
}

const normalizeOutputsPath = (path?: string): string | undefined => {
    if (!path) return undefined
    if (path.startsWith(OUTPUTS_PREFIX)) {
        return path.slice(OUTPUTS_PREFIX.length)
    }
    if (path.startsWith("outputs.")) {
        return path.slice("outputs.".length)
    }
    return path
}

// Extract annotation metric/notes/extra values straight from the invocation payload.
const resolveAnnotationMetricValue = ({
    annotations,
    fieldPath,
    metricKey,
    name,
}: {
    annotations: AnnotationDto[]
    fieldPath?: string
    metricKey?: string
    name?: string
}) => {
    if (!annotations?.length) return undefined

    const fieldSegments = fieldPath?.split(".").filter(Boolean) ?? []

    const annotationsBySlug = new Map<string, AnnotationDto>()
    annotations.forEach((ann) => {
        const slug = ann?.references?.evaluator?.slug
        if (slug) annotationsBySlug.set(slug, ann)
    })

    const slugIndex = fieldSegments.findIndex((segment) => annotationsBySlug.has(segment))
    const slug = slugIndex >= 0 ? fieldSegments[slugIndex] : undefined
    const remainderSegments = slugIndex >= 0 ? fieldSegments.slice(slugIndex + 1) : fieldSegments
    const remainderPath = remainderSegments.length ? remainderSegments.join(".") : undefined

    const keyCandidates = Array.from(
        new Set(
            [metricKey, name, remainderSegments.at(-1), fieldSegments.at(-1)]
                .filter((key): key is string => Boolean(key))
                .map((key) => key),
        ),
    )

    const outputPathCandidates = Array.from(
        new Set(
            [
                normalizeOutputsPath(fieldPath),
                normalizeOutputsPath(remainderPath),
                ...keyCandidates.flatMap((key) =>
                    OUTPUT_SECTION_KEYS.map((section) => `${section}.${key}`),
                ),
            ].filter((path): path is string => Boolean(path)),
        ),
    )

    const rootPathCandidates = Array.from(
        new Set([fieldPath, remainderPath, ...keyCandidates].filter(Boolean) as string[]),
    )

    const prioritizedAnnotations = (() => {
        if (slug) {
            const matched = annotationsBySlug.get(slug)
            if (matched) return [matched]
        }

        const matchedByKey = annotations.filter((ann) => {
            const outputs = ann?.data?.outputs
            if (!outputs) return false
            return keyCandidates.some((key) =>
                OUTPUT_SECTION_KEYS.some(
                    (section) => getNestedValue(outputs[section], key) !== undefined,
                ),
            )
        })

        if (matchedByKey.length) return matchedByKey
        return annotations
    })()

    for (const ann of prioritizedAnnotations) {
        const outputs = ann?.data?.outputs ?? {}
        for (const path of outputPathCandidates) {
            const val = getNestedValue(outputs, path)
            if (val !== undefined) return val
        }

        for (const path of rootPathCandidates) {
            const val = getNestedValue(ann, path)
            if (val !== undefined) return val
        }
    }

    return undefined
}

export const AnnotationValueCell = memo<AnnotationValueCellProps>(
    ({
        scenarioId,
        stepKey,
        name,
        fieldPath,
        metricKey,
        metricType,
        fullKey,
        distInfo: propsDistInfo,
        runId,
    }) => {
        // Use effective runId with fallback using useMemo
        const effectiveRunId = useMemo(() => {
            if (runId) return runId
            try {
                return getCurrentRunId()
            } catch (error) {
                return ""
            }
        }, [runId])
        // Get evaluators from run-scoped state instead of global atom
        const evaluatorsSelector = useCallback((state: any) => {
            return state?.enrichedRun?.evaluators ? Object.values(state.enrichedRun.evaluators) : []
        }, [])
        const evaluatorsAtom = useMemo(
            () =>
                selectAtom(evaluationRunStateFamily(effectiveRunId), evaluatorsSelector, deepEqual),
            [effectiveRunId, evaluatorsSelector],
        )
        const evaluators = useAtomValue(evaluatorsAtom)
        const stepDataLoadable = useAtomValue(
            loadable(scenarioStepFamily({scenarioId, runId: effectiveRunId})),
        )

        let stepData: UseEvaluationRunScenarioStepsFetcherResult | undefined = undefined
        if (stepDataLoadable.state === "hasData") {
            stepData = stepDataLoadable.data
        } else if (stepDataLoadable.state === "loading") {
            // stepData = prevDataRef.current
        }

        // Memoize annotation steps for best performance (multi-step)
        const _annotationSteps = useMemo(
            () =>
                (stepData?.annotationSteps ??
                    []) as UseEvaluationRunScenarioStepsFetcherResult["annotationSteps"],
            [stepData],
        )
        // Build annotations per step key / slug
        const annotationsByStep = useMemo(() => {
            type AnnStep = UseEvaluationRunScenarioStepsFetcherResult["annotationSteps"][number]
            const map: Record<string, AnnStep[]> = {}
            if (!_annotationSteps.length) return map

            _annotationSteps.forEach((step) => {
                const annotation = step.annotation
                const fullKey = step.stepKey ?? (step as any).key
                const evaluatorSlug = annotation?.references?.evaluator?.slug
                const linkKeys = annotation?.links ? Object.keys(annotation.links) : []

                const possibleKeys = new Set<string>()
                linkKeys.forEach((key) => {
                    if (key) possibleKeys.add(key)
                })
                if (fullKey) {
                    possibleKeys.add(fullKey)
                    const invocationKey = fullKey.includes(".") ? fullKey.split(".")[0] : fullKey
                    if (invocationKey) possibleKeys.add(invocationKey)
                }
                if (evaluatorSlug) {
                    possibleKeys.add(evaluatorSlug)
                }

                if (!possibleKeys.size) {
                    possibleKeys.add("__default__")
                }

                possibleKeys.forEach((key) => {
                    if (!map[key]) map[key] = []
                    map[key].push(step)
                })
            })
            return map
        }, [_annotationSteps])
        const buildAnnotateData = useCallback(
            (lookupKey?: string) => {
                const fallbackSteps = _annotationSteps || []
                const _steps = (lookupKey && annotationsByStep?.[lookupKey]) || fallbackSteps
                const _annotations = _steps
                    .map((s) => s.annotation)
                    .filter(Boolean) as AnnotationDto[]
                const annotationEvaluatorSlugs = _annotations
                    .map((annotation) => annotation?.references?.evaluator?.slug)
                    .filter(Boolean)

                return {
                    annotations: _annotations,
                    evaluatorSlugs:
                        evaluators
                            ?.map((e) => e.slug)
                            .filter((slug) => !annotationEvaluatorSlugs.includes(slug)) || [],
                    evaluators:
                        evaluators?.filter((e) => !annotationEvaluatorSlugs.includes(e.slug)) || [],
                }
            },
            [annotationsByStep, evaluators, _annotationSteps],
        )
        const annotationKeys = useMemo(
            () => Object.keys(annotationsByStep).filter((key) => key !== "__default__"),
            [annotationsByStep],
        )
        const resolvedAnnotationKey = useMemo(() => {
            if (!annotationKeys.length) {
                return annotationsByStep.__default__ ? "__default__" : undefined
            }

            if (stepKey && stepKey !== "metric") {
                if (annotationsByStep[stepKey]) return stepKey

                const suffixMatch = annotationKeys.find((key) => key.endsWith(stepKey))
                if (suffixMatch) return suffixMatch
            }

            const slugCandidates = [metricKey, name, fieldPath]
                .map((candidate) => candidate?.split(".")[0])
                .filter((slug): slug is string => Boolean(slug))

            for (const slug of slugCandidates) {
                const slugMatch = annotationKeys.find(
                    (key) => key === slug || key.endsWith(`.${slug}`),
                )
                if (slugMatch) return slugMatch
            }

            if (annotationsByStep.__default__) {
                return "__default__"
            }

            return annotationKeys[0]
        }, [annotationKeys, annotationsByStep, fieldPath, metricKey, name, stepKey])
        const annotationsForStep = useMemo(() => {
            const annotateData = buildAnnotateData(resolvedAnnotationKey)
            return annotateData.annotations
        }, [buildAnnotateData, resolvedAnnotationKey])

        const metricVal = useMemo(
            () =>
                resolveAnnotationMetricValue({
                    annotations: annotationsForStep,
                    fieldPath,
                    metricKey,
                    name,
                }),
            [annotationsForStep, fieldPath, metricKey, name],
        )
        const distInfo = propsDistInfo
        return (
            <MetricCell
                scenarioId={scenarioId}
                metricKey={metricKey}
                fullKey={fullKey ?? fieldPath}
                value={metricVal}
                distInfo={distInfo}
                metricType={metricType}
            />
        )
    },
)

export default MetricCell
