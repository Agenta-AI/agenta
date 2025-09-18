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
    chatTurnIdsAtom,
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
    const ids = (get(chatTurnIdsAtom) || []) as string[]
    return ids
})

// Input row ids compat: return all input rows for now (normalized InputRow is not a PropertyNode)
export const inputRowIdsWithPropertiesCompatAtom = atom((get) => get(inputRowIdsAtom))
