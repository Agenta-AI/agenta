import {ScenarioCellValue} from "./ScenarioCellValue"
import type {ScenarioCell} from "./scenarioColumns"

/** One value of a scenario with its name above it. */
export const ScenarioLabeledValue = ({cell, lines}: {cell: ScenarioCell; lines?: number}) => (
    <div className="min-w-0">
        <div className="truncate text-[11px] text-muted-foreground">{cell.name}</div>
        <ScenarioCellValue cell={cell} lines={lines} />
    </div>
)
