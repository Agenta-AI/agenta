/**
 * Decides when a revision the agent committed in this session is applied to the session.
 *
 * Each commit is acted on once, whichever path reports it first (the records reader or a
 * `data-committed-revision` stream part). A commit that arrives while the tab is hidden is kept
 * and applied when the tab is visible again; until then nobody sees the workspace change under
 * them. When several commits arrive while hidden, only the newest one is kept.
 *
 * `apply` decides what applying means (refresh the caches, pin the session, retarget the next
 * send) and when to hold back, for example while the config pane has unsaved edits.
 */
export interface CommitFollower {
    /** Report a commit. Applies it now when the tab is visible, otherwise keeps it pending. */
    report: (revisionId: string) => void
    /** Apply the pending commit, if any, once the tab is visible. */
    flush: () => void
}

export const createCommitFollower = ({
    apply,
    isVisible,
}: {
    apply: (revisionId: string) => void
    isVisible: () => boolean
}): CommitFollower => {
    const seen = new Set<string>()
    let pending: string | null = null
    return {
        report: (revisionId) => {
            if (seen.has(revisionId)) return
            seen.add(revisionId)
            if (!isVisible()) {
                pending = revisionId
                return
            }
            pending = null
            apply(revisionId)
        },
        flush: () => {
            if (pending === null || !isVisible()) return
            const revisionId = pending
            pending = null
            apply(revisionId)
        },
    }
}
