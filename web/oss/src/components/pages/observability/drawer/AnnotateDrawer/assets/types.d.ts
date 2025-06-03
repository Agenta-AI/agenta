import {DrawerProps} from "antd"

import {TooltipButtonProps} from "@/oss/components/Playground/assets/EnhancedButton"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

import {AnnotateDrawerSteps} from "./enum"

export type AnnotateDrawerStepsType = AnnotateDrawerSteps
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
    traceSpanIds: AnnotateDrawerIdsType
}

export interface AnnotateDrawerTitleProps {
    updatedMetrics: UpdatedMetricsType
    selectedEvaluators: string[]
    annotations: AnnotationDto[]
    steps: AnnotateDrawerStepsType
    setSteps: React.Dispatch<React.SetStateAction<AnnotateDrawerStepsType>>
    onClose: () => void
    traceSpanIds: AnnotateDrawerIdsType
    onCaptureError?: (error: string[], addPrevVal?: boolean) => void
}

export interface AnnotateDrawerButtonProps extends TooltipButtonProps {
    children?: React.ReactNode
    label?: React.ReactNode
    data?: AnnotationDto[]
    traceSpanIds: AnnotateDrawerIdsType
}

export interface AnnotateProps {
    annotations: AnnotationDto[]
    updatedMetrics: UpdatedMetricsType
    setUpdatedMetrics: React.Dispatch<React.SetStateAction<UpdatedMetricsType>>
    selectedEvaluators: string[]
    tempSelectedEvaluators: string[]
    errorMessage?: string[]
    onCaptureError?: (error: string[], addPrevVal?: boolean) => void
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
}
