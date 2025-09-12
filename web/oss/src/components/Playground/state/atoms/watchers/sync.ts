import {getDefaultStore} from "jotai"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"

import {inputRowsByIdAtom as normInputRowsByIdAtom} from "@/oss/state/generation/entities"
import {promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

import {appChatModeAtom} from "../app"
import {syncPromptVariablesToNormalizedAtom} from "../mutations/sync/syncPromptVariables"

// Attach onMount wiring for dynamic variables sync watcher
import {displayedVariantsAtom, displayedVariantsVariablesAtom} from "../variants"
import {schemaInputKeysAtom} from "../variants"
;(syncPromptVariablesToNormalizedAtom as any).onMount = (_setSelf: any) => {
    const store = getDefaultStore()
    // Manage dynamic subscriptions to per-revision prompt variables
    let revSubs = new Map<string, () => void>()
    const runSync = () => {
        try {
            const _isChat = store.get(appChatModeAtom) as boolean
            const displayedRevIds = (store.get(displayedVariantsAtom) || []) as string[]
            // Refresh subscriptions to prompt variables for each displayed revision
            const current = new Set(displayedRevIds)
            // Unsubscribe removed revisions
            for (const [revId, unsub] of revSubs.entries()) {
                if (!current.has(revId)) {
                    unsub()
                    revSubs.delete(revId)
                }
            }
            // Subscribe new revisions
            for (const revId of displayedRevIds) {
                if (!revSubs.has(revId)) {
                    const unsub = store.sub(promptVariablesAtomFamily(revId), runSync)
                    revSubs.set(revId, unsub)
                }
            }
            // Build per-revision variable sets (schema keys for custom apps, prompt vars for others)
            const revVarSets = new Map<string, Set<string>>()
            const schemaKeys = (store.get(schemaInputKeysAtom) || []) as string[]
            for (const revId of displayedRevIds) {
                const flags = store.get(variantFlagsAtomFamily({revisionId: revId})) as any
                const isCustom = !!flags?.isCustom
                const vars = isCustom
                    ? schemaKeys || []
                    : ((store.get(promptVariablesAtomFamily(revId)) || []) as string[])
                revVarSets.set(revId, new Set(vars))
            }

            // Sync normalized input rows
            store.set(normInputRowsByIdAtom, (prev) => {
                const next = {...prev}
                Object.entries(next || {}).forEach(([rowId, row]: any) => {
                    const byRev = row?.variablesByRevision || {}
                    const updatedByRev: Record<string, any[]> = {}
                    Object.entries(byRev).forEach(([revId, nodes]: any) => {
                        const varSet = revVarSets.get(revId) || new Set<string>()
                        const kept: any[] = []
                        const present = new Set<string>()
                        for (const n of nodes || []) {
                            const name = String(n?.key ?? n?.__id ?? "")
                            if (name && varSet.has(name)) {
                                kept.push(n)
                                present.add(name)
                            }
                        }
                        // Add any missing required vars for this revision using proper shape
                        if (varSet.size) {
                            for (const vid of varSet) {
                                if (!present.has(vid))
                                    kept.push({
                                        __id: generateId(),
                                        key: vid,
                                        value: "",
                                        content: {value: ""},
                                    })
                            }
                        }
                        updatedByRev[revId] = kept
                    })
                    next[rowId] = {...row, variablesByRevision: updatedByRev}
                })
                return next
            })
        } catch {
            // no-op
        }
    }

    // Initial & reactive sync
    runSync()
    const unsubs: (() => void)[] = []
    unsubs.push(store.sub(displayedVariantsVariablesAtom, runSync))
    unsubs.push(store.sub(appChatModeAtom, runSync))
    // React when prompt-derived variables or displayed variants change
    unsubs.push(store.sub(displayedVariantsVariablesAtom, runSync))
    unsubs.push(store.sub(displayedVariantsAtom, runSync))
    return () => {
        unsubs.forEach((fn) => fn())
        for (const [, unsub] of revSubs) {
            unsub()
        }
        revSubs.clear()
    }
}
