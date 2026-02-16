import {EvaluatorInputInterface, EvaluatorOutputInterface} from "@agenta/oss/src/lib/types_ee"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export interface EvaluatorRunOptions {
    signal?: AbortSignal
    timeout?: number
}

const DEFAULT_EVALUATOR_TIMEOUT = 120_000 // 2 minutes

export const createEvaluatorRunExecution = async (
    evaluatorKey: string,
    config: EvaluatorInputInterface,
    options?: EvaluatorRunOptions,
): Promise<EvaluatorOutputInterface> => {
    const {projectId} = getProjectValues()
    const timeout = options?.timeout ?? DEFAULT_EVALUATOR_TIMEOUT

    const response = await axios.post(
        `${getAgentaApiUrl()}/evaluators/${evaluatorKey}/run?project_id=${projectId}`,
        {
            ...config,
        },
        {
            signal: options?.signal,
            timeout,
        },
    )
    return response.data
}
