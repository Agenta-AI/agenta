import {CardProps} from "antd"

import {IStepResponse} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

export interface ScenarioAnnotationPanelProps {
    runId: string
    scenarioId: string
    className?: string
    classNames?: CardProps["classNames"]
    buttonClassName?: string
    invStep?: IStepResponse
    annotationsByStep?: Record<string, IStepResponse[]>
    evaluators?: EvaluatorDto[]
    onAnnotate?: () => void
}
