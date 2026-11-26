import type {ReactNode} from "react"

/**
 * A compared run's row for a test case it has no scenario for among the rows it loaded: the
 * number and the run, a note, and empty cells for the other columns.
 */
export const CompareScenarioMissing = ({
    index,
    run,
    pending,
    failed,
    emptyCells,
}: {
    index: number
    run: ReactNode
    pending: boolean
    failed: boolean
    emptyCells: number
}) => (
    <>
        <span className="text-sm tabular-nums text-muted-foreground">{index}</span>
        {run}
        <span className="text-xs text-muted-foreground">
            {failed ? "Could not load" : pending ? "Loading…" : "No matching scenario"}
        </span>
        {Array.from({length: emptyCells}, (_, cell) => (
            <span key={cell} aria-hidden />
        ))}
    </>
)
