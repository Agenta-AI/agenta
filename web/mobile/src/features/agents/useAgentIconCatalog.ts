import {useCallback, useEffect, useState} from "react"

import {loadAgentIconCatalog, type PhosphorCatalogEntry} from "@agenta/ui/agent-icon"

export interface AgentIconCatalogState {
    entries: PhosphorCatalogEntry[] | null
    failed: boolean
    retry: () => void
}

/**
 * The icon catalog for the sheet, loaded once for the whole tree.
 *
 * One loader, so the header seed and the grid cannot disagree about whether it arrived — they did,
 * and the seed's copy silently swallowed a failed chunk while the grid offered a retry.
 */
export const useAgentIconCatalog = (enabled: boolean): AgentIconCatalogState => {
    const [entries, setEntries] = useState<PhosphorCatalogEntry[] | null>(null)
    const [failed, setFailed] = useState(false)
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        if (!enabled) return
        let alive = true
        setFailed(false)
        loadAgentIconCatalog().then(
            (loaded) => {
                if (alive) setEntries(loaded)
            },
            () => {
                if (alive) setFailed(true)
            },
        )
        return () => {
            alive = false
        }
    }, [enabled, attempt])

    return {entries, failed, retry: useCallback(() => setAttempt((n) => n + 1), [])}
}
