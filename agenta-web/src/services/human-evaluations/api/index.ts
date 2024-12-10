import axios from "@/lib/api/assets/axiosConfig"
import {
    EvaluationResponseType,
    Evaluation,
    GenericObject,
    CreateCustomEvaluation,
    ExecuteCustomEvalCode,
    AICritiqueCreate,
} from "@/lib/Types"
import {
    abTestingEvaluationTransformer,
    fromEvaluationResponseToEvaluation,
    fromEvaluationScenarioResponseToEvaluationScenario,
    singleModelTestEvaluationTransformer,
} from "@/lib/transformers"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {getCurrentProject} from "@/contexts/project.context"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllLoadEvaluations = async (appId: string, ignoreAxiosError: boolean = false) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations?project_id=${projectId}&app_id=${appId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const fetchSingleModelEvaluationResult = async (appId: string) => {
    const evals: Evaluation[] = (await fetchAllLoadEvaluations(appId)).map(
        fromEvaluationResponseToEvaluation,
    )
    const results = await Promise.all(evals.map((e) => fetchEvaluationResults(e.id)))
    const newEvals = results.map((result, ix) => {
        const item = evals[ix]
        if ([EvaluationType.single_model_test].includes(item.evaluationType)) {
            return singleModelTestEvaluationTransformer({item, result})
        }
    })

    const newEvalResults = newEvals
        .filter((evaluation) => evaluation !== undefined)
        .filter(
            (item: any) =>
                item.resultsData !== undefined ||
                !(Object.keys(item.scoresData || {}).length === 0) ||
                item.avgScore !== undefined,
        )
    return newEvalResults
}

export const fetchAbTestingEvaluationResult = async (appId: string) => {
    const evals = await fetchAllLoadEvaluations(appId)

    const fetchPromises = evals.map(async (item: any) => {
        return fetchEvaluationResults(item.id)
            .then((results) => {
                if (item.evaluation_type === EvaluationType.human_a_b_testing) {
                    if (Object.keys(results.votes_data).length > 0) {
                        return abTestingEvaluationTransformer({item, results})
                    }
                }
            })
            .catch((err) => console.error(err))
    })

    const results = (await Promise.all(fetchPromises))
        .filter((evaluation) => evaluation !== undefined)
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())

    return results
}

export const fetchLoadEvaluation = async (evaluationId: string) => {
    const {projectId} = getCurrentProject()

    return await axios
        .get(`${getAgentaApiUrl()}/api/human-evaluations/${evaluationId}?project_id=${projectId}`)
        .then((responseData) => {
            return fromEvaluationResponseToEvaluation(responseData.data)
        })
}

export const deleteEvaluations = async (ids: string[]) => {
    const {projectId} = getCurrentProject()

    const response = await axios({
        method: "delete",
        url: `${getAgentaApiUrl()}/api/human-evaluations?project_id=${projectId}`,
        data: {evaluations_ids: ids},
    })
    return response.data
}

export const fetchAllLoadEvaluationsScenarios = async (
    evaluationTableId: string,
    evaluation: Evaluation,
) => {
    const {projectId} = getCurrentProject()

    return await axios
        .get(
            `${getAgentaApiUrl()}/api/human-evaluations/${evaluationTableId}/evaluation_scenarios?project_id=${projectId}`,
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

    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/api/human-evaluations?project_id=${projectId}`,
        data,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data.id
}

export const updateEvaluation = async (evaluationId: string, data: GenericObject) => {
    const {projectId} = getCurrentProject()

    const response = await axios.put(
        `${getAgentaApiUrl()}/api/human-evaluations/${evaluationId}?project_id=${projectId}`,
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
    const {projectId} = getCurrentProject()

    const response = await axios.put(
        `${getAgentaApiUrl()}/api/human-evaluations/${evaluationTableId}/evaluation_scenario/${evaluationScenarioId}/${evaluationType}?project_id=${projectId}`,
        data,
    )
    return response.data
}

export const createEvaluationScenario = async (evaluationTableId: string, data: GenericObject) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/api/human-evaluations/${evaluationTableId}/evaluation_scenario?project_id=${projectId}`,
        data,
    )
    return response.data
}

export const createEvaluateAICritiqueForEvalScenario = async (
    data: AICritiqueCreate,
    ignoreAxiosError: boolean = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/api/human-evaluations/evaluation_scenario/ai_critique?project_id=${projectId}`,
        data,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchEvaluationResults = async (
    evaluationId: string,
    ignoreAxiosError: boolean = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/${evaluationId}/results?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const fetchEvaluationScenarioResults = async (evaluation_scenario_id: string) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/evaluation_scenario/${evaluation_scenario_id}/score?project_id=${projectId}`,
    )
    return response
}

export const createCustomCodeEvaluation = async (
    payload: CreateCustomEvaluation,
    ignoreAxiosError: boolean = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation?project_id=${projectId}`,
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
    const {projectId} = getCurrentProject()

    const response = await axios.put(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/${id}?project_id=${projectId}`,
        payload,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchCustomEvaluations = async (app_id: string, ignoreAxiosError: boolean = false) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/list/${app_id}?project_id=${projectId}`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchCustomEvaluationDetail = async (
    id: string,
    ignoreAxiosError: boolean = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/${id}?project_id=${projectId}`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response.data
}

export const fetchCustomEvaluationNames = async (
    app_id: string,
    ignoreAxiosError: boolean = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/${app_id}/names?project_id=${projectId}`,
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const createExecuteCustomEvaluationCode = async (
    payload: ExecuteCustomEvalCode,
    ignoreAxiosError: boolean = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/api/human-evaluations/custom_evaluation/execute/${
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
    ignoreAxiosError: boolean = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.put(
        `${getAgentaApiUrl()}/api/human-evaluations/evaluation_scenario/${evaluation_scenario_id}/score?project_id=${projectId}`,
        {score},
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response
}
