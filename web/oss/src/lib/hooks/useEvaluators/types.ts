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

export interface EvaluatorRevisionDto {
    id?: string
    slug?: string
    evaluator_id?: string
    evaluator_variant_id?: string
    version?: string
    data?: Record<string, any>
    flags?: Record<string, any>
    meta?: Record<string, any>
    tags?: Record<string, unknown>
}

export interface EvaluatorRevisionsResponseDto {
    count?: number
    evaluator_revisions?: EvaluatorRevisionDto[]
}

export type EvaluatorPreviewDto = EvaluatorDto<"payload"> &
    EvaluatorDto<"response"> & {
        /**
         * Computed metrics schema derived from EvaluatorDto.data
         */
        metrics: Record<string, unknown>
        revision?: EvaluatorRevisionDto
    }

type EvaluatorDtoBase = {
    name: string
    slug: string
    key?: string
    description: string
    data: EvaluatorData
    tags?: string[] | Record<string, unknown> | string
    flags?: Record<string, any>
    meta?: Record<string, any>
    requires_llm_api_keys?: boolean
}

export type EvaluatorDto<T extends "payload" | "response" = "response"> = EvaluatorDtoBase &
    (T extends "response" ? {id: string; created_at: string; created_by_id: string} : {id?: string})

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
