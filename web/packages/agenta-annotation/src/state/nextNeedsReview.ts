/** A queue item counts as completed when its status is `success`. */
const isCompleted = (status: string | null | undefined) => status === "success"

/**
 * The queue's items in the two groups of the item list, each in queue order: "Needs review" (every
 * status but `success`, failed items included) and "Completed".
 */
export const groupQueueItems = (
    ids: readonly string[],
    statuses: Readonly<Record<string, string | null | undefined>>,
): {needsReview: string[]; completed: string[]} => ({
    needsReview: ids.filter((id) => !isCompleted(statuses[id])),
    completed: ids.filter((id) => isCompleted(statuses[id])),
})

/**
 * The item "Mark completed and next" opens: the first item after `currentId` that is not
 * completed, then the first one from the start. Null when every other item is completed.
 */
export const nextNeedsReviewId = (
    ids: readonly string[],
    currentId: string | null,
    statuses: Readonly<Record<string, string | null | undefined>>,
): string | null => {
    const start = currentId ? ids.indexOf(currentId) + 1 : 0
    const ordered = [...ids.slice(start), ...ids.slice(0, start)]
    return ordered.find((id) => id !== currentId && !isCompleted(statuses[id])) ?? null
}
