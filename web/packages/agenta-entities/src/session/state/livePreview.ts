import {atom} from "jotai"
import {atomFamily} from "jotai-family"

export interface SessionLivePreviewEntityState {
    part: Record<string, unknown> & {type: string}
    complete?: boolean
}

export interface SessionLivePreviewExecution {
    entityOrder: string[]
    byEntity: Record<string, SessionLivePreviewEntityState>
    lastFrameIndex: number
    retiredEntityIds?: string[]
    incompleteEntityIds?: string[]
    terminalCreatedAt?: string
}

/**
 * Display-only frame state for a session. `@agenta/chat` owns reduction semantics; the entity
 * layer owns the per-session lifetime so desktop and mobile share one source without touching the
 * sender's durable transcript or `useChat` state.
 */
export interface SessionLivePreviewState {
    executionOrder: string[]
    byExecution: Record<string, SessionLivePreviewExecution>
    gapDetected: boolean
}

export const createSessionLivePreviewState = (): SessionLivePreviewState => ({
    executionOrder: [],
    byExecution: {},
    gapDetected: false,
})

export const sessionLivePreviewAtomFamily = atomFamily((_sessionId: string) =>
    atom<SessionLivePreviewState>(createSessionLivePreviewState()),
)

export const clearSessionLivePreviewAtom = atom(null, (_get, set, sessionId: string) => {
    set(sessionLivePreviewAtomFamily(sessionId), createSessionLivePreviewState())
})
