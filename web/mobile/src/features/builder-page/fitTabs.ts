/**
 * Which builder tabs fit in one row. The active tab always shows; the others show in their order
 * until the next one does not fit, with room kept for "N more" while any tab is left out. A tab
 * not measured yet counts as fitting, so the first frame shows every tab.
 */
export const fitTabs = ({
    keys,
    active,
    widths,
    room,
    moreWidth,
    gap,
}: {
    keys: string[]
    active: string | null
    widths: Record<string, number>
    room: number
    moreWidth: number
    gap: number
}): {visible: string[]; hidden: string[]} => {
    if (room <= 0) return {visible: keys, hidden: []}
    const width = (key: string) => (widths[key] ?? 0) + gap
    const total = keys.reduce((sum, key) => sum + width(key), 0)
    if (total <= room) return {visible: keys, hidden: []}
    const shown = new Set<string>()
    let used = moreWidth
    if (active && keys.includes(active)) {
        shown.add(active)
        used += width(active)
    }
    for (const key of keys) {
        if (shown.has(key)) continue
        if (used + width(key) > room) break
        shown.add(key)
        used += width(key)
    }
    return {
        visible: keys.filter((key) => shown.has(key)),
        hidden: keys.filter((key) => !shown.has(key)),
    }
}
