// Compatibility selectors for existing UI expectations (read-only)
// These provide shapes similar to legacy selectors but read from normalized state.

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {appTypeAtom} from "@/oss/components/Playground/state/atoms/app"
import {displayedVariantsAtom} from "@/oss/components/Playground/state/atoms/variants"

import {
    inputRowIdsAtom,
    chatSessionIdsAtom,
    chatSessionsByIdAtom,
    logicalTurnIndexAtom,
} from "./entities"
import {
    rowVariablesAtomFamily,
    rowResponsesAtomFamily,
    assistantMessageAtomFamily,
} from "./selectors"

// Unifies row ids used for generation rendering across modes
// - completion: inputRowIdsAtom
// - chat: flatten of turnIds across sessions (ordered by sessionIds)
export const generationRowIdsCompatAtom = atom((get) => {
    const appType = get(appTypeAtom)
    if (appType !== "chat") {
        return get(inputRowIdsAtom)
    }
    const sessionIds = get(chatSessionIdsAtom)
    const sessions = get(chatSessionsByIdAtom)
    const turnIds: string[] = []
    for (const id of sessionIds) {
        const s = sessions[id]
        if (s?.turnIds?.length) turnIds.push(...s.turnIds)
    }
    return turnIds
})

// Logical turn ids (one per shared turn across revisions) for comparison view
export const generationLogicalTurnIdsAtom = atom((get) => {
    const appType = get(appTypeAtom)
    if (appType !== "chat") {
        return get(inputRowIdsAtom)
    }
    const index = get(logicalTurnIndexAtom)
    return Object.keys(index || {})
})

// Baseline session turn ids (first displayed revision) — ideal for rendering rows in comparison chat
export const generationBaselineTurnIdsAtom = atom((get) => {
    const appType = get(appTypeAtom)
    if (appType !== "chat") {
        return get(inputRowIdsAtom)
    }
    const displayed = (get(displayedVariantsAtom) || []) as string[]
    const baseline = displayed?.[0]
    if (!baseline) return [] as string[]
    const sessions = get(chatSessionsByIdAtom)
    const sessionId = `session-${baseline}`
    const turnIds = sessions?.[sessionId]?.turnIds || []
    return turnIds
})

// Input row ids compat: return all input rows for now (normalized InputRow is not a PropertyNode)
export const inputRowIdsWithPropertiesCompatAtom = atom((get) => get(inputRowIdsAtom))

// Compatibility wrappers that forward to normalized selectors (no new accessor logic)
export const variablesForRowByRevisionCompatAtomFamily = atomFamily(
    (p: {rowId: string; revisionId: string}) => atom((get) => get(rowVariablesAtomFamily(p))),
)

export const responsesForRowByRevisionCompatAtomFamily = atomFamily(
    (p: {rowId: string; revisionId: string}) => atom((get) => get(rowResponsesAtomFamily(p))),
)

export const assistantMessageForTurnByRevisionCompatAtomFamily = atomFamily(
    (p: {turnId: string; revisionId: string}) => atom((get) => get(assistantMessageAtomFamily(p))),
)
