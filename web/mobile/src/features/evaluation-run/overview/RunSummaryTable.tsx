import type {RunSummaryRow} from "./runSummaryRows"

/** The run facts as a label and value list. One run for now; compare runs add columns later. */
export const RunSummaryTable = ({rows}: {rows: readonly RunSummaryRow[]}) => (
    <dl className="m-0 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] text-sm">
        {rows.map((row) => (
            <div
                key={row.key}
                data-testid={`summary-${row.key}`}
                className="col-span-2 grid grid-cols-subgrid items-center gap-3 border-0 border-b border-solid border-border py-2 last:border-b-0"
            >
                <dt className="min-w-0 text-muted-foreground">{row.label}</dt>
                <dd className="m-0 min-w-0 break-words text-foreground">{row.value}</dd>
            </div>
        ))}
    </dl>
)
