import type {RunSummaryRow} from "./runSummaryRows"

/** The run facts as a label and value list. One run for now; compare runs add columns later. */
export const RunSummaryTable = ({rows}: {rows: readonly RunSummaryRow[]}) => (
    <dl className="m-0 flex flex-col text-sm">
        {rows.map((row) => (
            <div
                key={row.key}
                data-testid={`summary-${row.key}`}
                className="flex items-center gap-3 border-0 border-b border-solid border-border py-2 last:border-b-0"
            >
                <dt className="w-2/5 min-w-0 shrink-0 text-muted-foreground">{row.label}</dt>
                <dd className="m-0 min-w-0 flex-1 break-words text-foreground">{row.value}</dd>
            </div>
        ))}
    </dl>
)
