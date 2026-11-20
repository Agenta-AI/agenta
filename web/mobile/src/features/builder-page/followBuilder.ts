/**
 * The 10 second rule of the builder page (design D15, task 41.1): when the builder saves a change
 * to the agent of the active builder tab, its pane moves to the pane tab that shows the change,
 * unless the person clicked in the pane in the last 10 seconds or has an open form with edits.
 * Then the view stays and that pane tab gets a dot.
 */
export const FOLLOW_QUIET_MS = 10_000

export type FollowAction = "none" | "show" | "dot"

export const followAction = <Tab extends string>({
    paneTab,
    target,
    now,
    lastPointerDown,
    dirty,
}: {
    /** The pane tab on screen. */
    paneTab: Tab
    /** The pane tab that shows the builder's change. */
    target: Tab
    now: number
    /** The time of the person's last click in the pane, or null. */
    lastPointerDown: number | null
    /** An open form in the pane has edits. */
    dirty: boolean
}): FollowAction => {
    if (paneTab === target) return "none"
    const recent = lastPointerDown !== null && now - lastPointerDown < FOLLOW_QUIET_MS
    return recent || dirty ? "dot" : "show"
}
