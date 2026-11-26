import {useEffect, useRef} from "react"

/**
 * Re-reads the agent revision on each sharing recheck; the server hides a private agent as unknown.
 *
 * The first read of a session is not a recheck: the revision query reads the agent itself when
 * the session opens. The screen stays mounted across a session switch, so "first" is per session.
 */
export const useAgentVisibilityRecheck = ({
    sessionId,
    checkedAt,
    enabled,
    refetch,
}: {
    sessionId: string
    /** When the sharing state was last read, answered or failed (0 = not yet). */
    checkedAt: number
    enabled: boolean
    refetch: () => unknown
}) => {
    const seen = useRef<{sessionId: string; checkedAt: number} | null>(null)
    useEffect(() => {
        if (!checkedAt) return
        const last = seen.current
        if (last?.sessionId === sessionId && last.checkedAt === checkedAt) return
        seen.current = {sessionId, checkedAt}
        if (last?.sessionId !== sessionId || !enabled) return
        void refetch()
    }, [sessionId, checkedAt, enabled, refetch])
}
