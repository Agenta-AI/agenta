import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getJWT} from "@/oss/services/api"
import {getProjectValues} from "@/oss/state/project"

import {evalAtomStore} from "./assets/atoms"
import {runBulkFetch} from "./assets/atoms/bulkFetch"
import {bulkStepsStatusFamily, evaluationRunStateFamily} from "./assets/atoms/runScopedAtoms"
import {triggerMetricsFetch} from "./assets/atoms/runScopedMetrics"
import {fetchScenarioListViaWorker} from "./assets/helpers/fetchScenarioListViaWorker"

interface RefreshResult {
    scenarioCount: number
}

const normalizeProjectId = (projectValues: any): string | null => {
    if (!projectValues) return null
    const candidates = [
        projectValues.projectId,
        projectValues.id,
        projectValues.project_id,
        projectValues.projectID,
    ]
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.length > 0) {
            return candidate
        }
        if (typeof candidate === "number") {
            return String(candidate)
        }
    }
    return null
}

export const refreshLiveEvaluationRun = async (runId: string): Promise<RefreshResult> => {
    if (!runId) {
        throw new Error("refreshLiveEvaluationRun requires a runId")
    }

    const store = evalAtomStore()

    try {
        const projectValues = getProjectValues()
        const projectId = normalizeProjectId(projectValues)
        if (!projectId) {
            throw new Error("Project context not available")
        }

        const jwt = await getJWT()
        if (!jwt) {
            throw new Error("Authentication token not found")
        }

        const apiUrl = getAgentaApiUrl()
        if (!apiUrl) {
            throw new Error("API URL not configured")
        }

        const scenarios = await fetchScenarioListViaWorker({
            apiUrl,
            jwt,
            projectId,
            runId,
            order: "descending",
        })

        store.set(evaluationRunStateFamily(runId), (draft: any) => {
            draft.scenarios = scenarios.map((scenario, index) => ({
                ...scenario,
                scenarioIndex: index + 1,
            }))
        })

        store.set(bulkStepsStatusFamily(runId), "idle")

        const scenarioIds = scenarios
            .map((scenario) => scenario?.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0)

        if (scenarioIds.length > 0) {
            await runBulkFetch(store, runId, scenarioIds, {force: true, silent: true})
        }

        triggerMetricsFetch(runId)

        return {scenarioCount: scenarioIds.length}
    } catch (error) {
        console.error(`[refreshLiveEvaluationRun] Failed to refresh run ${runId}`, error)
        throw error
    }
}

export default refreshLiveEvaluationRun
