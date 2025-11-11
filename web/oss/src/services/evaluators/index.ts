import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {EvaluatorResponseDto} from "@/oss/lib/hooks/useEvaluators/types"

//Prefix convention:
//  - create: POST data to server

export const createEvaluator = async (evaluatorPayload: EvaluatorResponseDto<"payload">) => {
    const {projectId} = getCurrentProject()

    return await axios.post(
        `${getAgentaApiUrl()}/api/preview/evaluators/?project_id=${projectId}`,
        evaluatorPayload,
    )
}
