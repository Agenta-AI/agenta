/**
 * One-time educational hints ("you can also do this by asking the agent"), keyed by
 * action type. A hint fires the FIRST time a user completes the manual path and never
 * again — repeated after every save it stops being education and becomes noise (the
 * moment-detection pattern from the 2026-09-30 feature-awareness research).
 *
 * Per browser (localStorage), like the what's-new seen state. SSR- and test-safe: with
 * no `window`, hints never claim to be due.
 */

const STORAGE_PREFIX = "agenta-once-hint:"

/** Whether the hint for this action key has not been shown yet in this browser. */
export const isOnceHintDue = (key: string): boolean => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem(STORAGE_PREFIX + key) === null
}

/** Record that the hint was shown; `isOnceHintDue` returns false from now on. */
export const markOnceHintShown = (key: string) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_PREFIX + key, String(Date.now()))
}

/**
 * The gate most callers want: true exactly once per key per browser. Marks the hint
 * shown as a side effect, so the caller that receives `true` must actually show it.
 */
export const claimOnceHint = (key: string): boolean => {
    if (!isOnceHintDue(key)) return false
    markOnceHintShown(key)
    return true
}
