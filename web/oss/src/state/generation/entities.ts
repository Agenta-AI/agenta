// Normalized generation state entities
// Core types and top-level entity maps

import {atom} from "jotai"

// PropertyNode is the shared structure used by variables and messages throughout UI
// Matches legacy format: __id-based nodes with optional __metadata and nested children/content
export interface PropertyNode {
    __id: string
    __metadata?: Record<string, any>
    content?: {value: any} | any
    value?: any
    children?: PropertyNode[]
    role?: string
    [k: string]: any
}

export interface InputRow {
    id: string
    // Variables and responses are revision-scoped to unify single/compare
    // Variables are represented as a PropertyNode tree/array to align with UI helpers
    variablesByRevision: Record<string, PropertyNode[]>
    // Completion responses are an array/tree of PropertyNodes (LLM messages)
    responsesByRevision: Record<string, PropertyNode[]>
    meta?: Record<string, any>
}

export interface ChatSession {
    id: string
    // Session-level variables (e.g., system variables) also revision-scoped
    variablesByRevision: Record<string, PropertyNode[]>
    turnIds: string[]
    meta?: Record<string, any>
}

export interface ChatTurn {
    id: string
    sessionId: string
    // User message follows PropertyNode structure
    userMessage: PropertyNode
    // Assistant message is revision-scoped and uses PropertyNode
    assistantMessageByRevision: Record<string, PropertyNode | null>
    meta?: Record<string, any>
}

// Entity maps + id lists
export const inputRowsByIdAtom = atom<Record<string, InputRow>>({})
export const inputRowIdsAtom = atom<string[]>([])

export const chatSessionsByIdAtom = atom<Record<string, ChatSession>>({})
export const chatSessionIdsAtom = atom<string[]>([])

export const chatTurnsByIdAtom = atom<Record<string, ChatTurn>>({})
// Derived index can be added later if necessary; for now selectors will compute by session

// Indexes for bridging legacy rowIds to normalized context during migration
export interface RowIdIndexEntry {
    latestRevisionId?: string
    chatTurnIds?: string[]
}

export const rowIdIndexAtom = atom<Record<string, RowIdIndexEntry>>({})

// Mapping of logical (shared) turn ids to per-revision session turn ids
// logicalTurnId -> { [revisionId]: sessionTurnId }
export const logicalTurnIndexAtom = atom<Record<string, Record<string, string>>>({})

// Normalized run status per row + revision
// Keyed by `${rowId}:${revisionId}` to avoid nested structures churn
export const runStatusByRowRevisionAtom = atom<
    Record<string, {isRunning?: string | false; resultHash?: string | null}>
>({})
