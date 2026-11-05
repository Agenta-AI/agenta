import {useCallback, useEffect, useRef, useState} from "react"

import {autoRefreshAtom} from "@agenta/observability"
import {AUTO_REFRESH_INTERVAL} from "@agenta/observability-ui"
import {useAtomValue} from "jotai"

/**
 * Refreshes `AUTO_REFRESH_INTERVAL` after the last refresh, manual or automatic, while the
 * toolbar's auto-refresh switch is on. Returns the refresh for the toolbar's button and a counter
 * that goes up after every refresh, so the countdown bar restarts with the next tick.
 */
export const useAutoRefresh = (refresh: () => Promise<unknown>) => {
    const autoRefresh = useAtomValue(autoRefreshAtom)
    const [refreshTrigger, setRefreshTrigger] = useState(0)
    const refreshRef = useRef(refresh)
    useEffect(() => {
        refreshRef.current = refresh
    }, [refresh])
    // A second refresh while one runs would cancel that refetch, so it is skipped.
    const pendingRef = useRef(false)

    const runRefresh = useCallback(async () => {
        if (pendingRef.current) return
        pendingRef.current = true
        try {
            await refreshRef.current()
        } finally {
            pendingRef.current = false
            setRefreshTrigger((count) => count + 1)
        }
    }, [])

    // Re-armed by every completed refresh, so the next tick lines up with the countdown bar.
    useEffect(() => {
        if (!autoRefresh) return
        const id = setTimeout(() => {
            runRefresh().catch((error) => console.error("Auto-refresh failed", error))
        }, AUTO_REFRESH_INTERVAL)
        return () => clearTimeout(id)
    }, [autoRefresh, refreshTrigger, runRefresh])

    return {refresh: runRefresh, refreshTrigger}
}
