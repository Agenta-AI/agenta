import {atom} from "jotai"
import {getDefaultStore} from "jotai"

import {
    chatSessionsByIdAtom,
    chatTurnsByIdAtom,
    logicalTurnIndexAtom,
    runStatusByRowRevisionAtom,
} from "@/oss/state/generation/entities"
import {inputRowsByIdAtom, inputRowIdsAtom, rowIdIndexAtom} from "@/oss/state/generation/entities"
import {promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

import {normalizeEmptyTailMessageShapeAtom} from "../mutations/chat/normalizeEmptyTail"
import {expectedRoundByLogicalAtom} from "../orchestration/expected"
import {displayedVariantsAtom, schemaInputKeysAtom} from "../variants"

/**
 * Mode Reset Watcher
 * When switching from single mode (1 displayed rev) to comparison (>1 revs),
 * sanitize state to avoid single-mode artifacts interfering with comparison runs.
 *
 * Steps on transition 1 -> >1:
 * - Clear lingering single-origin expected rounds
 * - Rebuild logicalTurnIndex (handled by syncMapping watcher separately)
 * - Prune trailing empty user tails across displayed sessions
 * - Normalize tail shapes (ids/metadata)
 */
export const modeResetWatcherAtom = atom(null)
;(modeResetWatcherAtom as any).onMount = () => {
    const store = getDefaultStore()
    const DEBUG = process.env.NODE_ENV !== "production"

    let prevCount = Array.isArray(store.get(displayedVariantsAtom))
        ? (store.get(displayedVariantsAtom) as string[]).length
        : 0

    const pruneTrailingEmptyTails = () => {
        try {
            const displayed = (store.get(displayedVariantsAtom) || []) as string[]
            const sessions = (store.get(chatSessionsByIdAtom) || {}) as Record<string, any>
            const turns = (store.get(chatTurnsByIdAtom) || {}) as Record<string, any>
            const removed: string[] = []

            const nextSessions: Record<string, any> = {}
            const nextTurns: Record<string, any> = {...turns}

            displayed.forEach((revId) => {
                const sid = `session-${revId}`
                const sess = sessions[sid]
                if (!sess) return
                const ids: string[] = Array.from(sess.turnIds || [])
                // Drop trailing turns that are empty user inputs
                while (ids.length > 0) {
                    const lastId = ids[ids.length - 1]
                    const t = nextTurns[lastId]
                    if (!t) break
                    const user = t.userMessage
                    const v = user?.content?.value
                    const isEmpty =
                        (typeof v === "string" && v.trim().length === 0) ||
                        (Array.isArray(v) && v.length === 0)
                    if (!isEmpty) break
                    // remove this tail turn
                    ids.pop()
                    removed.push(lastId)
                    delete nextTurns[lastId]
                }
                nextSessions[sid] = {...sess, turnIds: ids}
            })

            if (removed.length) {
                store.set(chatTurnsByIdAtom, nextTurns)
                store.set(chatSessionsByIdAtom, (prev) => ({...prev, ...nextSessions}))
                // Also rebuild logicalTurnIndex to drop deleted turns
                store.set(logicalTurnIndexAtom, (prev) => {
                    const out: Record<string, Record<string, string>> = {}
                    Object.entries(prev || {}).forEach(([lid, m]) => {
                        const filtered: Record<string, string> = {}
                        Object.entries(m || {}).forEach(([revId, tid]) => {
                            if (!removed.includes(tid)) filtered[revId] = tid
                        })
                        if (Object.keys(filtered).length > 0) out[lid] = filtered
                    })
                    return out as any
                })
            }

            if (DEBUG) {
                console.log("[ModeReset] pruneTrailingEmptyTails", {displayed, removed})
            }
        } catch (e) {
            console.error("[ModeReset] prune failed", e)
        }
    }

    const clearSingleExpectedRounds = () => {
        try {
            const expected = (store.get(expectedRoundByLogicalAtom) || {}) as Record<
                string,
                {expectedRevIds: string[]; roundId: string; origin?: "single" | "fanout" | "rerun"}
            >
            const keys = Object.keys(expected || {})
            if (!keys.length) return
            const next = {...expected}
            let cleared = 0
            keys.forEach((k) => {
                if ((expected[k]?.origin || "") === "single") {
                    delete next[k]
                    cleared++
                }
            })
            if (cleared) store.set(expectedRoundByLogicalAtom, next)
            if (DEBUG) {
                console.log("[ModeReset] cleared single-origin expected rounds", {cleared})
            }
        } catch (e) {
            console.error("[ModeReset] clear single expected failed", e)
        }
    }

    const normalizeTails = () => {
        try {
            store.set(normalizeEmptyTailMessageShapeAtom)
            if (DEBUG) {
                console.log("[ModeReset] normalize tails applied")
            }
        } catch (e) {
            console.error("[ModeReset] normalize tails failed", e)
        }
    }

    const onDisplayedChange = () => {
        try {
            const curr = (store.get(displayedVariantsAtom) || []) as string[]
            const currCount = Array.isArray(curr) ? curr.length : 0
            // single -> comparison transition
            if (prevCount === 1 && currCount > 1) {
                if (DEBUG) {
                    console.log("[ModeReset] single->comparison reset start", {
                        prevCount,
                        currCount,
                    })
                }
                clearSingleExpectedRounds()
                pruneTrailingEmptyTails()
                normalizeTails()
            }
            // comparison -> single transition: prune inputs to active revision and keys
            if (prevCount > 1 && currCount === 1) {
                const active = curr[0]
                if (active) {
                    try {
                        // Build required key set for the active revision
                        const flags = store.get(variantFlagsAtomFamily({revisionId: active})) as any
                        const isCustom = !!flags?.isCustom
                        const keys = isCustom
                            ? ((store.get(schemaInputKeysAtom) || []) as string[])
                            : ((store.get(promptVariablesAtomFamily(active)) || []) as string[])
                        const req = new Set<string>(keys || [])

                        // Collapse to a single canonical row and prune vars to active revision/keys
                        const ids = (store.get(inputRowIdsAtom) || []) as string[]
                        if (Array.isArray(ids) && ids.length > 0) {
                            const keepId = ids[0]
                            const rows = (store.get(inputRowsByIdAtom) || {}) as Record<string, any>
                            const keepRow = rows[keepId] || {id: keepId}
                            const existingNodes = ((keepRow?.variablesByRevision || {})[
                                active
                            ] || []) as any[]
                            const filtered = (existingNodes || [])
                                .filter((n: any) => req.has(String(n?.key ?? n?.__id)))
                                .map((n: any) => ({...n}))
                            const nextRows: Record<string, any> = {
                                [keepId]: {
                                    ...keepRow,
                                    variablesByRevision: {[active]: filtered},
                                },
                            }
                            store.set(inputRowsByIdAtom, nextRows)
                            store.set(inputRowIdsAtom, [keepId])
                            // Update rowIdIndex latest revision
                            store.set(rowIdIndexAtom, (prev) => ({
                                ...(prev || {}),
                                [keepId]: {
                                    ...((prev || {}) as any)[keepId],
                                    latestRevisionId: active,
                                },
                            }))
                        }
                    } catch (e) {
                        console.error("[ModeReset] prune inputs for single failed", e)
                    }
                }
            }
            prevCount = currCount
        } catch (e) {
            console.error("[ModeReset] onDisplayedChange failed", e)
        }
    }

    const unsub = store.sub(displayedVariantsAtom, onDisplayedChange)
    return () => {
        unsub && unsub()
    }
}
