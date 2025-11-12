import {SnakeToCamelCaseKeys} from "../../Types"

// Raw API response type for one scenario (snake_case)
export interface ScenarioResponse {
    id: string
    run_id: string
    status: string
    created_by_id: string
    created_at: string
    // …other fields in snake_case if backend adds more…
}

// CamelCased version of ScenarioResponse
export interface IScenario extends SnakeToCamelCaseKeys<ScenarioResponse> {
    scenarioIndex: number
}

//
// Pagination/options for the hook:
//
export interface UseEvaluationRunScenariosOptions {
    limit?: number
    next?: string
}
