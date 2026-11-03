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
                className="flex items-start gap-3 border-0 border-b border-solid border-border py-2 first:pt-0 last:border-b-0 last:pb-0"
            >
                <dt className="w-1/3 min-w-0 shrink-0 text-muted-foreground">{row.label}</dt>
                <dd className="m-0 min-w-0 flex-1 break-words text-foreground">{row.value}</dd>
            </div>
        ))}
    </dl>
)
