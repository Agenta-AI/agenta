import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import {fetchSessionCapabilities, fetchSessionSnapshot, removePendingSessionInput} from "../api/api"

export const fetchSessionCapabilitiesAtom = atom(null, async (get, _set, sessionId: string) => {
    const projectId = get(projectIdAtom) ?? ""
    return fetchSessionCapabilities({projectId, sessionId})
})

export const fetchSessionSnapshotAtom = atom(null, async (get, _set, sessionId: string) => {
    const projectId = get(projectIdAtom) ?? ""
    return fetchSessionSnapshot({projectId, sessionId})
})

export const removePendingSessionInputAtom = atom(
    null,
    async (get, _set, params: {sessionId: string; inputId: string}) => {
        const projectId = get(projectIdAtom) ?? ""
        return removePendingSessionInput({projectId, ...params})
    },
)
