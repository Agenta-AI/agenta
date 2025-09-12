import {atom} from "jotai"
import {getDefaultStore} from "jotai"

import {
    chatSessionsByIdAtom,
    chatTurnsByIdAtom,
    logicalTurnIndexAtom,
} from "@/oss/state/generation/entities"

import {displayedVariantsAtom} from "../variants"
import {normalizeComparisonChatTurnsMutationAtom} from "../generationMutations"

/**
 * Watcher: when switching views (e.g., single -> comparison), rebuild logicalTurnIndexAtom
 * from actual session turnIds so the mapping {logicalId -> {revId -> turnId}} stays in sync.
 *
 * This avoids situations where prune relies on a mapping whose sid is missing in a session
 * (idx < 0), by guaranteeing that the mapping only points to existing turnIds per session.
 */
export const syncMappingWatcherAtom = atom(null)
;(syncMappingWatcherAtom as any).onMount = () => {
    const store = getDefaultStore()
    const DEBUG = process.env.NODE_ENV !== "production"

    const rebuild = () => {
        try {
            const displayed = (store.get(displayedVariantsAtom) || []) as string[]
            if (!Array.isArray(displayed) || displayed.length === 0) return

            const sessions = (store.get(chatSessionsByIdAtom) || {}) as Record<string, any>
            const turns = (store.get(chatTurnsByIdAtom) || {}) as Record<string, any>
            const oldIndex = (store.get(logicalTurnIndexAtom) || {}) as Record<
                string,
                Record<string, string>
            >

            const nextIndex: Record<string, Record<string, string>> = {...oldIndex}
            const added: {logicalId: string; revId: string; turnId: string}[] = []

            for (const revId of displayed) {
                const sid = `session-${revId}`
                const sess = sessions[sid]
                const tids = (sess?.turnIds || []) as string[]
                for (const tid of tids) {
                    const t = turns[tid]
                    const lid = t?.logicalTurnId as string | undefined
                    if (!lid) continue
                    const map = nextIndex[lid] ? {...nextIndex[lid]} : {}
                    if (map[revId] !== tid) {
                        map[revId] = tid
                        nextIndex[lid] = map
                        added.push({logicalId: lid, revId, turnId: tid})
                    }
                }
            }

            store.set(logicalTurnIndexAtom, nextIndex)
            // Also normalize turns for the current view to preserve message parts (e.g., images)
            try {
                store.set(normalizeComparisonChatTurnsMutationAtom)
            } catch {}
            if (DEBUG) {
                console.log("[SyncMapping] rebuilt logicalTurnIndex", {
                    displayed,
                    updates: added.slice(0, 20),
                    totalUpdates: added.length,
                })
            }
        } catch (e) {
            console.error("[SyncMapping] rebuild failed", e)
        }
    }

    const unsub = store.sub(displayedVariantsAtom, rebuild)
    // Run once on mount as well
    rebuild()

    return () => {
        try {
            unsub && unsub()
        } catch {}
    }
}
