import axios from "@/oss/lib/api/assets/axiosConfig"
import {buildEvaluatorUri, resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import type {SimpleEvaluator} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

export interface WorkflowServiceStatus {
    code?: number
    message?: string
    type?: string
    stacktrace?: string[] | string
}

export interface WorkflowServiceBatchResponse {
    version?: string
    trace_id?: string
    span_id?: string
    status?: WorkflowServiceStatus
    data?: {
        outputs?: any
    }
}

export interface WorkflowServiceReference {
    id?: string
    slug?: string
    version?: string
}

export interface WorkflowServiceLink {
    trace_id: string
    span_id: string
}

export interface InvokeEvaluatorOptions {
    signal?: AbortSignal
    timeout?: number
}

export interface InvokeEvaluatorParams {
    uri?: string
    url?: string
    evaluator?: Partial<SimpleEvaluator> | null
    inputs?: Record<string, any>
    outputs?: any
    trace?: any
    parameters?: Record<string, any>
    references?: Record<string, WorkflowServiceReference>
    links?: Record<string, WorkflowServiceLink>
    options?: InvokeEvaluatorOptions
}

export interface InvokeApplicationParams {
    uri?: string
    url?: string
    inputs?: Record<string, any>
    parameters?: Record<string, any>
    references?: Record<string, WorkflowServiceReference>
    links?: Record<string, WorkflowServiceLink>
    options?: InvokeEvaluatorOptions
}

const DEFAULT_EVALUATOR_TIMEOUT = 120_000

export const invokeEvaluator = async ({
    uri,
    url,
    evaluator,
    inputs,
    outputs,
    trace,
    parameters,
    references,
    links,
    options,
}: InvokeEvaluatorParams): Promise<WorkflowServiceBatchResponse> => {
    const {projectId} = getProjectValues()
    const evaluatorKey = resolveEvaluatorKey(evaluator)
    const explicitUri = typeof uri === "string" ? uri.trim() : ""
    const explicitUrl = typeof url === "string" ? url.trim() : ""
    const evaluatorUri =
        explicitUri ||
        evaluator?.data?.uri ||
        (evaluatorKey ? buildEvaluatorUri(evaluatorKey) : undefined)
    const evaluatorUrl = explicitUrl || evaluator?.data?.url

    if (!evaluatorUri && !evaluatorUrl) {
        throw new Error("Evaluator interface is missing (uri/url)")
    }

    const request: Record<string, any> = {
        interface: evaluatorUri ? {uri: evaluatorUri} : {url: evaluatorUrl},
        configuration: parameters ? {parameters} : undefined,
        references,
        links,
        data: {
            inputs,
            outputs,
            trace,
            parameters,
        },
    }

    const timeout = options?.timeout ?? DEFAULT_EVALUATOR_TIMEOUT

    const response = await axios.post<WorkflowServiceBatchResponse>(
        `${getAgentaApiUrl()}/workflows/invoke?project_id=${projectId}`,
        request,
        {
            signal: options?.signal,
            timeout,
        },
    )

    return response.data
}

export const invokeApplication = async ({
    uri,
    url,
    inputs,
    parameters,
    references,
    links,
    options,
}: InvokeApplicationParams): Promise<WorkflowServiceBatchResponse> => {
    const {projectId} = getProjectValues()
    const explicitUri = typeof uri === "string" ? uri.trim() : ""
    const explicitUrl = typeof url === "string" ? url.trim() : ""

    if (!explicitUri && !explicitUrl) {
        throw new Error("Application interface is missing (uri/url)")
    }

    const request: Record<string, any> = {
        interface: explicitUri ? {uri: explicitUri} : {url: explicitUrl},
        configuration: parameters ? {parameters} : undefined,
        references,
        links,
        data: {
            inputs,
            parameters,
        },
    }

    const timeout = options?.timeout ?? DEFAULT_EVALUATOR_TIMEOUT

    const response = await axios.post<WorkflowServiceBatchResponse>(
        `${getAgentaApiUrl()}/preview/workflows/invoke?project_id=${projectId}`,
        request,
        {
            signal: options?.signal,
            timeout,
        },
    )

    return response.data
}

export const mapWorkflowResponseToOutputs = (
    response: WorkflowServiceBatchResponse,
): {outputs: Record<string, any>} => {
    const statusType = response.status?.type?.toLowerCase()
    const hasErrorType =
        statusType === "error" || statusType === "failure" || statusType === "failed"
    if ((response.status?.code && response.status.code >= 400) || hasErrorType) {
        throw new Error(response.status.message || "Evaluator execution failed")
    }

    return {
        outputs: response.data?.outputs ?? {},
    }
}

export const mapWorkflowResponseToEvaluatorOutput = mapWorkflowResponseToOutputs
