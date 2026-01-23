import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {CaretLeft, Plus} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {useRouter} from "next/router"
import {useSWRConfig} from "swr"

import {message} from "@/oss/components/AppMessageContext"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {createAnnotation, updateAnnotation} from "@/oss/services/annotations/api"
import {useObservability} from "@/oss/state/newObservability"

import {AnnotateDrawerSteps} from "../enum"
import {
    generateAnnotationPayloadData,
    generateNewAnnotationPayloadData,
    getInitialMetricsFromAnnotations,
    getInitialSelectedEvalMetrics,
} from "../transforms"
import {AnnotateDrawerIdsType, AnnotateDrawerStepsType, AnnotateDrawerTitleProps} from "../types"

const AnnotateDrawerTitle = ({
    steps,
    setSteps,
    onClose,
    updatedMetrics = {},
    annotations = [],
    selectedEvaluators = [],
    traceSpanIds,
    onCaptureError,
    showOnly,
    queryKey,
}: AnnotateDrawerTitleProps) => {
    const router = useRouter()
    const {fetchAnnotations} = useObservability()
    const [isSaving, setIsSaving] = useState(false)
    const queryClient = useQueryClient()
    const {mutate: mutateCache} = useSWRConfig()
    const {data: evaluators} = useEvaluators({
        preview: true,
        queries: {is_human: true},
    })

    const onClickPrev = useCallback(
        (step: AnnotateDrawerStepsType) => {
            const hasSingleView = Boolean(
                showOnly?.annotateUi || showOnly?.selectEvaluatorsUi || showOnly?.createEvaluatorUi,
            )

            if (
                hasSingleView ||
                step === AnnotateDrawerSteps.ANNOTATE ||
                !Object.values(AnnotateDrawerSteps).includes(step)
            ) {
                onClose()
                return
            }

            setSteps((prev) => {
                const prevIndex = Object.values(AnnotateDrawerSteps).indexOf(prev)
                return Object.values(AnnotateDrawerSteps)[prevIndex - 1]
            })
        },
        [onClose, setSteps, showOnly],
    )

    const onClickNext = useCallback(
        (step: AnnotateDrawerStepsType) => {
            setSteps(step)
        },
        [setSteps],
    )

    const displayErrorMessage = useCallback(
        (requiredMetrics: Record<string, any>) => {
            const errorMessages: string[] = []

            for (const [key, data] of Object.entries(requiredMetrics || {})) {
                errorMessages.push(
                    `Value ${data?.value === "" ? "empty string" : data?.value} is not assignable to type ${data?.type} in ${key}`,
                )
            }
            onCaptureError?.(errorMessages, false)
            setIsSaving(false)
        },
        [onCaptureError],
    )

    const onSaveChanges = useCallback(async () => {
        try {
            setIsSaving(true)
            // 1: update only changed annotations
            if (annotations?.length > 0) {
                const {payload, requiredMetrics} = generateAnnotationPayloadData({
                    annotations,
                    updatedMetrics,
                    evaluators: (evaluators || []) as EvaluatorDto[],
                    invocationStepKey: traceSpanIds?.traceId || "",
                })

                if (Object.keys(requiredMetrics || {}).length > 0) {
                    displayErrorMessage(requiredMetrics)
                    return
                }

                // 2. invoke the endpoint
                if (payload.length > 0) {
                    await Promise.all(
                        payload.map((annotation) => {
                            const {trace_id, span_id, ...rest} = annotation
                            return updateAnnotation({
                                payload: rest,
                                traceId: trace_id || "",
                                spanId: span_id || "",
                            })
                        }),
                    )
                }
            }

            // 3. update annotation with new evals if any
            if (selectedEvaluators.length > 0) {
                const {payload, requiredMetrics} = generateNewAnnotationPayloadData({
                    updatedMetrics,
                    selectedEvaluators,
                    evaluators: (evaluators || []) as EvaluatorDto[],
                    traceSpanIds: traceSpanIds as AnnotateDrawerIdsType,
                    invocationStepKey: traceSpanIds?.traceId || "",
                })

                if (Object.keys(requiredMetrics || {}).length > 0) {
                    displayErrorMessage(requiredMetrics)
                    return
                }

                if (payload.length > 0) {
                    await Promise.all(payload.map((evaluator) => createAnnotation(evaluator)))
                }
            }
            // Invalidate ALL annotation caches (both Jotai atoms and SWR)
            // 1. Refetch annotations for observability atoms (Jotai)
            if (router.asPath.includes("/observability") || router.asPath.includes("/traces")) {
                await fetchAnnotations()
            }

            // 2. Invalidate SWR cache for useAnnotations hook (used by TraceDrawer)
            await mutateCache(
                (key) => Array.isArray(key) && key[0]?.includes("/preview/annotations/"),
                undefined,
                {revalidate: true},
            )

            // 3. Also invalidate evaluators cache
            await mutateCache(
                (key) => Array.isArray(key) && key[0]?.includes("/evaluators"),
                undefined,
                {revalidate: true},
            )

            // 4. Invalidate dynamic query key if provided
            if (queryKey) {
                await queryClient.invalidateQueries({
                    queryKey: [queryKey],
                })
            }

            message.success("Annotations updated successfully")
            onClose()
        } catch (error: any) {
            console.error("Error saving changes", error)
            message.error("Failed to update annotations")
            onCaptureError?.(error?.response?.data?.detail?.map((err: any) => err.msg) as string[])
        } finally {
            setIsSaving(false)
        }
    }, [
        annotations,
        updatedMetrics,
        evaluators,
        selectedEvaluators,
        traceSpanIds,
        router.asPath,
        fetchAnnotations,
        mutateCache,
        displayErrorMessage,
        onClose,
        onCaptureError,
        queryKey,
        queryClient,
    ])

    const initialAnnotationMetrics = useMemo(
        () => getInitialMetricsFromAnnotations({annotations, evaluators: evaluators || []}),
        [annotations, evaluators],
    )

    const initialSelectedEvalMetrics = useMemo(
        () =>
            getInitialSelectedEvalMetrics({evaluators: evaluators || [], selectedEvaluators}) || {},
        [evaluators, selectedEvaluators],
    )

    const isChangedMetricData = useMemo(() => {
        const annotationSlugs = annotations
            .map((ann) => ann.references?.evaluator?.slug)
            .filter(Boolean)

        // Filter updatedMetrics to only include user existing annotations
        const filteredUpdatedMetrics = Object.fromEntries(
            Object.entries(updatedMetrics).filter(([slug]) => annotationSlugs.includes(slug)),
        )
        return deepEqual(filteredUpdatedMetrics, initialAnnotationMetrics)
    }, [initialAnnotationMetrics, updatedMetrics, annotations])

    const isChangedSelectedEvalMetrics = useMemo(() => {
        const filteredUpdatedMetrics = Object.fromEntries(
            Object.entries(updatedMetrics).filter(([slug]) => selectedEvaluators.includes(slug)),
        )

        return deepEqual(filteredUpdatedMetrics, initialSelectedEvalMetrics)
    }, [initialSelectedEvalMetrics, updatedMetrics, selectedEvaluators])

    // Reset error messages
    useEffect(() => {
        if (isChangedMetricData && isChangedSelectedEvalMetrics) {
            onCaptureError?.([])
        }
    }, [isChangedMetricData, isChangedSelectedEvalMetrics, onCaptureError])

    return (
        <section className="w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
                <Button
                    type="text"
                    icon={<CaretLeft size={14} />}
                    onClick={() => onClickPrev(steps)}
                />
                {steps === AnnotateDrawerSteps.ANNOTATE || showOnly?.annotateUi ? (
                    <Typography.Text className="text-sm font-medium">Annotate</Typography.Text>
                ) : steps === AnnotateDrawerSteps.SELECT_EVALUATORS ||
                  showOnly?.selectEvaluatorsUi ? (
                    <Typography.Text className="text-sm font-medium">
                        Select Evaluators
                    </Typography.Text>
                ) : steps === AnnotateDrawerSteps.CREATE_EVALUATOR ||
                  showOnly?.createEvaluatorUi ? (
                    <Typography.Text className="text-sm font-medium">
                        Create new evaluator
                    </Typography.Text>
                ) : null}
            </div>

            {steps === AnnotateDrawerSteps.ANNOTATE || showOnly?.annotateUi ? (
                <div className="flex items-center gap-2">
                    <Button
                        icon={<Plus size={14} />}
                        onClick={() => onClickNext(AnnotateDrawerSteps.SELECT_EVALUATORS)}
                    >
                        Add Evaluator
                    </Button>
                    <Button
                        type="primary"
                        onClick={onSaveChanges}
                        loading={isSaving}
                        disabled={isChangedMetricData && isChangedSelectedEvalMetrics}
                        data-tour="annotation-submit"
                    >
                        Save
                    </Button>
                </div>
            ) : steps === AnnotateDrawerSteps.SELECT_EVALUATORS || showOnly?.selectEvaluatorsUi ? (
                <div className="flex items-center gap-2">
                    <Button
                        onClick={() => onClickNext(AnnotateDrawerSteps.ANNOTATE)}
                        disabled={selectedEvaluators.length === 0}
                    >
                        Annotate
                    </Button>

                    <Button
                        type="primary"
                        icon={<Plus size={14} />}
                        onClick={() => onClickNext(AnnotateDrawerSteps.CREATE_EVALUATOR)}
                    >
                        Create
                    </Button>
                </div>
            ) : null}
        </section>
    )
}

export default memo(AnnotateDrawerTitle)
