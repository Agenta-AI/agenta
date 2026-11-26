import {compareColor} from "../compareColor"

import type {CompareSummaryRow} from "./compareSummaryRows"

/** The run facts of every compared run: one column per run, headed by its name in its color. */
export const CompareSummaryTable = ({
    runs,
    rows,
}: {
    runs: readonly {runId: string; slot: number; name: string}[]
    rows: readonly CompareSummaryRow[]
}) => (
    <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
            <thead>
                <tr className="border-0 border-b border-solid border-border">
                    <th scope="col" className="py-2 pr-3 font-normal text-muted-foreground">
                        <span className="sr-only">Field</span>
                    </th>
                    {runs.map((run) => (
                        <th
                            key={run.runId}
                            scope="col"
                            className="min-w-[140px] py-2 pr-3 font-medium text-foreground"
                        >
                            <span className="flex items-center gap-1.5">
                                <span
                                    aria-hidden
                                    className="size-2 shrink-0 rounded-full"
                                    style={{backgroundColor: compareColor(run.slot)}}
                                />
                                <span className="truncate">{run.name}</span>
                            </span>
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr
                        key={row.key}
                        data-testid={`compare-summary-${row.key}`}
                        className="border-0 border-b border-solid border-border last:border-b-0"
                    >
                        <th
                            scope="row"
                            className="w-[30%] min-w-[140px] py-2 pr-3 align-top font-normal text-muted-foreground"
                        >
                            {row.label}
                        </th>
                        {row.values.map((value, index) => (
                            <td
                                key={runs[index]?.runId ?? index}
                                className="break-words py-2 pr-3 align-top text-foreground"
                            >
                                {value}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
)
