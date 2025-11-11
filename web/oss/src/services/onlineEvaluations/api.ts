import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

type LogicalOperator = "and" | "or" | "not" | "nand" | "nor"

export interface QueryConditionPayload {
    field: string
    key?: string
    value?: unknown
    operator?: string
    options?: Record<string, unknown>
}

export interface QueryFilteringPayload {
    operator?: LogicalOperator
    conditions: (QueryConditionPayload | QueryFilteringPayload)[]
}

export interface QueryWindowingPayload {
    newest?: string
    oldest?: string
    next?: string
    limit?: number
    order?: "ascending" | "descending"
    interval?: number
    rate?: number
}

export interface QueryRevisionDataPayload {
    filtering?: QueryFilteringPayload
    windowing?: QueryWindowingPayload
}

export interface SimpleQueryCreatePayload {
    slug: string
    name?: string
    description?: string
    flags?: Record<string, unknown>
    tags?: Record<string, unknown>
    meta?: Record<string, unknown>
    data?: QueryRevisionDataPayload
}

export interface SimpleQueryCreateRequest {
    query: SimpleQueryCreatePayload
}

export interface SimpleQueryResponse {
    count: number
    query?: {
        id: string
        slug?: string
        data?: QueryRevisionDataPayload
        meta?: Record<string, unknown>
    } | null
}

export interface QueryRevisionRetrieveRequest {
    query_ref?: {id?: string; slug?: string} | null
    query_variant_ref?: {id?: string; slug?: string} | null
    query_revision_ref?: {id?: string; slug?: string} | null
}

export interface QueryRevisionResponse {
    count: number
    query_revision?: {
        id?: string
        slug?: string
        variant_id?: string
        version?: string | number
        data?: QueryRevisionDataPayload
    } | null
}

export interface SimpleEvaluationFlagsPayload {
    is_live?: boolean
    is_closed?: boolean
    is_active?: boolean
}

export interface SimpleEvaluationDataPayload {
    status?: string
    query_steps?: string[] | Record<string, string>
    testset_steps?: Record<string, string>
    application_steps?: Record<string, string>
    evaluator_steps?: string[] | Record<string, string>
    repeats?: number
    // Structured references for online evaluations
    query_ref?: {id?: string; slug?: string} | null
    query_revision_ref?: {id?: string; slug?: string} | null
    evaluator_ref?: {id?: string; slug?: string} | null
    configuration?: Record<string, unknown>
}

export interface SimpleEvaluationCreatePayload {
    name?: string
    description?: string
    flags?: SimpleEvaluationFlagsPayload
    tags?: Record<string, unknown>
    meta?: Record<string, unknown>
    data: SimpleEvaluationDataPayload
}

export interface SimpleEvaluationCreateRequest {
    evaluation: SimpleEvaluationCreatePayload
}

export interface SimpleEvaluationResponse {
    count: number
    evaluation?: SimpleEvaluationPayload | null
}

export interface SimpleEvaluationPayload {
    id?: string
    slug?: string
    name?: string
    description?: string
    created_at?: string
    updated_at?: string
    created_by_id?: string
    updated_by_id?: string
    flags?: SimpleEvaluationFlagsPayload
    data?: SimpleEvaluationDataPayload
    meta?: Record<string, unknown>
    tags?: Record<string, unknown>
}

export interface SimpleEvaluationsResponse {
    count: number
    evaluations: SimpleEvaluationPayload[]
}

export interface SimpleEvaluationsQueryRequest {
    evaluation?: {
        flags?: SimpleEvaluationFlagsPayload
        ids?: string[]
    }
    tags?: Record<string, unknown>
    meta?: Record<string, unknown>
}

const getProjectUrl = (path: string) => {
    const {projectId} = getProjectValues()
    return `${getAgentaApiUrl()}${path}?project_id=${projectId}`
}

export const createSimpleQuery = async (
    payload: SimpleQueryCreateRequest,
): Promise<SimpleQueryResponse> => {
    const {data} = await axios.post(getProjectUrl("/preview/simple/queries/"), payload)
    return data as SimpleQueryResponse
}

export const retrieveQueryRevision = async (
    payload: QueryRevisionRetrieveRequest,
): Promise<QueryRevisionResponse> => {
    const {data} = await axios.post(getProjectUrl("/preview/queries/revisions/retrieve"), payload)
    return data as QueryRevisionResponse
}

export const createSimpleEvaluation = async (
    payload: SimpleEvaluationCreateRequest,
): Promise<SimpleEvaluationResponse> => {
    const {data} = await axios.post(getProjectUrl("/preview/simple/evaluations/"), payload)
    return data as SimpleEvaluationResponse
}

export const querySimpleEvaluations = async (
    payload?: SimpleEvaluationsQueryRequest,
): Promise<SimpleEvaluationsResponse> => {
    const url = getProjectUrl("/preview/simple/evaluations/query")
    const body = payload ?? {}
    const {data} = await axios.post(url, body)
    return data as SimpleEvaluationsResponse
}

export const stopSimpleEvaluation = async (evaluationId: string) => {
    const url = getProjectUrl(`/preview/simple/evaluations/${evaluationId}/stop`)
    const {data} = await axios.post(url)
    return data
}

export const startSimpleEvaluation = async (evaluationId: string) => {
    const url = getProjectUrl(`/preview/simple/evaluations/${evaluationId}/start`)
    const {data} = await axios.post(url)
    return data
}
