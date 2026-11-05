import {ScenarioCellValue} from "../scenarios/ScenarioCellValue"
import type {ScenarioCell} from "../scenarios/scenarioColumns"

import {ScenarioFieldCard} from "./ScenarioFieldCard"

/**
 * The metrics one evaluator produced for the scenario: its name, then one row per metric. An
 * evaluator that failed shows its error instead, since it produced no metric.
 */
export const ScenarioMetricsBlock = ({
    evaluatorName,
    cells,
    error,
}: {
    evaluatorName: string
    cells: ScenarioCell[]
    error?: string
}) => (
    <section aria-label={`${evaluatorName} metrics`} className="flex flex-col gap-2">
        <h4 className="m-0 text-sm font-medium">{evaluatorName}</h4>
        {error ? (
            <p role="alert" className="m-0 break-words text-sm text-destructive">
                {error}
            </p>
        ) : (
            cells.map((cell) => (
                <ScenarioFieldCard key={cell.path || cell.name} label={cell.name}>
                    <ScenarioCellValue cell={cell} lines={10} />
                </ScenarioFieldCard>
            ))
        )}
    </section>
)
