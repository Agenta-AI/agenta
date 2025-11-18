import {FC, memo, useCallback, useMemo, useRef, useState} from "react"

import {Card, Typography} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom, loadable} from "jotai/utils"
import dynamic from "next/dynamic"

import {
    getInitialMetricsFromAnnotations,
    getInitialSelectedEvalMetrics,
} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import {UpdatedMetricsType} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/types"
import {isAnnotationCreatedByCurrentUser} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/utils"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {
    getCurrentRunId,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {UseEvaluationRunScenarioStepsFetcherResult} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

import AnnotateScenarioButton from "../AnnotateScenarioButton"
import RunEvalScenarioButton from "../RunEvalScenarioButton"

import {ScenarioAnnotationPanelProps} from "./types"

const Annotate = dynamic(
    () =>
        import(
            "@agenta/oss/src/components/pages/observability/drawer/AnnotateDrawer/assets/Annotate"
        ),
    {ssr: false},
)

const EmptyArray: any[] = []

const ScenarioAnnotationPanelAnnotation = memo(
    ({
        onAnnotate,
        runId,
        scenarioId,
        buttonClassName,
        invStep,
        annotationsByStep,
        evaluators,
    }: ScenarioAnnotationPanelProps) => {
        const [errorMessages, setErrorMessages] = useState<string[]>(EmptyArray as string[])

        // TODO: move this to a shared utils file
        const formatErrorMessages = useCallback((requiredMetrics: Record<string, any>) => {
            const errorMessages: string[] = []

            for (const [key, data] of Object.entries(requiredMetrics || {})) {
                errorMessages.push(
                    `Value ${data?.value === "" ? "empty string" : data?.value} is not assignable to type ${data?.type} in ${key}`,
                )
            }
            setErrorMessages(errorMessages)
        }, [])

        const [updatedMetrics, setUpdatedMetrics] = useState<UpdatedMetricsType>({})

        // helper to compute per-step annotation & evaluator lists
        const buildAnnotateData = useCallback(
            (stepKey: string) => {
                const _steps = annotationsByStep?.[stepKey] || []
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
            [annotationsByStep, evaluators],
        )

        const {_annotations, isAnnotated, isCreatedByCurrentUser, selectedEvaluators} =
            useMemo(() => {
                const annotateData = buildAnnotateData(invStep.stepKey)

                const _annotations = annotateData.annotations
                const selectedEvaluators = annotateData.evaluatorSlugs

                const isAnnotated = _annotations.length > 0
                const isCreatedByCurrentUser = _annotations.length
                    ? _annotations.some((ann) => isAnnotationCreatedByCurrentUser(ann))
                    : true

                return {
                    isAnnotated,
                    isCreatedByCurrentUser,
                    selectedEvaluators,
                    _annotations,
                }
            }, [invStep.stepKey, buildAnnotateData, evaluators])

        const isChangedMetricData = useMemo(() => {
            const annotateData = buildAnnotateData(invStep.stepKey)

            const initialAnnotationMetrics = getInitialMetricsFromAnnotations({
                annotations: annotateData.annotations,
                evaluators,
            })
            const annotationSlugs = annotateData.annotations
                .map((ann) => ann.references?.evaluator?.slug)
                .filter(Boolean)

            // Filter updatedMetrics to only include user existing annotations
            const filteredUpdatedMetrics = Object.fromEntries(
                Object.entries(updatedMetrics).filter(([slug]) => annotationSlugs.includes(slug)),
            )

            if (
                Object.keys(filteredUpdatedMetrics).length === 0 &&
                filteredUpdatedMetrics.constructor === Object
            ) {
                return true
            }
            return deepEqual(filteredUpdatedMetrics, initialAnnotationMetrics)
        }, [updatedMetrics, evaluators, invStep.stepKey])

        const isChangedSelectedEvalMetrics = useMemo(() => {
            const annotateData = buildAnnotateData(invStep.stepKey)
            const selectedEvaluators = annotateData.evaluatorSlugs

            const initialSelectedEvalMetrics = getInitialSelectedEvalMetrics({
                evaluators: annotateData.evaluators,
                selectedEvaluators,
            })

            const filteredUpdatedMetrics = Object.fromEntries(
                Object.entries(updatedMetrics).filter(([slug]) =>
                    selectedEvaluators.includes(slug),
                ),
            )

            if (
                Object.keys(filteredUpdatedMetrics).length === 0 &&
                filteredUpdatedMetrics.constructor === Object
            ) {
                return true
            }

            return deepEqual(filteredUpdatedMetrics, initialSelectedEvalMetrics)
        }, [updatedMetrics, updatedMetrics, evaluators, invStep.stepKey])

        return (
            <div className="flex flex-col">
                <Annotate
                    annotations={_annotations}
                    updatedMetrics={updatedMetrics}
                    setUpdatedMetrics={setUpdatedMetrics}
                    selectedEvaluators={selectedEvaluators}
                    errorMessage={errorMessages}
                    disabled={!isCreatedByCurrentUser}
                />
                <AnnotateScenarioButton
                    runId={runId}
                    scenarioId={scenarioId}
                    stepKey={invStep.stepKey}
                    updatedMetrics={updatedMetrics}
                    formatErrorMessages={formatErrorMessages}
                    setErrorMessages={setErrorMessages}
                    isAnnotated={isAnnotated}
                    disabled={
                        (isChangedMetricData && isChangedSelectedEvalMetrics) ||
                        !isCreatedByCurrentUser
                    }
                    className={buttonClassName}
                    onAnnotate={onAnnotate}
                />
            </div>
        )
    },
)

const ScenarioAnnotationPanel: FC<ScenarioAnnotationPanelProps> = ({
    runId,
    scenarioId,
    className,
    classNames,
    buttonClassName,
    onAnnotate,
}) => {
    // Use effective runId with fallback using useMemo
    const effectiveRunId = useMemo(() => {
        if (runId) return runId
        try {
            return getCurrentRunId()
        } catch (error) {
            console.warn("[ScenarioAnnotationPanel] No run ID available:", error)
            return ""
        }
    }, [runId])

    // Get evaluators from run-scoped state instead of global atom
    const evaluatorsSelector = useCallback((state: any) => {
        return state?.enrichedRun?.evaluators ? Object.values(state.enrichedRun.evaluators) : []
    }, [])

    const evaluatorsAtom = useMemo(
        () => selectAtom(evaluationRunStateFamily(effectiveRunId), evaluatorsSelector, deepEqual),
        [effectiveRunId, evaluatorsSelector],
    )
    const evaluators = useAtomValue(evaluatorsAtom)

    // Loadable step data for this scenario (always eager) - now run-scoped
    // Read from the same global store that writes are going to
    const stepDataLoadable = useAtomValue(
        loadable(scenarioStepFamily({scenarioId, runId: effectiveRunId})),
    )

    // Preserve last known data so we can still show tool-tips / fields while revalidating
    const prevDataRef = useRef<UseEvaluationRunScenarioStepsFetcherResult | undefined>(undefined)

    let stepData: UseEvaluationRunScenarioStepsFetcherResult | undefined = undefined
    if (stepDataLoadable.state === "hasData") {
        stepData = stepDataLoadable.data
        prevDataRef.current = stepDataLoadable.data
    } else if (stepDataLoadable.state === "loading") {
        stepData = prevDataRef.current
    }

    // Memoize field slices for best performance (multi-step)
    const _invocationSteps = useMemo(() => stepData?.invocationSteps ?? [], [stepData])
    // Build annotations per step key
    const annotationsByStep = useMemo(() => {
        if (!stepData) return {}

        type AnnStep = (typeof stepData.steps)[number]
        const map: Record<string, AnnStep[]> = {}
        if (!stepData?.steps || !_invocationSteps.length) return map

        // Pre-compute all annotation steps once (annotation step = has invocation key prefix)
        const allAnnSteps = (stepData.steps || []).filter((s) =>
            _invocationSteps.some((invStep) => (s.stepKey ?? "").startsWith(`${invStep.stepKey}.`)),
        )
        _invocationSteps.forEach(({stepKey}) => {
            const anns = allAnnSteps.filter((s) => (s.stepKey ?? "").startsWith(`${stepKey}.`))
            map[stepKey] = anns
        })
        return map
    }, [stepData?.steps, _invocationSteps])

    const hasAnyTrace = useMemo(() => _invocationSteps.some((s) => s.traceId), [_invocationSteps])

    return (
        <Card className={className} classNames={classNames}>
            <div className="flex flex-col gap-6">
                {_invocationSteps.map((invStep) => {
                    return (
                        <ScenarioAnnotationPanelAnnotation
                            buttonClassName={buttonClassName}
                            key={invStep.id}
                            invStep={invStep}
                            annotationsByStep={annotationsByStep}
                            evaluators={evaluators}
                            runId={runId}
                            scenarioId={scenarioId}
                            onAnnotate={onAnnotate}
                        />
                    )
                })}
            </div>
            {!hasAnyTrace ? (
                <div
                    className={clsx(
                        "absolute top-0 left-0 right-0 bottom-0",
                        "backdrop-blur-md bg-[#051729] bg-opacity-10 z-10",
                        "flex flex-col gap-2 items-center justify-center",
                    )}
                >
                    <Typography>To annotate, please generate output</Typography>
                    <RunEvalScenarioButton
                        scenarioId={scenarioId}
                        stepKey={_invocationSteps[0]?.stepKey}
                        runId={effectiveRunId}
                        key="run-button"
                    />
                </div>
            ) : null}
        </Card>
    )
}

export default ScenarioAnnotationPanel
