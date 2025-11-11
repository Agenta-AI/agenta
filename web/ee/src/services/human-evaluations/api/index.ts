import axios from "@/oss/lib/api/assets/axiosConfig"
import {EvaluationFlow, EvaluationType} from "@/oss/lib/enums"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {assertValidId} from "@/oss/lib/helpers/serviceValidations"
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
    const app = assertValidId(appId, "appId")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.get(`${getAgentaApiUrl()}/human-evaluations`, {
        params: {project_id: project, app_id: app},
        _ignoreError: ignoreAxiosError,
    } as any)
    return response.data
}

export const fetchLoadEvaluation = async (evaluationId: string) => {
    const {projectId} = getProjectValues()
    const id = assertValidId(evaluationId, "evaluationId")
    const project = assertValidId(projectId, "projectId")
    try {
        return await axios
            .get(`${getAgentaApiUrl()}/human-evaluations/${encodeURIComponent(id)}`, {
                params: {project_id: project},
            })
            .then((responseData) => {
                return fromEvaluationResponseToEvaluation(responseData.data)
            })
    } catch (error) {
        if (axios.isCancel?.(error) || (error as any)?.code === "ERR_CANCELED") {
            return null
        }
        console.error(`Error fetching evaluation ${id}:`, error)
        return null
    }
}

export const deleteEvaluations = async (ids: string[]) => {
    const {projectId} = getProjectValues()
    const project = assertValidId(projectId, "projectId")

    const response = await axios({
        method: "delete",
        url: `${getAgentaApiUrl()}/human-evaluations`,
        params: {project_id: project},
        data: {evaluations_ids: ids},
    })
    return response.data
}

export const fetchAllLoadEvaluationsScenarios = async (
    evaluationTableId: string,
    evaluation: Evaluation,
) => {
    const {projectId} = getProjectValues()
    const tableId = assertValidId(evaluationTableId, "evaluationTableId")
    const project = assertValidId(projectId, "projectId")

    return await axios
        .get(
            `${getAgentaApiUrl()}/human-evaluations/${encodeURIComponent(
                tableId,
            )}/evaluation_scenarios`,
            {params: {project_id: project}},
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
        appId,
        variant_ids,
        evaluationType,
        evaluationTypeSettings,
        inputs,
        llmAppPromptTemplate,
        selectedCustomEvaluationID,
        testsetId,
    }: {
        appId: string
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
    const app = assertValidId(appId, "appId")
    const testset = assertValidId(testsetId, "testsetId")
    const customId = selectedCustomEvaluationID
        ? assertValidId(selectedCustomEvaluationID, "customEvaluationId")
        : undefined

    const data = {
        variant_ids,
        inputs: inputs,
        app_id: app,
        evaluation_type: evaluationType,
        evaluation_type_settings: {
            ...evaluationTypeSettings,
            custom_code_evaluation_id: customId,
            llm_app_prompt_template: llmAppPromptTemplate,
        },
        testset_id: testset,
        status: EvaluationFlow.EVALUATION_INITIALIZED,
    }

    const {projectId} = getProjectValues()
    const project = assertValidId(projectId, "projectId")

    const response = await axios.post(`${getAgentaApiUrl()}/human-evaluations`, data, {
        params: {project_id: project},
        _ignoreError: ignoreAxiosError,
    } as any)
    return response.data.id
}

export const updateEvaluation = async (evaluationId: string, data: GenericObject) => {
    const {projectId} = getProjectValues()
    const id = assertValidId(evaluationId, "evaluationId")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.put(
        `${getAgentaApiUrl()}/human-evaluations/${encodeURIComponent(id)}`,
        data,
        {params: {project_id: project}},
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
    const tableId = assertValidId(evaluationTableId, "evaluationTableId")
    const scenarioId = assertValidId(evaluationScenarioId, "evaluationScenarioId")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.put(
        `${getAgentaApiUrl()}/human-evaluations/${encodeURIComponent(
            tableId,
        )}/evaluation_scenario/${encodeURIComponent(scenarioId)}/${encodeURIComponent(
            evaluationType,
        )}`,
        data,
        {params: {project_id: project}},
    )
    return response.data
}

export const createEvaluationScenario = async (evaluationTableId: string, data: GenericObject) => {
    const {projectId} = getProjectValues()
    const tableId = assertValidId(evaluationTableId, "evaluationTableId")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.post(
        `${getAgentaApiUrl()}/human-evaluations/${encodeURIComponent(tableId)}/evaluation_scenario`,
        data,
        {params: {project_id: project}},
    )
    return response.data
}

export const createEvaluateAICritiqueForEvalScenario = async (
    data: AICritiqueCreate,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()
    const project = assertValidId(projectId, "projectId")

    const response = await axios.post(
        `${getAgentaApiUrl()}/human-evaluations/evaluation_scenario/ai_critique`,
        data,
        {params: {project_id: project}, _ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchEvaluationResults = async (evaluationId: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()
    const id = assertValidId(evaluationId, "evaluationId")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/${encodeURIComponent(id)}/results`,
        {
            params: {project_id: project},
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data as EvaluationResponseType
}

export const fetchEvaluationScenarioResults = async (evaluation_scenario_id: string) => {
    const {projectId} = getProjectValues()
    const scenarioId = assertValidId(evaluation_scenario_id, "evaluation_scenario_id")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/evaluation_scenario/${encodeURIComponent(
            scenarioId,
        )}/score`,
        {params: {project_id: project}},
    )
    return response
}

export const createCustomCodeEvaluation = async (
    payload: CreateCustomEvaluation,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()
    const project = assertValidId(projectId, "projectId")

    const response = await axios.post(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation`,
        payload,
        {params: {project_id: project}, _ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const updateCustomEvaluationDetail = async (
    id: string,
    payload: CreateCustomEvaluation,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()
    const customId = assertValidId(id, "custom_evaluation_id")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.put(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/${encodeURIComponent(customId)}`,
        payload,
        {params: {project_id: project}, _ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchCustomEvaluations = async (app_id: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()
    const appId = assertValidId(app_id, "app_id")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/list/${encodeURIComponent(
            appId,
        )}`,
        {params: {project_id: project}, _ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const fetchCustomEvaluationDetail = async (id: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()
    const customId = assertValidId(id, "custom_evaluation_id")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/${encodeURIComponent(customId)}`,
        {params: {project_id: project}, _ignoreError: ignoreAxiosError} as any,
    )
    return response.data
}

export const fetchCustomEvaluationNames = async (app_id: string, ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()
    const appId = assertValidId(app_id, "app_id")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.get(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/${encodeURIComponent(
            appId,
        )}/names`,
        {params: {project_id: project}, _ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const createExecuteCustomEvaluationCode = async (
    payload: ExecuteCustomEvalCode,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()
    const project = assertValidId(projectId, "projectId")
    const evalId = assertValidId(payload.evaluation_id, "evaluation_id")

    const response = await axios.post(
        `${getAgentaApiUrl()}/human-evaluations/custom_evaluation/execute/${encodeURIComponent(
            evalId,
        )}`,
        payload,
        {params: {project_id: project}, _ignoreError: ignoreAxiosError} as any,
    )
    return response
}

export const updateEvaluationScenarioScore = async (
    evaluation_scenario_id: string,
    score: number,
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()
    const scenarioId = assertValidId(evaluation_scenario_id, "evaluation_scenario_id")
    const project = assertValidId(projectId, "projectId")

    const response = await axios.put(
        `${getAgentaApiUrl()}/human-evaluations/evaluation_scenario/${encodeURIComponent(
            scenarioId,
        )}/score`,
        {score},
        {params: {project_id: project}, _ignoreError: ignoreAxiosError} as any,
    )
    return response
}
