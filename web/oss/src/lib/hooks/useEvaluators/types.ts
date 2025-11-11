import {SWRConfiguration} from "swr"

export interface EvaluatorData {
    service: {
        agenta: string
        format: {
            type: string
            $schema: string
            required: string[]
            properties: {
                outputs: {
                    type: string
                    properties: Record<string, any>
                    required: string[]
                }
            }
        }
    }
}

export type EvaluatorPreviewDto = EvaluatorDto & {
    /**
     * Computed metrics schema derived from EvaluatorDto.data
     */
    metrics: Record<string, unknown>
}

export type EvaluatorDto<T extends "payload" | "response" = "response"> = {
    name: string
    slug: string
    description: string
    data: EvaluatorData
} & (T extends "response"
    ? {id: string; created_at: string; created_by_id: string}
    : {meta: Record<string, any>; flags: Record<string, any>})

export type EvaluatorResponseDto<T extends "payload" | "response" = "response"> =
    T extends "response"
        ? {count: number; evaluator: EvaluatorDto<T>}
        : {evaluator: EvaluatorDto<T>}

export type EvaluatorsResponseDto<T extends "payload" | "response" = "response"> =
    T extends "response"
        ? {count: number; evaluators: EvaluatorDto<T>[]}
        : {evaluators: EvaluatorDto<T>[]}

export interface UseEvaluatorsOptions extends SWRConfiguration {
    preview?: boolean
    projectId?: string
}

