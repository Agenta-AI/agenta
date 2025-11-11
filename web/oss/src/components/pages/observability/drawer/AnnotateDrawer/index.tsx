import {useCallback, useEffect, useMemo, useState} from "react"

import dynamic from "next/dynamic"
import {useLocalStorage} from "usehooks-ts"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {useProjectData} from "@/oss/contexts/project.context"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"

import {AnnotateDrawerSteps} from "./assets/enum"
import {AnnotateDrawerProps, AnnotateDrawerStepsType, UpdatedMetricsType} from "./assets/types"
import {isAnnotationCreatedByCurrentUser} from "./assets/utils"

const Annotate = dynamic(() => import("./assets/Annotate"), {ssr: false})
const SelectEvaluators = dynamic(() => import("./assets/SelectEvaluators"), {ssr: false})
const CreateEvaluator = dynamic(() => import("./assets/CreateEvaluator"), {ssr: false})
const AnnotateDrawerTitle = dynamic(() => import("./assets/AnnotateDrawerTitle"), {ssr: false})

const AnnotateDrawer = ({
    data,
    traceSpanIds,
    showOnly,
    evalSlugs,
    ...props
}: AnnotateDrawerProps) => {
    const {projectId} = useProjectData()
    const {data: evaluators} = useEvaluators({
        preview: true,
        queries: {is_human: true},
    })
    const evalLSKey = `${projectId}-evaluator`

    const [annotations, setAnnotations] = useState<AnnotationDto[]>([])
    const [steps, setSteps] = useState<AnnotateDrawerStepsType>(AnnotateDrawerSteps.ANNOTATE)
    const [updatedMetrics, setUpdatedMetrics] = useState<UpdatedMetricsType>({})
    const [selectedEvaluators, setSelectedEvaluators] = useLocalStorage<string[]>(evalLSKey, [])
    const [errorMessage, setErrorMessage] = useState<string[]>([])
    // tempSelectedEvaluators is used to store those eval which we have on the annotations but the condition
    // to display annotation are not matched so we pick the eval slug from those ann an generate a new annotation with empty value
    const [tempSelectedEvaluators, setTempSelectedEvaluators] = useState<string[]>([])

    useEffect(() => {
        if (!props.open) return

        // 1. Sort annotations by createdAt (newest first)
        const sortedAnnotations = [...(data || [])].sort((a, b) => {
            const aDate = a.createdAt ? new Date(a.createdAt) : new Date(0)
            const bDate = b.createdAt ? new Date(b.createdAt) : new Date(0)
            return bDate.getTime() - aDate.getTime()
        })

        // 2. Remove duplicate evaluator slugs, keeping only the latest annotation for each slug
        const latestBySlug: Record<string, AnnotationDto> = {}
        for (const ann of sortedAnnotations) {
            const slug = ann.references?.evaluator?.slug
            if (!slug) continue
            // Always overwrite, so the last one (latest by createdAt due to sorting) stays
            latestBySlug[slug] = ann
        }
        const getLatestAnnFromSameEvals = Object.values(latestBySlug)

        // creating evaluator order
        const evaluatorOrder: Record<string, number> = {}
        evaluators?.forEach((ev, idx) => {
            evaluatorOrder[ev.slug] = idx
        })

        // 3. sorting annotations by evaluator order
        const sortAnnotationsByEval = getLatestAnnFromSameEvals.slice().sort((a, b) => {
            const aSlug = a.references?.evaluator?.slug || ""
            const bSlug = b.references?.evaluator?.slug || ""
            return (evaluatorOrder[aSlug] ?? 0) - (evaluatorOrder[bSlug] ?? 0)
        })

        const filteredAnn = sortAnnotationsByEval?.filter((ann) =>
            isAnnotationCreatedByCurrentUser(ann),
        )
        setAnnotations(filteredAnn || [])

        // 4. Get annotations NOT matching the user/web/human condition
        const filteredAnnForEval = sortAnnotationsByEval.filter(
            (ann) => !isAnnotationCreatedByCurrentUser(ann),
        )

        // 5. Get unique slugs and update tempSelectedEvaluators
        if (filteredAnnForEval.length > 0) {
            const evalSlugs = filteredAnnForEval
                .map((ann) => ann.references?.evaluator?.slug)
                .filter(Boolean) as string[]

            setTempSelectedEvaluators((prev) => [...new Set([...prev, ...evalSlugs])])
        }
    }, [data, props.open])

    const annEvalSlugs = useMemo(() => {
        return (
            (annotations
                .map((ann) => ann.references?.evaluator?.slug)
                .filter(Boolean) as string[]) || []
        )
    }, [annotations])

    const _selectedEvaluators = useMemo(() => {
        if (data && data?.length > 0 && !annotations?.length) {
            return []
        } else if (selectedEvaluators.length > 0) {
            const selectedEval = selectedEvaluators.filter(
                (evaluator) => !annEvalSlugs.includes(evaluator),
            )
            const newSetOfEval = new Set([...selectedEval, ...tempSelectedEvaluators])
            return [...newSetOfEval]
        } else if (tempSelectedEvaluators.length > 0) {
            const newSetOfTempEval = new Set(tempSelectedEvaluators)
            return [...newSetOfTempEval]
        } else if (evalSlugs && evalSlugs.length > 0) {
            const newSetOfEvalSlugs = new Set(evalSlugs)
            return [...newSetOfEvalSlugs]
        } else {
            return []
        }
    }, [selectedEvaluators, tempSelectedEvaluators, annEvalSlugs, evalSlugs])

    const onClose = useCallback(() => {
        props?.onClose?.({} as any)
    }, [])

    const onAfterClose = useCallback(
        (open: boolean) => {
            if (!open) {
                setSteps(AnnotateDrawerSteps.ANNOTATE)
                setTempSelectedEvaluators([])
                setAnnotations([])
                setErrorMessage([])
                setUpdatedMetrics({})
            }
        },
        [props.afterOpenChange],
    )

    const onCaptureError = useCallback(
        (error: string[], addPrevVal = true) => {
            if (error.length > 0) {
                setErrorMessage((prev) => [...new Set(addPrevVal ? [...prev, ...error] : error)])
            } else {
                setErrorMessage([])
            }
        },
        [setErrorMessage],
    )

    const renderContent = useMemo(() => {
        switch (steps) {
            case AnnotateDrawerSteps.ANNOTATE:
                return (
                    <Annotate
                        annotations={annotations || []}
                        updatedMetrics={updatedMetrics}
                        setUpdatedMetrics={setUpdatedMetrics}
                        selectedEvaluators={_selectedEvaluators}
                        tempSelectedEvaluators={tempSelectedEvaluators}
                        errorMessage={errorMessage}
                        onCaptureError={onCaptureError}
                    />
                )
            case AnnotateDrawerSteps.SELECT_EVALUATORS:
                return (
                    <SelectEvaluators
                        selectedEvaluators={_selectedEvaluators}
                        annEvalSlugs={annEvalSlugs || []}
                        setSelectedEvaluators={setSelectedEvaluators}
                        setTempSelectedEvaluators={setTempSelectedEvaluators}
                    />
                )
            case AnnotateDrawerSteps.CREATE_EVALUATOR:
                return (
                    <CreateEvaluator
                        setSteps={setSteps}
                        setSelectedEvaluators={setSelectedEvaluators}
                    />
                )
            default:
                return null
        }
    }, [
        steps,
        annotations,
        updatedMetrics,
        _selectedEvaluators,
        tempSelectedEvaluators,
        errorMessage,
    ])

    return (
        <EnhancedDrawer
            {...props}
            title={
                <AnnotateDrawerTitle
                    updatedMetrics={updatedMetrics}
                    selectedEvaluators={_selectedEvaluators}
                    annotations={annotations || []}
                    steps={steps}
                    setSteps={setSteps}
                    onClose={onClose}
                    onCaptureError={onCaptureError}
                    traceSpanIds={traceSpanIds}
                    showOnly={showOnly}
                />
            }
            closeIcon={null}
            width={400}
            onClose={onClose}
            classNames={{body: "!p-0", header: "!p-4"}}
            afterOpenChange={onAfterClose}
        >
            {renderContent}
        </EnhancedDrawer>
    )
}

export default AnnotateDrawer
