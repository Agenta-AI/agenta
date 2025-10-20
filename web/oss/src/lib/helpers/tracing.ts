/**
 * Sorts an array of spans by their start_time in ascending order (earliest first).
 *
 * This function ensures hierarchical tree structures display spans in chronological order.
 * It only sorts spans at the same level - parent/child relationships are maintained.
 *
 * Sorting logic:
 * - Primary: start_time (ascending - earliest first)
 * - Secondary: span_id (for concurrent spans with identical start times)
 * - Spans without start_time are placed at the end
 *
 * @param spans - Array of spans to sort
 * @returns New sorted array (does not mutate input)
 */
export const sortSpansByStartTime = <T extends { start_time?: string | number; span_id?: string }>(
    spans: T[],
): T[] => {
    return [...spans].sort((a, b) => {
        const aTime = a.start_time
        const bTime = b.start_time

        // Handle missing start_time - push to end
        if (!aTime && !bTime) return 0
        if (!aTime) return 1
        if (!bTime) return -1

        // Convert to milliseconds for comparison
        const aMs = typeof aTime === "number" ? aTime : new Date(aTime).getTime()
        const bMs = typeof bTime === "number" ? bTime : new Date(bTime).getTime()

        // Primary sort: by start_time
        if (aMs !== bMs) {
            return aMs - bMs
        }

        // Secondary sort: by span_id for concurrent spans
        const aId = a.span_id || ""
        const bId = b.span_id || ""
        return aId.localeCompare(bId)
    })
}
