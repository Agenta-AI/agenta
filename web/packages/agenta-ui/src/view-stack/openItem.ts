import {createContext, useContext, useEffect} from "react"

import type {ConfigItemRef} from "./types"

/** The configuration item an open view shows, with the title the view reports. */
export interface OpenViewItem extends ConfigItemRef {
    name: string
}

/**
 * Lets a page learn which configuration item an open view shows, wherever the view opens (a
 * container's stack or a drawer of its own). A stack host under this context reports its deepest
 * open view whose params carry an `item` address, and null when none does or when it closes.
 */
export const OpenViewItemContext = createContext<((item: OpenViewItem | null) => void) | null>(null)

const isItemRef = (value: unknown): value is ConfigItemRef =>
    Boolean(value) &&
    typeof (value as ConfigItemRef).list === "string" &&
    typeof (value as ConfigItemRef).key === "string"

/** The item address in a view's params (`params.item`), if any. */
export const itemOfParams = (params: unknown): ConfigItemRef | null => {
    const item = (params as {item?: unknown} | null)?.item
    return isItemRef(item) ? item : null
}

/** Internal: a stack host reports the item of its open views to the nearest page. */
export const useReportOpenViewItem = (
    entries: readonly {key: number; params: unknown}[],
    titles: Record<number, string>,
) => {
    const report = useContext(OpenViewItemContext)
    // The deepest open view that shows an item names it.
    const open = [...entries].reverse().find((entry) => itemOfParams(entry.params))
    const item = open ? itemOfParams(open.params) : null
    const name = open ? (titles[open.key] ?? "") : ""
    const list = item?.list
    const key = item?.key
    useEffect(() => {
        if (!report) return
        report(list && key ? {list, key, name: name || key} : null)
    }, [report, list, key, name])
    // Nothing is open once the host leaves.
    useEffect(() => (report ? () => report(null) : undefined), [report])
}
