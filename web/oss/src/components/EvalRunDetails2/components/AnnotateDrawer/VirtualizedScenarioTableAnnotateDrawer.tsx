import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Button, DrawerProps, Spin, message} from "antd"
import deepEqual from "fast-deep-equal"
import {getDefaultStore, useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {
    generateAnnotationPayloadData,
    generateNewAnnotationPayloadData,
    getInitialMetricsFromAnnotations,
} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import type {UpdatedMetricsType} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/types"
import {virtualScenarioTableAnnotateDrawerAtom} from "@/oss/lib/atoms/virtualTable"
import {createAnnotation, updateAnnotation} from "@/oss/services/annotations/api"

import {scenarioAnnotationsQueryAtomFamily} from "../../atoms/annotations"
import {scenarioStepsQueryFamily} from "../../atoms/scenarioSteps"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../atoms/table/evaluators"
import {classifyStep} from "../views/SingleScenarioViewerPOC"

const Annotate = dynamic(
    () =>
        import(
            "@agenta/oss/src/components/pages/observability/drawer/AnnotateDrawer/assets/Annotate"
        ),
    {ssr: false},
)

const EMPTY_ARRAY: any[] = []

interface AnnotateActionState {
    canSubmit: boolean
    isSubmitting: boolean
}

const PreviewAnnotateContent = ({
    scenarioId,
    runId,
    onClose,
    onStateChange,
    registerSubmit,
}: {
    scenarioId: string
    runId: string
    onClose: () => void
    onStateChange?: (state: AnnotateActionState) => void
    registerSubmit?: (handler: () => Promise<void>) => void
}) => {
    const stepsQuery = useAtomValue(
        useMemo(() => scenarioStepsQueryFamily({scenarioId, runId}), [scenarioId, runId]),
    )

    const stepsLoading = stepsQuery?.isLoading || stepsQuery?.isFetching

    const invocationSteps = useMemo(() => {
        const steps = stepsQuery?.data?.steps ?? stepsQuery?.data?.invocationSteps ?? []
        return steps.filter((step: any) => classifyStep(step) === "invocation")
    }, [stepsQuery?.data?.steps, stepsQuery?.data?.invocationSteps])

    const extractOutputs = useCallback(
        (step: any) =>
            step?.outputs ??
            step?.output ??
            step?.response ??
            step?.result ??
            step?.data?.outputs ??
            step?.data?.output ??
            step?.payload?.outputs ??
            step?.payload?.output ??
            null,
        [],
    )

    const traceIds = useMemo(
        () =>
            invocationSteps
                .map((step: any) => step?.traceId || step?.trace_id)
                .filter((id: any): id is string => Boolean(id)),
        [invocationSteps],
    )
    const traceIdsKey = useMemo(() => traceIds.join("|"), [traceIds])

    const annotationsQuery = useAtomValue(
        useMemo(() => scenarioAnnotationsQueryAtomFamily({traceIds, runId}), [traceIdsKey, runId]),
    )

    const evaluatorQuery = useAtomValue(
        useMemo(() => evaluationEvaluatorsByRunQueryAtomFamily(runId ?? null), [runId]),
    )

    const evaluatorDtos = useMemo(() => {
        const list = (evaluatorQuery?.data || EMPTY_ARRAY) as any[]
        return list.map((e: any) => e?.raw ?? e).filter(Boolean)
    }, [evaluatorQuery])

    const existingAnnotations = annotationsQuery?.data?.length
        ? annotationsQuery.data
        : (stepsQuery?.data?.annotationSteps ?? []).map(
              (step: any) => step?.annotation ?? step?.data?.annotations,
          )

    const combinedAnnotations = useMemo(() => {
        const bySlug = new Map<string, any>()
        ;(existingAnnotations ?? []).forEach((ann: any) => {
            const slug = ann?.references?.evaluator?.slug
            if (slug) bySlug.set(slug, ann)
        })
        return Array.from(bySlug.values())
    }, [existingAnnotations])

    const annotatedSlugs = useMemo(() => {
        const slugs = new Set<string>()
        combinedAnnotations?.forEach((ann: any) => {
            const slug = ann?.references?.evaluator?.slug
            if (slug) slugs.add(slug)
        })
        return slugs
    }, [combinedAnnotations])

    const [annotationMetrics, setAnnotationMetrics] = useState<UpdatedMetricsType>({})
    const [tempSelectedEvaluators, setTempSelectedEvaluators] = useState<string[]>([])
    const [errorMessage, setErrorMessage] = useState<string[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)

    const annotationsForAnnotate = useMemo(
        () => [...(combinedAnnotations ?? [])],
        [combinedAnnotations],
    )

    const selectedEvaluators = useMemo(
        () =>
            evaluatorDtos
                .map((e: any) => e.slug)
                .filter((slug: any) => Boolean(slug) && !annotatedSlugs.has(slug)),
        [evaluatorDtos, annotatedSlugs],
    )

    const baselineMetrics = useMemo(() => {
        try {
            return getInitialMetricsFromAnnotations({
                annotations: combinedAnnotations ?? [],
                evaluators: evaluatorDtos as any[],
            })
        } catch {
            return {}
        }
    }, [combinedAnnotations, evaluatorDtos])

    useEffect(() => {
        if (!combinedAnnotations?.length) return
        if (!baselineMetrics || Object.keys(baselineMetrics).length === 0) return
        setAnnotationMetrics((prev) => {
            if (prev && Object.keys(prev).length > 0) return prev
            return baselineMetrics as UpdatedMetricsType
        })
    }, [combinedAnnotations, baselineMetrics])

    const hasPendingAnnotationChanges = useMemo(() => {
        if (!annotationMetrics || Object.keys(annotationMetrics).length === 0) return false
        return Object.entries(annotationMetrics).some(([slug, fields]) => {
            const baseline = (baselineMetrics as any)?.[slug] || {}
            return Object.entries(fields || {}).some(([key, field]) => {
                const nextVal = (field as any)?.value
                const prevVal = (baseline as any)?.[key]?.value
                return !deepEqual(prevVal, nextVal)
            })
        })
    }, [annotationMetrics, baselineMetrics])

    const hasInvocationOutput =
        invocationSteps.some((step) => Boolean(extractOutputs(step))) || traceIds.length > 0

    const hasNewAnnotationMetrics = useMemo(
        () =>
            selectedEvaluators.some((slug) => {
                const fields = annotationMetrics?.[slug]
                if (!fields || Object.keys(fields).length === 0) return false
                return Object.values(fields).some((field: any) => {
                    const val = field?.value
                    if (Array.isArray(val)) return val.length > 0
                    return val !== undefined && val !== null && val !== ""
                })
            }),
        [annotationMetrics, selectedEvaluators],
    )

    const primaryInvocation = invocationSteps[0]
    const traceSpanIds = useMemo(() => {
        const annotationTrace = combinedAnnotations?.[0]?.trace_id
        const annotationSpan =
            combinedAnnotations?.[0]?.span_id ??
            combinedAnnotations?.[0]?.links?.invocation?.span_id

        return {
            traceId:
                primaryInvocation?.traceId ??
                primaryInvocation?.trace_id ??
                annotationTrace ??
                traceIds[0] ??
                "",
            spanId:
                primaryInvocation?.spanId ??
                primaryInvocation?.span_id ??
                (combinedAnnotations?.[0]?.links as any)?.invocation?.span_id ??
                annotationSpan,
        }
    }, [combinedAnnotations, primaryInvocation, traceIds])

    const invocationStepKey = useMemo(
        () =>
            primaryInvocation?.stepKey ??
            primaryInvocation?.step_key ??
            primaryInvocation?.key ??
            "",
        [primaryInvocation],
    )

    const testcaseId =
        (primaryInvocation as any)?.testcaseId ??
        (primaryInvocation as any)?.testcase_id ??
        (primaryInvocation as any)?.testcase?.id
    const testsetId =
        (primaryInvocation as any)?.testsetId ??
        (primaryInvocation as any)?.testset_id ??
        (primaryInvocation as any)?.testset?.id

    const canSubmitAnnotations =
        !!traceSpanIds.traceId &&
        hasInvocationOutput &&
        (hasPendingAnnotationChanges || hasNewAnnotationMetrics)

    const handleAnnotate = useCallback(async () => {
        if (!canSubmitAnnotations) return

        setIsSubmitting(true)
        setErrorMessage([])

        try {
            const {payload: updatePayload, requiredMetrics: requiredExisting} =
                generateAnnotationPayloadData({
                    annotations: (combinedAnnotations as any[]) ?? [],
                    updatedMetrics: annotationMetrics,
                    evaluators: evaluatorDtos as any[],
                    invocationStepKey,
                    testsetId,
                    testcaseId,
                })

            const {payload: newPayload, requiredMetrics: requiredNew} =
                generateNewAnnotationPayloadData({
                    updatedMetrics: annotationMetrics,
                    selectedEvaluators,
                    evaluators: evaluatorDtos as any[],
                    traceSpanIds,
                    invocationStepKey,
                    testsetId,
                    testcaseId,
                })

            const requiredMetrics = {...requiredExisting, ...requiredNew}
            if (Object.keys(requiredMetrics).length > 0) {
                const errors = Object.entries(requiredMetrics).map(([key, data]) => {
                    const val = (data as any)?.value
                    const type = (data as any)?.type
                    return `Value ${val === "" ? "empty string" : val} is not assignable to type ${type} in ${key}`
                })
                setErrorMessage(errors)
                return
            }

            const requests: Promise<any>[] = []

            updatePayload.forEach((entry) => {
                const traceId = entry.trace_id || traceSpanIds.traceId
                const spanId = entry.span_id || traceSpanIds.spanId
                if (!traceId || !spanId) return
                requests.push(
                    updateAnnotation({
                        payload: entry.annotation,
                        traceId,
                        spanId,
                    }),
                )
            })

            newPayload.forEach((entry) => {
                requests.push(createAnnotation(entry as any))
            })

            if (!requests.length) {
                message.info("No annotation changes to submit")
                return
            }

            await Promise.all(requests)
            message.success("Annotations updated successfully")
            annotationsQuery?.refetch?.()
            stepsQuery?.refetch?.()
            setAnnotationMetrics({})
            setTempSelectedEvaluators([])
            onClose()
        } catch (error: any) {
            console.error("Failed to submit annotations", error)
            const apiErrors =
                error?.response?.data?.detail?.map((err: any) => err.msg)?.filter(Boolean) || []
            if (apiErrors.length) {
                setErrorMessage(apiErrors)
            } else {
                message.error("Failed to submit annotations")
            }
        } finally {
            setIsSubmitting(false)
        }
    }, [
        canSubmitAnnotations,
        combinedAnnotations,
        annotationMetrics,
        evaluatorDtos,
        invocationStepKey,
        testsetId,
        testcaseId,
        selectedEvaluators,
        traceSpanIds,
        annotationsQuery,
        stepsQuery,
        onClose,
    ])

    useEffect(() => {
        onStateChange?.({canSubmit: canSubmitAnnotations, isSubmitting})
    }, [canSubmitAnnotations, isSubmitting, onStateChange])

    useEffect(() => {
        registerSubmit?.(handleAnnotate)
    }, [registerSubmit, handleAnnotate])

    if (stepsLoading) {
        return (
            <div className="flex items-center justify-center">
                <Spin size="small" />
            </div>
        )
    }

    return (
        <div className="annotate-control-wrapper flex flex-col gap-3 min-h-[400px]">
            {!hasInvocationOutput ? (
                <div className="text-sm text-neutral-500">
                    To annotate, please generate output for this scenario.
                </div>
            ) : (
                <Annotate
                    annotations={annotationsForAnnotate}
                    updatedMetrics={annotationMetrics}
                    selectedEvaluators={selectedEvaluators}
                    tempSelectedEvaluators={tempSelectedEvaluators}
                    errorMessage={errorMessage}
                    onCaptureError={(errors, addPrev) => {
                        setErrorMessage((prev) => (addPrev ? [...prev, ...errors] : errors))
                    }}
                    setUpdatedMetrics={setAnnotationMetrics}
                    disabled={!hasInvocationOutput}
                />
            )}
        </div>
    )
}

interface VirtualizedScenarioTableAnnotateDrawerProps extends DrawerProps {
    runId?: string
}
const VirtualizedScenarioTableAnnotateDrawer = ({
    runId: propRunId,
    ...props
}: VirtualizedScenarioTableAnnotateDrawerProps) => {
    const store = getDefaultStore()

    // Annotate drawer state (global, per-run)
    const annotateDrawer = useAtomValue(virtualScenarioTableAnnotateDrawerAtom)
    const setAnnotateDrawer = store.set

    const scenarioId = annotateDrawer.scenarioId
    // Use runId from atom state if available, fallback to prop
    const runId = annotateDrawer.runId || propRunId
    const title = annotateDrawer.title || "Annotate scenario"
    const [annotateState, setAnnotateState] = useState<AnnotateActionState>({
        canSubmit: false,
        isSubmitting: false,
    })
    const submitHandlerRef = useRef<(() => Promise<void>) | null>(null)

    useEffect(() => {
        if (!annotateDrawer.open) {
            setAnnotateState({canSubmit: false, isSubmitting: false})
            submitHandlerRef.current = null
        }
    }, [annotateDrawer.open])

    const closeDrawer = useCallback(() => {
        setAnnotateDrawer(
            virtualScenarioTableAnnotateDrawerAtom,
            // @ts-ignore
            (prev) => {
                return {
                    ...prev,
                    open: false,
                }
            },
        )
    }, [])

    const renderTitle = useMemo(
        () => (
            <div className="flex items-center justify-between w-full pr-2">
                <span className="text-base font-medium text-[#0B1F3F]">{title}</span>
                <Button
                    type="primary"
                    disabled={!annotateState.canSubmit}
                    loading={annotateState.isSubmitting}
                    onClick={() => submitHandlerRef.current?.()}
                >
                    Annotate
                </Button>
            </div>
        ),
        [annotateState.canSubmit, annotateState.isSubmitting, title],
    )

    const renderContent = useMemo(() => {
        if (!scenarioId || !runId) {
            return (
                <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
                    No scenario selected.
                </div>
            )
        }
        return (
            <div className="w-full h-full [&_.annotate-control-wrapper]:p-0">
                <PreviewAnnotateContent
                    scenarioId={scenarioId}
                    runId={runId}
                    onClose={closeDrawer}
                    onStateChange={setAnnotateState}
                    registerSubmit={(handler) => {
                        submitHandlerRef.current = handler
                    }}
                />
            </div>
        )
    }, [closeDrawer, runId, scenarioId])

    return (
        <EnhancedDrawer
            title={renderTitle}
            width={400}
            classNames={{body: "!p-0"}}
            onClose={closeDrawer}
            open={annotateDrawer.open}
            {...props}
        >
            {renderContent}
        </EnhancedDrawer>
    )
}

export default memo(VirtualizedScenarioTableAnnotateDrawer)
