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

export interface InvokeEvaluatorOptions {
    signal?: AbortSignal
    timeout?: number
}

export interface InvokeEvaluatorParams {
    evaluator?: Partial<SimpleEvaluator> | null
    inputs?: Record<string, any>
    outputs?: any
    parameters?: Record<string, any>
    options?: InvokeEvaluatorOptions
}

const DEFAULT_EVALUATOR_TIMEOUT = 120_000

export const invokeEvaluator = async ({
    evaluator,
    inputs,
    outputs,
    parameters,
    options,
}: InvokeEvaluatorParams): Promise<WorkflowServiceBatchResponse> => {
    const {projectId} = getProjectValues()
    const evaluatorKey = resolveEvaluatorKey(evaluator)
    const evaluatorUri =
        evaluator?.data?.uri || (evaluatorKey ? buildEvaluatorUri(evaluatorKey) : undefined)

    if (!evaluatorUri) {
        throw new Error("Evaluator URI is missing")
    }

    const request: Record<string, any> = {
        interface: {uri: evaluatorUri},
        configuration: parameters ? {parameters} : undefined,
        data: {
            inputs,
            outputs,
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

export const mapWorkflowResponseToEvaluatorOutput = (
    response: WorkflowServiceBatchResponse,
): {outputs: Record<string, any>} => {
    if (response.status?.code && response.status.code >= 400) {
        throw new Error(response.status.message || "Evaluator execution failed")
    }

    return {
        outputs: response.data?.outputs ?? {},
    }
}
