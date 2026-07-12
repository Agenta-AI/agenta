import {atom} from "jotai"

interface SessionInspectorState {
    open: boolean
    sessionId: string | null
    artifactId: string | null
    /** watcher_id from the last ATTACH command — what DETACH consumes. */
    watcherId: string | null
}

const sessionInspectorAtom = atom<SessionInspectorState>({
    open: false,
    sessionId: null,
    artifactId: null,
    watcherId: null,
})

export const sessionInspectorOpenAtom = atom((get) => get(sessionInspectorAtom).open)
export const sessionInspectorSessionIdAtom = atom((get) => get(sessionInspectorAtom).sessionId)
export const sessionInspectorArtifactIdAtom = atom((get) => get(sessionInspectorAtom).artifactId)
export const sessionInspectorWatcherIdAtom = atom((get) => get(sessionInspectorAtom).watcherId)

export const openSessionInspectorAtom = atom(
    null,
    (_get, set, sessionId: string, artifactId: string | null = null) => {
        set(sessionInspectorAtom, {open: true, sessionId, artifactId, watcherId: null})
    },
)

export const closeSessionInspectorAtom = atom(null, (get, set) => {
    set(sessionInspectorAtom, {...get(sessionInspectorAtom), open: false})
})

export const setSessionInspectorWatcherIdAtom = atom(null, (get, set, watcherId: string | null) => {
    set(sessionInspectorAtom, {...get(sessionInspectorAtom), watcherId})
})
