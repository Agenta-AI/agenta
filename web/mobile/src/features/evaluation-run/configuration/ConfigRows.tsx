import type {ReactNode} from "react"

export interface ConfigRowData {
    key: string
    label: ReactNode
    value: ReactNode
}

/** Labels and values, one pair per row. */
export const ConfigRows = ({rows}: {rows: readonly ConfigRowData[]}) => (
    <dl className="m-0 flex flex-col text-sm">
        {rows.map((row) => (
            <div
                key={row.key}
                className="flex flex-col gap-1 border-0 border-b border-solid border-border py-2 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3"
            >
                <dt className="min-w-0 break-words text-muted-foreground sm:w-1/3 sm:shrink-0">
                    {row.label}
                </dt>
                <dd className="m-0 min-w-0 break-words text-foreground sm:flex-1">{row.value}</dd>
            </div>
        ))}
    </dl>
)
