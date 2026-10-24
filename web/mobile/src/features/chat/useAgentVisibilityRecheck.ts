import {useEffect, useRef} from "react"

/**
 * Re-read the agent's latest revision each time the session's sharing recheck reads (the 60 s
 * budget, see `useChatAccess`'s `checkedAt`). The server answers a hidden agent like an unknown
 * one, so this is what turns "the owner made the agent private" into `agentHidden` while the
 * chat stays open: no separate timer, and nothing on the first read (the revision query has
 * just loaded then). `enabled` is false while no agent is bound, so nothing asks for an empty id.
 */
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
