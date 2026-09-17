import {useMemo} from "react"

import {
    anySessionRunningLocallyAtom,
    sessionLocalSettledAtAtomFamily,
    sessionStatusAtomFamily,
} from "@agenta/chat/state"
import {deriveStreamNest} from "@agenta/entities/session"
import {atom, useAtomValue} from "jotai"

import {useLivenessPoll} from "./useLivenessPoll"

/**
 * Is ANY session in the project running — for the tab badge, which has no session to ask.
 *
 * Local run-state first; then each liveness row, trusted only if this browser never ran it or the
 * poll was read AFTER our own turn settled — the desktop's `isRunningElsewhere` rule (#5844), so a
 * 15s-stale `is_running` cannot keep the badge lit after the turn that ran here ends.
 */
export const useAnySessionRunning = (projectId: string): boolean => {
    const runningHere = useAtomValue(anySessionRunningLocallyAtom)
    const {data, dataUpdatedAt} = useLivenessPoll(projectId)
    // A derived atom, so a settle stamp landing between polls repaints without a poll tick.
    const runningElsewhereAtom = useMemo(() => {
        const ids = (data ?? [])
            .filter((stream) => deriveStreamNest(stream).isRunning)
            .map((stream) => stream.session_id)
        return atom((get) =>
            ids.some((id) => {
                const local = get(sessionStatusAtomFamily(id))
                if (local === "running" || local === "awaiting") return false
                const settledAt = get(sessionLocalSettledAtAtomFamily(id))
                return settledAt === undefined || dataUpdatedAt > settledAt
            }),
        )
    }, [data, dataUpdatedAt])
    const runningElsewhere = useAtomValue(runningElsewhereAtom)
    return runningHere || runningElsewhere
}
