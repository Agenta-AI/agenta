import axios from "@/lib//helpers/axiosConfig"
import {
    EvaluationResponseType,
    Evaluation,
    GenericObject,
    CreateCustomEvaluation,
    ExecuteCustomEvalCode,
    AICritiqueCreate,
} from "@/lib/Types"
import {
    fromEvaluationResponseToEvaluation,
    fromEvaluationScenarioResponseToEvaluationScenario,
} from "@/lib/transformers"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {getAgentaApiUrl} from "@/lib/helpers/utils"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllLoadEvaluations = async (appId: string, ignoreAxiosError: boolean = false) => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/?app_id=${appId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const fetchLoadEvaluation = async (evaluationId: string) => {
    return await axios
        .get(`${getAgentaApiUrl()}/api/human-evaluations/${evaluationId}/`)
        .then((responseData) => {
            return fromEvaluationResponseToEvaluation(responseData.data)
        })
}

export const deleteEvaluations = async (ids: string[]) => {
    const response = await axios({
        method: "delete",
        url: `${getAgentaApiUrl()}/api/human-evaluations/`,
        data: {evaluations_ids: ids},
    })
    return response.data
}

export const fetchAllLoadEvaluationsScenarios = async (
    evaluationTableId: string,
    evaluation: Evaluation,
) => {
    return await axios
        .get(
            `${getAgentaApiUrl()}/api/human-evaluations/${evaluationTableId}/evaluation_scenarios/`,
        )
        .then((responseData) => {
            const evaluationsRows = responseData.data.map((item: any) => {
                return fromEvaluationScenarioResponseToEvaluationScenario(item, evaluation)
            })

            return evaluationsRows
        })
}

export const createNewEvaluation = async (
    {
        variant_ids,
        appId,
        evaluationType,
        evaluationTypeSettings,
        inputs,
        llmAppPromptTemplate,
        selectedCustomEvaluationID,
        testsetId,
    }: {
        variant_ids: string[]
        appId: string
        evaluationType: string
        evaluationTypeSettings: Partial<EvaluationResponseType["evaluation_type_settings"]>
        inputs: string[]
        llmAppPromptTemplate?: string
        selectedCustomEvaluationID?: string
        testsetId: string
    },
    ignoreAxiosError: boolean = false,
) => {
    const data = {
        variant_ids,
        app_id: appId,
        inputs: inputs,
        evaluation_type: evaluationType,
        evaluation_type_settings: {
            ...evaluationTypeSettings,
            custom_code_evaluation_id: selectedCustomEvaluationID,
            llm_app_prompt_template: llmAppPromptTemplate,
        },
        testset_id: testsetId,
        status: EvaluationFlow.EVALUATION_INITIALIZED,
    }

    const response = await axios.post(`${getAgentaApiUrl()}/api/human-evaluations/`, data, {
        _ignoreError: ignoreAxiosError,
    } as any)
    return response.data.id
}

export const updateEvaluation = async (evaluationId: string, data: GenericObject) => {
    const response = await axios.put(
        `${getAgentaApiUrl()}/api/human-evaluations/${evaluationId}/`,
        data,
    )
    return response.data
}

export const updateEvaluationScenario = async (
    evaluationTableId: string,
    evaluationScenarioId: string,
    data: GenericObject,
    evaluationType: EvaluationType,
) => {
    const response = await axios.put(
        `${getAgentaApiUrl()}/api/human-evaluations/${evaluationTableId}/evaluation_scenario/${evaluationScenarioId}/${evaluationType}/`,
        data,
    )
    return response.data
}

export const createEvaluationScenario = async (evaluationTableId: string, data: GenericObject) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/api/human-evaluations/${evaluationTableId}/evaluation_scenario/`,
        data,
    )
    return response.data
}

export const createEvaluateAICritiqueForEvalScenario = async (
    data: AICritiqueCreate,
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/api/human-evaluations/evaluation_scenario/ai_critique/`,
        data,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchEvaluationResults = async (
    evaluationId: string,
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/${evaluationId}/results/`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const fetchEvaluationScenarioResults = async (evaluation_scenario_id: string) => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/evaluation_scenario/${evaluation_scenario_id}/score/`,
    )
    return response
}

export const createCustomCodeEvaluation = async (
    payload: CreateCustomEvaluation,
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/`,
        payload,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const updateCustomEvaluationDetail = async (
    id: string,
    payload: CreateCustomEvaluation,
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.put(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/${id}`,
        payload,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchCustomEvaluations = async (app_id: string, ignoreAxiosError: boolean = false) => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/list/${app_id}/`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchCustomEvaluationDetail = async (
    id: string,
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/${id}/`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response.data
}

export const fetchCustomEvaluationNames = async (
    app_id: string,
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/${app_id}/names/`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const createExecuteCustomEvaluationCode = async (
    payload: ExecuteCustomEvalCode,
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/execute/${
            payload.evaluation_id
        }/`,
        payload,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const updateEvaluationScenarioScore = async (
    evaluation_scenario_id: string,
    score: number,
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.put(
        `${getAgentaApiUrl()}/api/human-evaluations/evaluation_scenario/${evaluation_scenario_id}/score/`,
        {score},
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}
