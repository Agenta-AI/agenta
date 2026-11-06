import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

import {DiffersBadge} from "./DiffersBadge"

export interface ConfigRowData {
    key: string
    label: ReactNode
    value: ReactNode
    /** Compare mode: the value differs from the base run's. */
    differs?: boolean
}

/** Labels and values, one pair per row. A row that differs from the base run is tinted and says so. */
export const ConfigRows = ({rows}: {rows: readonly ConfigRowData[]}) => (
    <dl className="m-0 flex flex-col text-sm">
        {rows.map((row) => (
            <div
                key={row.key}
                data-differs={row.differs ? "true" : undefined}
                className={cn(
                    "flex flex-col gap-1 border-0 border-b border-solid border-border py-2 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3",
                    row.differs && "rounded-md bg-colorWarningBg/40 px-2 first:pt-2 last:pb-2",
                )}
            >
                <dt className="min-w-0 break-words text-muted-foreground sm:w-1/3 sm:shrink-0">
                    {row.label}
                </dt>
                <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2 break-words text-foreground sm:flex-1">
                    {row.value}
                    {row.differs ? <DiffersBadge /> : null}
                </dd>
            </div>
        ))}
    </dl>
)
