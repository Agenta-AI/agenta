import Mock from "@/components/pages/evaluations/evaluationResults/mock"
import axios from "@/lib//helpers/axiosConfig"
import {
    EvaluationStatus,
    Evaluator,
    EvaluatorConfig,
    _Evaluation,
    _EvaluationScenario,
} from "@/lib/Types"
import {getTagColors} from "@/lib/helpers/colors"
import {delay, pickRandom, stringToNumberInRange} from "@/lib/helpers/utils"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

//Evaluators
export const fetchAllEvaluators = async () => {
    const tagColors = getTagColors()

    await delay(1000)
    return Mock.evaluators

    const response = await axios.get(`/api/evaluators/`)
    return (response.data || []).map((item: Evaluator) => ({
        ...item,
        color: tagColors[stringToNumberInRange(item.key, 0, tagColors.length - 1)],
    })) as Evaluator[]
}

// Evaluator Configs
export const fetchAllEvaluatorConfigs = async (appId: string) => {
    await delay(1000)
    return Mock.evaluatorConfigs

    const response = await axios.get(`/api/evaluators/configs`)
    return response.data as EvaluatorConfig[]
}

export const deleteEvaluatorConfig = async (appId: string, configId: string) => {
    return axios.delete(`/api/evaluators/configs/${configId}`)
}

export type CreateEvaluationConfigData = Omit<EvaluatorConfig, "id" | "created_at">
export const createEvaluatorConfig = async (appId: string, config: CreateEvaluationConfigData) => {
    await delay(1000)
    return console.log("create evaluation config", config)
    return axios.post(`/api/evaluators/configs`, {...config, app_id: appId})
}

// Evaluations
export const fetchAllEvaluations = async (appId: string) => {
    await delay(1000)
    return Mock.evaluations

    const response = await axios.get(`/api/evaluations`, {params: {app_id: appId}})
    return response.data as _Evaluation[]
}

export const fetchEvaluation = async (appId: string, evaluationId: string) => {
    await delay(1000)
    return Mock.evaluations[0]

    const response = await axios.get(`/api/evaluations/${evaluationId}`, {
        params: {app_id: appId},
    })
    return response.data as _Evaluation
}

export const fetchEvaluationStatus = async (appId: string, evaluationId: string) => {
    await delay(1000)
    return {status: pickRandom(Object.values(EvaluationStatus), 1)[0]}

    const response = await axios.get(`/api/evaluations/${evaluationId}/status`, {
        params: {app_id: appId},
    })
    return response.data as {status: EvaluationStatus}
}

export type CreateEvaluationData = {
    testset: string[]
    variants: string[]
    evaluator_configs: string[]
}
export const createEvalutaiton = async (appId: string, evaluation: CreateEvaluationData) => {
    await delay(1000)
    return console.log("create evaluation", evaluation)
    return axios.post(`/api/evaluations`, {...evaluation, app_id: appId})
}

// Evaluation Scenarios
export const fetchAllEvaluationScenarios = async (appId: string, evaluationId: string) => {
    await delay(1000)
    return Mock.evaluationScenarios

    const response = await axios.get(`/api/evaluations/${evaluationId}/evaluation_scenarios`, {
        params: {app_id: appId},
    })
    return response.data as _EvaluationScenario[]
}
