import {ScenarioCellValue} from "./ScenarioCellValue"
import type {ScenarioCell} from "./scenarioColumns"
import {ScenarioStepError} from "./states/ScenarioStepError"

/** Each group shows this many values in the table. The rest open with the row. */
const SHOWN_VALUES = 2

/**
 * The cell of one column group: its first two values, and a "+N" for the others. A step that
 * failed shows its error.
 */
export const ScenarioGroupCell = ({cells, error}: {cells: ScenarioCell[]; error?: string}) => {
    if (error) return <ScenarioStepError message={error} />
    const shown = cells.slice(0, SHOWN_VALUES)
    const hidden = cells.length - shown.length
    if (shown.length === 0) return <span className="text-muted-foreground">—</span>
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            {shown.map((cell) => (
                <div key={cell.name} className="min-w-0">
                    <div className="truncate text-[11px] text-muted-foreground">{cell.name}</div>
                    <ScenarioCellValue cell={cell} />
                </div>
            ))}
            {hidden > 0 ? (
                <span
                    className="w-fit rounded-full border border-border px-1.5 text-[11px] text-muted-foreground"
                    title={`${hidden} more ${hidden === 1 ? "value" : "values"} in this scenario`}
                >
                    +{hidden}
                </span>
            ) : null}
        </div>
    )
}
