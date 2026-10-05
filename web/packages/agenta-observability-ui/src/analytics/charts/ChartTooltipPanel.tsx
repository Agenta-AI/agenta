export interface TooltipRow {
    color: string
    label: string
    value: string
    share?: string
    /** A muted line under the row. */
    note?: string
}

export interface ChartTooltipPanelProps {
    title: string
    runs?: string
    value: string
    rowsTitle?: string
    rows?: TooltipRow[]
    facts?: {label: string; value: string}[]
}

export const ChartTooltipPanel = ({
    title,
    runs,
    value,
    rowsTitle,
    rows = [],
    facts = [],
}: ChartTooltipPanelProps) => (
    <div className="flex w-[220px] flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 text-xs shadow-lg">
        <div className="flex items-baseline justify-between gap-2 text-muted-foreground">
            <span>{title}</span>
            {runs ? <span>{runs}</span> : null}
        </div>
        <span className="text-sm font-semibold text-foreground">{value}</span>
        {rows.length ? (
            <div className="flex flex-col gap-1">
                {rowsTitle ? <span className="text-muted-foreground">{rowsTitle}</span> : null}
                {rows.map((row, i) => (
                    // Two keys can share a name (two agents called the same).
                    <div key={`${i}-${row.label}`} className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                            <span
                                className="size-2 shrink-0 rounded-full"
                                style={{background: row.color}}
                            />
                            <span className="min-w-0 flex-1 truncate">{row.label}</span>
                            <span className="font-medium tabular-nums">{row.value}</span>
                            {row.share ? (
                                <span className="w-8 text-right text-muted-foreground tabular-nums">
                                    {row.share}
                                </span>
                            ) : null}
                        </div>
                        {row.note ? (
                            <span
                                className="truncate pl-3.5 text-muted-foreground"
                                title={row.note}
                            >
                                {row.note}
                            </span>
                        ) : null}
                    </div>
                ))}
            </div>
        ) : null}
        {facts.length ? (
            <div className="flex flex-col gap-1 border-0 border-t border-solid border-border pt-1.5">
                {facts.map((fact) => (
                    <div key={fact.label} className="flex min-w-0 justify-between gap-3">
                        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                            {fact.label}
                        </span>
                        <span
                            className="min-w-0 truncate font-medium tabular-nums"
                            title={fact.value}
                        >
                            {fact.value}
                        </span>
                    </div>
                ))}
            </div>
        ) : null}
    </div>
)
