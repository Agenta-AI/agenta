import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

/**
 * Pinned sessions, per project.
 *
 * Local-only for now, deliberately: storing a pin server-side is trivial (`session_streams`
 * already has `tags`), but reconciling pin lists across devices is not, and that is the part
 * worth designing rather than improvising. This module is the port — nothing outside it knows
 * where pins live, so the server implementation swaps in here.
 *
 * Keyed by project, NOT by app: the sessions page is project-wide, unlike the chat slice's
 * app-scoped session store.
 */
const pinnedByProjectAtom = atomWithStorage<Record<string, string[]>>("agenta:sessions:pinned", {})

export const pinnedSessionIdsAtom = atom<string[]>((get) => {
    const projectId = get(projectIdAtom)
    return projectId ? (get(pinnedByProjectAtom)[projectId] ?? []) : []
})

export const isSessionPinnedAtom = atom((get) => {
    const pinned = new Set(get(pinnedSessionIdsAtom))
    return (sessionId: string) => pinned.has(sessionId)
})

export const removeSessionPinAtom = atom(null, (get, set, sessionId: string) => {
    const projectId = get(projectIdAtom)
    if (!projectId) return

    const all = get(pinnedByProjectAtom)
    const current = all[projectId] ?? []
    const next = current.filter((id) => id !== sessionId)
    if (next.length === current.length) return

    set(pinnedByProjectAtom, {
        ...all,
        [projectId]: next,
    })
})

export const toggleSessionPinAtom = atom(null, (get, set, sessionId: string) => {
    const projectId = get(projectIdAtom)
    if (!projectId) return

    const all = get(pinnedByProjectAtom)
    const current = all[projectId] ?? []
    if (current.includes(sessionId)) {
        set(removeSessionPinAtom, sessionId)
        return
    }

    set(pinnedByProjectAtom, {
        ...all,
        [projectId]: [sessionId, ...current],
    })
})
