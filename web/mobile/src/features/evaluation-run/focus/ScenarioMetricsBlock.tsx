import {ScenarioCellValue} from "../scenarios/ScenarioCellValue"
import type {ScenarioCell} from "../scenarios/scenarioColumns"

import {ScenarioFieldCard} from "./ScenarioFieldCard"

/**
 * The metrics one evaluator produced for the scenario, one row per metric. An evaluator that
 * failed shows its error instead, since it produced no metric.
 */
export const ScenarioMetricsBlock = ({cells, error}: {cells: ScenarioCell[]; error?: string}) =>
    error ? (
        <p role="alert" className="m-0 break-words text-sm text-destructive">
            {error}
        </p>
    ) : (
        <div className="flex flex-col gap-2">
            {cells.map((cell) => (
                <ScenarioFieldCard key={cell.path || cell.name} label={cell.name}>
                    <ScenarioCellValue cell={cell} lines={10} />
                </ScenarioFieldCard>
            ))}
        </div>
    )
