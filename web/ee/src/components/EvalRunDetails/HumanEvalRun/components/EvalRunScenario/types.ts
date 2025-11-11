import {ViewType} from "../EvalRunScenarioCard/types"

export interface EvalRunScenarioProps {
    scenarioId: string
    runId: string
    viewType?: ViewType
    className?: string
}
