import {useCallback, useEffect, useRef, useState} from "react"

import {autoRefreshAtom} from "@agenta/observability"
import {AUTO_REFRESH_INTERVAL} from "@agenta/observability-ui"
import {useAtomValue} from "jotai"

/**
 * Runs `refresh` every `AUTO_REFRESH_INTERVAL` while the toolbar's auto-refresh switch is on, the
 * same cadence as the old app's tables. Returns the refresh to give the toolbar's button and a
 * counter that goes up after every refresh, manual or automatic, so the countdown bar restarts.
 */
export const useAutoRefresh = (refresh: () => Promise<unknown>) => {
    const autoRefresh = useAtomValue(autoRefreshAtom)
    const [refreshTrigger, setRefreshTrigger] = useState(0)
    // The interval reads the latest refresh, so a tab switch does not restart the countdown.
    const refreshRef = useRef(refresh)
    refreshRef.current = refresh

    const runRefresh = useCallback(async () => {
        await refreshRef.current()
        setRefreshTrigger((count) => count + 1)
    }, [])

    useEffect(() => {
        if (!autoRefresh) return
        const id = setInterval(() => {
            runRefresh().catch((error) => console.error("Auto-refresh failed", error))
        }, AUTO_REFRESH_INTERVAL)
        return () => clearInterval(id)
    }, [autoRefresh, runRefresh])

    return {refresh: runRefresh, refreshTrigger}
}
