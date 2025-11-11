import axios from "@/oss/lib/api/assets/axiosConfig"
import {EvaluationFlow, EvaluationType} from "@/oss/lib/enums"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {
    abTestingEvaluationTransformer,
    fromEvaluationResponseToEvaluation,
    fromEvaluationScenarioResponseToEvaluationScenario,
    singleModelTestEvaluationTransformer,
} from "@/oss/lib/transformers"
import {
    EvaluationResponseType,
    Evaluation,
    GenericObject,
    CreateCustomEvaluation,
    ExecuteCustomEvalCode,
    AICritiqueCreate,
} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllLoadEvaluations = async (
    appId: string,
    projectId: string,
    ignoreAxiosError = false,
) => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations?project_id=${projectId}&app_id=${appId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const fetchLoadEvaluation = async (evaluationId: string) => {
    const {projectId} = getProjectValues()
    try {
        return await axios
            .get(`${getAgentaApiUrl()}/human-evaluations/${evaluationId}?project_id=${projectId}`)
            .then((responseData) => {
                return fromEvaluationResponseToEvaluation(responseData.data)
            })
    } catch (error) {
        if (axios.isCancel?.(error) || (error as any)?.code === "ERR_CANCELED") {
            return null
        }
        console.error(`Error fetching evaluation ${evaluationId}:`, error)
        return null
    }
}

export const deleteEvaluations = async (ids: string[]) => {
    const {projectId} = getProjectValues()

    const response = await axios({
        method: "delete",
        url: `${getAgentaApiUrl()}/human-evaluations?project_id=${projectId}`,
        data: {evaluations_ids: ids},
    })
    return response.data
}

export const fetchAllLoadEvaluationsScenarios = async (
    evaluationTableId: string,
    evaluation: Evaluation,
) => {
    const {projectId} = getProjectValues()

    return await axios
        .get(
            `${getAgentaApiUrl()}/human-evaluations/${evaluationTableId}/evaluation_scenarios?project_id=${projectId}`,
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
        evaluationType,
        evaluationTypeSettings,
        inputs,
        llmAppPromptTemplate,
        selectedCustomEvaluationID,
        testsetId,
    }: {
        variant_ids: string[]
        evaluationType: string
        evaluationTypeSettings: Partial<EvaluationResponseType["evaluation_type_settings"]>
        inputs: string[]
        llmAppPromptTemplate?: string
        selectedCustomEvaluationID?: string
        testsetId: string
    },
    ignoreAxiosError = false,
) => {
    const data = {
        variant_ids,
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

    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/human-evaluations?project_id=${projectId}`,
        data,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data.id
}

export const updateEvaluation = async (evaluationId: string, data: GenericObject) => {
    const {projectId} = getProjectValues()

    const response = await axios.put(
        `${getAgentaApiUrl()}/human-evaluations/${evaluationId}?project_id=${projectId}`,
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
    const {projectId} = getProjectValues()

    const response = await axios.put(
        `${getAgentaApiUrl()}/human-evaluations/${evaluationTableId}/evaluation_scenario/${evaluationScenarioId}/${evaluationType}?project_id=${projectId}`,
        data,
    )
    return response.data
}

export const createEvaluationScenario = async (evaluationTableId: string, data: GenericObject) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/human-evaluations/${evaluationTableId}/evaluation_scenario?project_id=${projectId}`,
        data,
    )
    return response.data
}

export const createEvaluateAICritiqueForEvalScenario = async (
    data: AICritiqueCreate,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/human-evaluations/evaluation_scenario/ai_critique?project_id=${projectId}`,
        data,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchEvaluationResults = async (evaluationId: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/${evaluationId}/results?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data as EvaluationResponseType
}

export const fetchEvaluationScenarioResults = async (evaluation_scenario_id: string) => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/evaluation_scenario/${evaluation_scenario_id}/score?project_id=${projectId}`,
    )
    return response
}

export const createCustomCodeEvaluation = async (
    payload: CreateCustomEvaluation,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation?project_id=${projectId}`,
        payload,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const updateCustomEvaluationDetail = async (
    id: string,
    payload: CreateCustomEvaluation,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.put(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/${id}?project_id=${projectId}`,
        payload,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchCustomEvaluations = async (app_id: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/list/${app_id}?project_id=${projectId}`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchCustomEvaluationDetail = async (id: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/${id}?project_id=${projectId}`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response.data
}

export const fetchCustomEvaluationNames = async (app_id: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/${app_id}/names?project_id=${projectId}`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const createExecuteCustomEvaluationCode = async (
    payload: ExecuteCustomEvalCode,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/execute/${
            payload.evaluation_id
        }?project_id=${projectId}`,
        payload,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const updateEvaluationScenarioScore = async (
    evaluation_scenario_id: string,
    score: number,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.put(
        `${getAgentaApiUrl()}/human-evaluations/evaluation_scenario/${evaluation_scenario_id}/score?project_id=${projectId}`,
        {score},
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}
