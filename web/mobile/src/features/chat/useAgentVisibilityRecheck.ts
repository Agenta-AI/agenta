import {useEffect, useRef} from "react"

/** Re-reads the agent revision on each sharing recheck; the server hides a private agent as unknown. */
export const useAgentVisibilityRecheck = ({
    checkedAt,
    enabled,
    refetch,
}: {
    /** When the sharing state was last read, answered or failed (0 = not yet). */
    checkedAt: number
    enabled: boolean
    refetch: () => unknown
}) => {
    const seen = useRef(0)
    useEffect(() => {
        if (!checkedAt || checkedAt === seen.current) return
        const first = seen.current === 0
        seen.current = checkedAt
        if (first || !enabled) return
        void refetch()
    }, [checkedAt, enabled, refetch])
}
