import {DrawerProps} from "antd"

import {TooltipButtonProps} from "@/oss/components/EnhancedUIs/Button"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"

import {AnnotateDrawerSteps} from "./enum"

export type AnnotateDrawerStepsType = AnnotateDrawerSteps
export interface ShowOnlyType {
    annotateUi?: boolean
    selectEvaluatorsUi?: boolean
    createEvaluatorUi?: boolean
}
export interface UpdatedMetricType {
    value: any
    type: string
    minimum?: number
    maximum?: number
}
export type UpdatedMetricsType = Record<string, Record<string, UpdatedMetricType>>
export interface AnnotateDrawerIdsType {
    traceId: string
    spanId: string
}
export interface AnnotateDrawerProps extends DrawerProps {
    data?: AnnotationDto[]
    traceSpanIds?: AnnotateDrawerIdsType
    showOnly?: ShowOnlyType
    evalSlugs?: string[]
    initialStep?: AnnotateDrawerStepsType
    createEvaluatorProps?: Partial<CreateEvaluatorProps>
    closeOnLayoutClick?: boolean
    queryKey?: string
}

export interface AnnotateDrawerTitleProps {
    updatedMetrics?: UpdatedMetricsType
    selectedEvaluators?: string[]
    annotations?: AnnotationDto[]
    steps: AnnotateDrawerStepsType
    traceSpanIds?: AnnotateDrawerIdsType
    setSteps: React.Dispatch<React.SetStateAction<AnnotateDrawerStepsType>>
    onClose: () => void
    onCaptureError?: (error: string[], addPrevVal?: boolean) => void
    showOnly?: ShowOnlyType
    queryKey?: string
}

export interface AnnotateDrawerButtonProps extends TooltipButtonProps {
    children?: React.ReactNode
    label?: React.ReactNode
    data?: AnnotationDto[]
    traceSpanIds?: AnnotateDrawerIdsType
    showOnly?: ShowOnlyType
    evalSlugs?: string[]
    queryKey?: string
    icon?: boolean
    size?: "small" | "middle" | "large"
}

export interface AnnotateProps {
    annotations: AnnotationDto[]
    updatedMetrics: UpdatedMetricsType
    selectedEvaluators: string[]
    tempSelectedEvaluators?: string[]
    errorMessage?: string[]
    disabled?: boolean
    onCaptureError?: (error: string[], addPrevVal?: boolean) => void
    setUpdatedMetrics: React.Dispatch<React.SetStateAction<UpdatedMetricsType>>
}

export interface SelectEvaluatorsProps {
    selectedEvaluators: string[]
    setSelectedEvaluators: React.Dispatch<React.SetStateAction<string[]>>
    setTempSelectedEvaluators: React.Dispatch<React.SetStateAction<string[]>>
    annEvalSlugs: string[]
}

export interface CreateEvaluatorProps {
    setSteps?: React.Dispatch<React.SetStateAction<AnnotateDrawerStepsType>>
    setSelectedEvaluators?: React.Dispatch<React.SetStateAction<string[]>>
    mode?: "create" | "edit"
    evaluator?: EvaluatorPreviewDto & {
        id?: string
        flags?: Record<string, any>
        meta?: Record<string, any>
        tags?: Record<string, any>
    }
    onSuccess?: (slug: string) => void | Promise<void>
    skipPostCreateStepChange?: boolean
}
