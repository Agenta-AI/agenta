/**
 * Display labels for run tags.
 *
 * The API stores tags as a dictionary (`Tags = Dict[str, LabelJson]`), so each entry shows as
 * "key: value". A string value shows as is; any other value shows as JSON.
 */
export function runTagLabels(tags: Record<string, unknown> | null | undefined): string[] {
    if (!tags) return []
    return Object.entries(tags).map(([key, value]) => {
        const text = typeof value === "string" ? value : JSON.stringify(value)
        return `${key}: ${text}`
    })
}
