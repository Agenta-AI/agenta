import {ScenarioCellValue} from "../scenarios/ScenarioCellValue"
import type {ScenarioCell} from "../scenarios/scenarioColumns"

import {ScenarioFieldCard} from "./ScenarioFieldCard"

/** The metrics one evaluator produced for the scenario: its name, then one row per metric. */
export const ScenarioMetricsBlock = ({
    evaluatorName,
    cells,
}: {
    evaluatorName: string
    cells: ScenarioCell[]
}) => (
    <section aria-label={`${evaluatorName} metrics`} className="flex flex-col gap-2">
        <h4 className="m-0 text-sm font-medium">{evaluatorName}</h4>
        {cells.map((cell) => (
            <ScenarioFieldCard key={cell.path || cell.name} label={cell.name}>
                <ScenarioCellValue cell={cell} lines={10} />
            </ScenarioFieldCard>
        ))}
    </section>
)
