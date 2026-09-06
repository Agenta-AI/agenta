import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import {
    fetchSessionCapabilities,
    fetchSessionSnapshot,
    removePendingSessionInput,
    sendPendingSessionInputNow,
    updatePendingSessionInput,
} from "../api/api"

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

export const sendPendingSessionInputNowAtom = atom(
    null,
    async (get, _set, params: {sessionId: string; inputId: string}) => {
        const projectId = get(projectIdAtom) ?? ""
        return sendPendingSessionInputNow({projectId, ...params})
    },
)

export const updatePendingSessionInputAtom = atom(
    null,
    async (
        get,
        _set,
        params: {
            sessionId: string
            inputId: string
            text: string
            attachments?: {
                uri: string
                mime_type: string
                filename?: string
                attachment_id?: string
            }[]
        },
    ) => {
        const projectId = get(projectIdAtom) ?? ""
        return updatePendingSessionInput({projectId, ...params})
    },
)
