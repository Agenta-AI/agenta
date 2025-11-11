import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

import {
    EvaluatorInputInterface,
    EvaluatorMappingInput,
    EvaluatorMappingOutput,
    EvaluatorOutputInterface,
} from "../../../lib/types_ee"

export const createEvaluatorDataMapping = async (
    config: EvaluatorMappingInput,
): Promise<EvaluatorMappingOutput> => {
    const {projectId} = getCurrentProject()

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
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/evaluators/${evaluatorKey}/run?project_id=${projectId}`,
        {
            ...config,
        },
    )
    return response.data
}
