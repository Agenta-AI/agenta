import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import type {SessionLiveFrame} from "../core/schema"

export interface SessionLivePreviewExecution {
    frames: SessionLiveFrame[]
}

/**
 * Display-only frame state for a session. `@agenta/chat` owns reduction semantics; the entity
 * layer owns the per-session lifetime so desktop and mobile share one source without touching the
 * sender's durable transcript or `useChat` state.
 */
export interface SessionLivePreviewState {
    executionOrder: string[]
    byExecution: Record<string, SessionLivePreviewExecution>
    seenFrameIds: Record<string, true>
}

export const createSessionLivePreviewState = (): SessionLivePreviewState => ({
    executionOrder: [],
    byExecution: {},
    seenFrameIds: {},
})

export const sessionLivePreviewAtomFamily = atomFamily((_sessionId: string) =>
    atom<SessionLivePreviewState>(createSessionLivePreviewState()),
)

export const clearSessionLivePreviewAtom = atom(null, (_get, set, sessionId: string) => {
    set(sessionLivePreviewAtomFamily(sessionId), createSessionLivePreviewState())
})
