// Compatibility selectors for existing UI expectations (read-only)
// These provide shapes similar to legacy selectors but read from normalized state.

import {atom} from "jotai"

import {appTypeAtom} from "@/oss/components/Playground/state/atoms/app"

import {
    chatSessionIdsAtom,
    chatSessionsByIdAtom,
    chatTurnIdsAtom,
    inputRowIdsAtom,
} from "./entities"

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
    if (appType !== "chat") return get(inputRowIdsAtom)
    return (get(chatTurnIdsAtom) || []) as string[]
})

// Input row ids compat: return all input rows for now (normalized InputRow is not a PropertyNode)
export const inputRowIdsWithPropertiesCompatAtom = atom((get) => get(inputRowIdsAtom))
