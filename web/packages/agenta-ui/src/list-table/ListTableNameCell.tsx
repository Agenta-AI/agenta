import type {ReactNode} from "react"

import {cn} from "../components/ui/utils"

/**
 * A row's first cell: the Mark, the title and an optional meta line (the List row shape, LAYOUT-07).
 * Without `meta` it is a one-line row; with it, two lines beside a 32px Mark.
 */
export const ListTableNameCell = ({
    mark,
    title,
    meta,
    metaTone = "muted",
    className,
}: {
    mark?: ReactNode
    title: string
    meta?: ReactNode
    /** `danger` for a meta line that says something is wrong ("Slack is disconnected"). */
    metaTone?: "muted" | "danger"
    className?: string
}) => (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
        {mark}
        <span className="flex min-w-0 flex-col">
            <span className="truncate text-body font-medium text-foreground" title={title}>
                {title}
            </span>
            {meta ? (
                <span
                    className={cn(
                        "truncate text-label font-normal",
                        metaTone === "danger" ? "text-destructive" : "text-muted-foreground",
                    )}
                    title={typeof meta === "string" ? meta : undefined}
                >
                    {meta}
                </span>
            ) : null}
        </span>
    </span>
)
