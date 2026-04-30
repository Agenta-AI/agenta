import {EvaluatorPreviewDto} from "@/oss/services/evaluations/api/evaluatorTypes"

export type EvaluatorCategory = "automatic" | "human"

export type EvaluatorPreview = EvaluatorPreviewDto & {
    flags?: Record<string, any>
    meta?: Record<string, any>
    createdAt?: string
    createdBy?: string
    createdById?: string
    updated_at?: string
    updatedAt?: string
    updated_by?: string
    metrics?: Record<string, unknown>
}
