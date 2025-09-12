import {atom} from "jotai"

import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {
    inputRowsByIdAtom as normInputRowsByIdAtom,
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
} from "@/oss/state/generation/entities"
import {promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

import {appChatModeAtom} from "../../app"
import {displayedVariantsAtom} from "../../variants"
import {schemaInputKeysAtom} from "../../variants"

/**
 * Imperative trigger: force a one-off sync (used by discard-draft flow)
 */
export const forceSyncPromptVariablesToNormalizedAtom = atom(null, (get, set) => {
    const isChat = get(appChatModeAtom) as boolean
    const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
    const revVarSets = new Map<string, Set<string>>()
    const schemaKeys = (get(schemaInputKeysAtom) || []) as string[]
    for (const revId of displayedRevIds) {
        const flags = get(variantFlagsAtomFamily({revisionId: revId})) as any
        const isCustom = !!flags?.isCustom
        const vars = isCustom
            ? schemaKeys || []
            : ((get(promptVariablesAtomFamily(revId)) || []) as string[])
        revVarSets.set(revId, new Set(vars))
    }

    // Sync normalized input rows per revision: strictly prune to required set and add missing
    set(normInputRowsByIdAtom, (prev) => {
        const next = {...prev}
        Object.entries(next || {}).forEach(([rowId, row]: any) => {
            const byRev = row?.variablesByRevision || {}
            const updatedByRev: Record<string, any[]> = {}
            Object.entries(byRev).forEach(([revId, nodes]: any) => {
                const varSet = revVarSets.get(revId) || new Set<string>()
                const kept: any[] = []
                const present = new Set<string>()
                // Keep only variables that are currently required by prompts/schema
                for (const n of nodes || []) {
                    const name = String(n?.key ?? n?.__id ?? "")
                    if (name && varSet.has(name)) {
                        kept.push(n)
                        present.add(name)
                    }
                }
                // Add any missing required variables
                if (varSet.size) {
                    for (const vid of varSet) {
                        if (!present.has(vid)) {
                            kept.push({
                                __id: generateId(),
                                key: vid,
                                value: "",
                                content: {value: ""},
                            })
                        }
                    }
                }
                updatedByRev[revId] = kept
            })
            next[rowId] = {...row, variablesByRevision: updatedByRev}
        })
        return next
    })

    if (isChat) {
        set(normChatSessionsByIdAtom, (prev) => {
            const next = {...prev}
            Object.entries(next || {}).forEach(([sid, session]: any) => {
                const byRev = session?.variablesByRevision || {}
                const updatedByRev: Record<string, any[]> = {}
            Object.entries(byRev).forEach(([revId, nodes]: any) => {
                const varSet = revVarSets.get(revId) || new Set<string>()
                const kept: any[] = []
                const present = new Set<string>()
                for (const n of nodes || []) {
                    const name = (n as any)?.key ?? (n as any)?.__id
                    if (name && varSet.has(String(name))) {
                        kept.push(n)
                        present.add(String(name))
                    }
                }
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
                next[sid] = {...session, variablesByRevision: updatedByRev}
            })
            return next
        })
    }
})
