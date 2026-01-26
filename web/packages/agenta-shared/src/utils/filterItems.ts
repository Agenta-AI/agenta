/**
 * Filtering utilities for searchable lists.
 */

export type FilterItemLabel<T> = (item: T) => string

/**
 * Filter a list of items using a search term.
 *
 * When a label getter is provided, it will be used for filtering.
 * Otherwise the function falls back to JSON-stringifying each item.
 */
export function filterItems<T>(items: T[], searchTerm: string, getLabel?: FilterItemLabel<T>): T[] {
    if (!searchTerm.trim()) return items

    const term = searchTerm.toLowerCase().trim()

    return items.filter((item) => {
        const raw = getLabel ? getLabel(item) : JSON.stringify(item)
        return String(raw).toLowerCase().includes(term)
    })
}
