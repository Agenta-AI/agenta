/**
 * Number of trace rows fetched per page for infinite scroll.
 * Sized to fill ~2× a typical 600–800px viewport at 48px row height.
 * Reduced from 50 (pre-infinite-scroll value) to 25 for progressive loading.
 */
export const TRACES_PAGE_SIZE = 25

/**
 * Number of session rows fetched per page for infinite scroll.
 */
export const SESSIONS_PAGE_SIZE = 20
