import type {SidebarConfig} from "@agenta/navigation"

export type DayGroupKey = "today" | "yesterday" | "earlier"

export interface DayGroup<T> {
    key: DayGroupKey
    rows: T[]
}

const startOfDay = (date: Date, daysBack = 0) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysBack).getTime()

/**
 * Rows split into Today, Yesterday and Earlier by their last activity, in the person's own time
 * zone. Order inside a group is kept; empty groups are left out. A row with no time is Earlier.
 */
export const groupByDay = <T>(
    rows: readonly T[],
    activityAt: (row: T) => string | null,
    now: Date = new Date(),
): DayGroup<T>[] => {
    const today = startOfDay(now)
    const yesterday = startOfDay(now, 1)
    const groups: Record<DayGroupKey, T[]> = {today: [], yesterday: [], earlier: []}
    for (const row of rows) {
        const at = activityAt(row)
        const time = at ? new Date(at).getTime() : Number.NaN
        if (time >= today) groups.today.push(row)
        else if (time >= yesterday) groups.yesterday.push(row)
        else groups.earlier.push(row)
    }
    return (["today", "yesterday", "earlier"] as const)
        .filter((key) => groups[key].length > 0)
        .map((key) => ({key, rows: groups[key]}))
}

/**
 * Rows under Today, Yesterday and Earlier headings, as the sidebars draw their session lists: a
 * heading row (`<keyPrefix>-<group>`), then that group's rows.
 */
export const dayGroupedRows = <T>(
    rows: readonly T[],
    {
        activityAt,
        keyPrefix,
        label,
        toRow,
    }: {
        activityAt: (row: T) => string | null
        keyPrefix: string
        label: (key: DayGroupKey) => string
        toRow: (row: T) => SidebarConfig
    },
): SidebarConfig[] =>
    groupByDay(rows, activityAt).flatMap((group) => [
        {key: `${keyPrefix}-${group.key}`, title: label(group.key), isGroupLabel: true},
        ...group.rows.map(toRow),
    ])
