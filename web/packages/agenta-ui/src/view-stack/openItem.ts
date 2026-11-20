import {createContext, useContext, useEffect} from "react"

import type {ConfigItemRef} from "./types"

/** The configuration item an open view shows, with the title the view reports. */
export interface OpenViewItem extends ConfigItemRef {
    name: string
}

/**
 * Lets a page learn which configuration item an open view shows, wherever the view opens (a
 * container's stack or a drawer of its own). A stack host under this context reports its deepest
 * open view whose params carry an `item` address, once that view has reported its title, and
 * null when no open view shows an item or when the host leaves.
 */
export const ReportOpenViewItemContext = createContext<
    ((item: OpenViewItem | null) => void) | null
>(null)

const itemOfParams = (params: unknown): ConfigItemRef | null => {
    const item = (params as {item?: Partial<ConfigItemRef>} | null)?.item
    return item && typeof item.list === "string" && typeof item.key === "string"
        ? (item as ConfigItemRef)
        : null
}

/** Internal: a stack host reports the item of its open views to the nearest page. */
export const useReportOpenViewItem = (
    entries: readonly {key: number; params: unknown}[],
    titles: Record<number, string>,
) => {
    const report = useContext(ReportOpenViewItemContext)
    // The deepest open view that shows an item names it (a picker over it does not).
    let open: {key: number; item: ConfigItemRef} | null = null
    for (const entry of entries) {
        const item = itemOfParams(entry.params)
        if (item) open = {key: entry.key, item}
    }
    const list = open?.item.list
    const key = open?.item.key
    const name = open ? titles[open.key] : undefined
    useEffect(() => {
        if (!report) return
        if (!list || !key) report(null)
        // Wait for the view's title, so the name is never the bare key.
        else if (name) report({list, key, name})
    }, [report, list, key, name])
    // Nothing is open once the host leaves.
    useEffect(() => (report ? () => report(null) : undefined), [report])
}
