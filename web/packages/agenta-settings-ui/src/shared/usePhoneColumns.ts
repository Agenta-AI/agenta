import {useMemo, useSyncExternalStore} from "react"

import type {ListTableColumn} from "@agenta/ui/list-table"

/** Tailwind's `sm`, the breakpoint the Agents and Sessions tables drop columns at. */
const WIDE_QUERY = "(min-width: 640px)"

const subscribe = (onChange: () => void) => {
    if (typeof window.matchMedia !== "function") return () => undefined
    const list = window.matchMedia(WIDE_QUERY)
    list.addEventListener("change", onChange)
    return () => list.removeEventListener("change", onChange)
}

/** Below `sm` a table keeps only `phoneKeys`; `shows(key)` gates the matching cell. */
export const usePhoneColumns = (columns: ListTableColumn[], phoneKeys: readonly string[]) => {
    // Read on the first render, so a desktop table never paints its phone columns first.
    const wide = useSyncExternalStore(
        subscribe,
        () => typeof window.matchMedia !== "function" || window.matchMedia(WIDE_QUERY).matches,
        () => true,
    )
    return useMemo(() => {
        const visible = wide ? columns : columns.filter((column) => phoneKeys.includes(column.key))
        const keys = new Set(visible.map((column) => column.key))
        return {columns: visible, shows: (key: string) => keys.has(key)}
    }, [wide, columns, phoneKeys])
}
