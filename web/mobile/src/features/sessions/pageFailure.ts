/** Which part of a paged session list failed. `querySessions` resolves null rather than throwing. */
export interface PageFailure {
    /** Nothing to show: the query errored, or the first page never arrived. */
    failed: boolean
    /** Rows are on screen but the list stopped growing partway down. */
    laterPageFailed: boolean
}

/**
 * A failed first page and a failed fifth page are different problems. The first leaves an empty
 * screen and wants the full-screen error; the second should keep what the reader already scrolled
 * through and offer the retry where it stopped.
 */
export function classifyPageFailure(
    pages: readonly (unknown[] | null)[],
    isError: boolean,
): PageFailure {
    // A rejected later page does NOT land in `pages` (see `useSessionsInfinite`: rejecting is
    // what keeps the cursor retryable), so an error with rows already on screen is the
    // later-page case. `null` entries are still handled for any caller that resolves them.
    const hasRows = pages.length > 0 && pages[0] !== null
    const failed = !hasRows && (isError || pages[0] === null)
    return {
        failed,
        laterPageFailed: hasRows && (isError || pages.some((page) => page === null)),
    }
}
