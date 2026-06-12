import type {
    EvaluationScenarioRow,
    EvaluationTableColumnsResult,
} from "@agenta/evaluations/state/evalRun"

export interface TableDebugPanelProps {
    runId: string
    columnsResult?: EvaluationTableColumnsResult
    scenarioRows: EvaluationScenarioRow[]
    pendingColumns: boolean
    pendingRows: boolean
}

const TableDebugPanel = (_props: TableDebugPanelProps) => {
    return null
}

export default TableDebugPanel
