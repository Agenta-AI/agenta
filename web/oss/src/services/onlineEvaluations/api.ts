import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

const getProjectUrl = (path: string) => {
    const {projectId} = getProjectValues()
    return `${getAgentaApiUrl()}${path}?project_id=${projectId}`
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
