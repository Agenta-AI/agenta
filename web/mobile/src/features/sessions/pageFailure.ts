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
    const failed = isError || pages[0] === null
    return {
        failed,
        laterPageFailed: !failed && pages.some((page) => page === null),
    }
}
