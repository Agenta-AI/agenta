import {useState, useCallback, memo} from "react"

import {Button} from "antd"
import {useAtomValue} from "jotai"

import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {scenarioUiFlagsFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/progress"
import {getProjectValues} from "@/oss/state/project"

import {buildAnnotationContext} from "../../assets/annotationUtils"
import {handleAnnotate, handleUpdateAnnotate} from "../../assets/helpers"

import {AnnotateScenarioButtonProps} from "./types"

const AnnotateScenarioButton = ({
    runId,
    scenarioId,
    stepKey,
    updatedMetrics,
    formatErrorMessages,
    setErrorMessages,
    disabled = false,
    label = "Annotate",
    isAnnotated = false,
    onAnnotate: propsOnAnnotate,
    className,
}: AnnotateScenarioButtonProps) => {
    const [annotating, setAnnotating] = useState(false)
    const store = evalAtomStore()
    const uiFlags = useAtomValue(scenarioUiFlagsFamily({scenarioId, runId}), {store})
    const isLoading = annotating || uiFlags.isAnnotating || uiFlags.isRevalidating

    const onAnnotate = useCallback(async () => {
        try {
            setAnnotating(true)

            const ctx = await buildAnnotationContext({scenarioId, stepKey, runId})
            if (!ctx) return
            const {evaluators, stepData} = ctx
            const annotations = stepData?.annotationSteps
                ?.map((s) => s.annotation)
                .filter(Boolean) as AnnotationDto[]

            const annEvalSlugs = annotations
                .map((a) => a.references?.evaluator?.slug)
                .filter(Boolean) as string[]
            const selectedEval = evaluators
                .map((e) => e.slug)
                .filter((evaluator) => !annEvalSlugs.includes(evaluator))

            if (selectedEval.length > 0) {
                await handleAnnotate({
                    runId,
                    scenarioId,
                    updatedMetrics,
                    formatErrorMessages,
                    setErrorMessages,
                    projectId: getProjectValues().projectId,
                    stepKey,
                })
            }

            if (annotations.length > 0) {
                await handleUpdateAnnotate({
                    runId,
                    scenarioId,
                    updatedMetrics,
                    formatErrorMessages,
                    setErrorMessages,
                    projectId: getProjectValues().projectId,
                    stepKey,
                })
            }
        } catch (error) {
            console.error("Failed to annotate scenario", error)
        } finally {
            propsOnAnnotate?.()
            setAnnotating(false)
        }
    }, [runId, scenarioId, stepKey, updatedMetrics, formatErrorMessages, setErrorMessages])

    return (
        <Button
            type="primary"
            loading={isLoading}
            disabled={disabled || isLoading}
            onClick={onAnnotate}
            className={className}
        >
            {label}
        </Button>
    )
}

export default memo(AnnotateScenarioButton)
