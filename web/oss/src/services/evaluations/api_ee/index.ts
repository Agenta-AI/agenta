import {
    EvaluatorInputInterface,
    EvaluatorMappingInput,
    EvaluatorMappingOutput,
    EvaluatorOutputInterface,
} from "@agenta/oss/src/lib/types_ee"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const createEvaluatorDataMapping = async (
    config: EvaluatorMappingInput,
): Promise<EvaluatorMappingOutput> => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/evaluators/map?project_id=${projectId}`,
        {...config},
    )
    return response.data
}

export const createEvaluatorRunExecution = async (
    evaluatorKey: string,
    config: EvaluatorInputInterface,
): Promise<EvaluatorOutputInterface> => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/evaluators/${evaluatorKey}/run?project_id=${projectId}`,
        {
            ...config,
        },
    )
    return response.data
}
