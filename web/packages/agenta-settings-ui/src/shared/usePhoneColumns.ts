import {useMemo} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import type {ListTableColumn} from "@agenta/ui/list-table"

/** Tailwind's `sm`, the breakpoint the Agents and Sessions tables drop columns at. */
const WIDE_QUERY = "(min-width: 640px)"

/** Below `sm` a table keeps only `phoneKeys`; `shows(key)` gates the matching cell. */
export const usePhoneColumns = (columns: ListTableColumn[], phoneKeys: readonly string[]) => {
    const wide = useMediaQuery(WIDE_QUERY)
    return useMemo(() => {
        const visible = wide ? columns : columns.filter((column) => phoneKeys.includes(column.key))
        const keys = new Set(visible.map((column) => column.key))
        return {columns: visible, shows: (key: string) => keys.has(key)}
    }, [wide, columns, phoneKeys])
}
