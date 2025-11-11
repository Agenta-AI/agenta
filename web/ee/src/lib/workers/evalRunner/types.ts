import {EvaluationStatus} from "@/oss/lib/Types"

import {IStepResponse} from "../../hooks/useEvaluationRunScenarioSteps/types"

export interface RunEvalMessage {
    type: "run-invocation"
    jwt: string
    appId: string
    scenarioId: string
    runId: string
    apiUrl: string
    requestBody: Record<string, any>
    projectId: string
    endpoint: string
    invocationKey?: string
    invocationStepTarget?: IStepResponse
}

export interface ResultMessage {
    type: "result"
    scenarioId: string
    status: EvaluationStatus
    result?: any
    error?: string
    invocationStepTarget?: IStepResponse
    invocationKey?: string
}

export interface JwtUpdateMessage {
    type: "UPDATE_JWT"
    jwt: string
}

export interface ConfigMessage {
    type: "config"
    maxConcurrent: number
}

export type WorkerMessage = RunEvalMessage | ConfigMessage | JwtUpdateMessage
