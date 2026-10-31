import {timeAgo} from "@agenta/shared/utils"

import type {PluginRow} from "./usePlugins"
export function PluginRowCells({
    row,
    owner,
    narrow,
}: {
    row: PluginRow
    owner: string
    narrow: boolean
}) {
    return (
        <>
            <span className="truncate font-medium">{row.name}</span>
            {!narrow && <span className="truncate text-muted-foreground">{owner}</span>}
            <span className="text-muted-foreground">
                {row.updatedAt ? timeAgo(new Date(row.updatedAt).getTime()) : "—"}
            </span>
        </>
    )
}
