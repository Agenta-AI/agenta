// Normalized generation state entities
// Core types and top-level entity maps

import {atom} from "jotai"

import {routerAppIdAtom, recentAppIdAtom} from "@/oss/state/app/atoms/fetcher"

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
// App-aware helpers
const getAppId = (get: any) => get(routerAppIdAtom) || get(recentAppIdAtom) || "__global__"

// Backing storage per app
const inputRowsByAppAtom = atom<Record<string, Record<string, InputRow>>>({})
const inputRowIdsByAppAtom = atom<Record<string, string[]>>({})

export const inputRowsByIdAtom = atom(
    (get) => {
        const appId = getAppId(get)
        const all = get(inputRowsByAppAtom)
        return all[appId] ?? {}
    },
    (
        get,
        set,
        next:
            | Record<string, InputRow>
            | ((prev: Record<string, InputRow>) => Record<string, InputRow>),
    ) => {
        const appId = getAppId(get)
        const all = get(inputRowsByAppAtom)
        const prev = all[appId] ?? {}
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(inputRowsByAppAtom, {...all, [appId]: value})
    },
)

export const inputRowIdsAtom = atom(
    (get) => {
        const appId = getAppId(get)
        const all = get(inputRowIdsByAppAtom)
        return all[appId] ?? []
    },
    (get, set, next: string[] | ((prev: string[]) => string[])) => {
        const appId = getAppId(get)
        const all = get(inputRowIdsByAppAtom)
        const prev = all[appId] ?? []
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(inputRowIdsByAppAtom, {...all, [appId]: value})
    },
)

const chatSessionsByAppAtom = atom<Record<string, Record<string, ChatSession>>>({})
const chatSessionIdsByAppAtom = atom<Record<string, string[]>>({})

export const chatSessionsByIdAtom = atom(
    (get) => {
        const appId = getAppId(get)
        const all = get(chatSessionsByAppAtom)
        return all[appId] ?? {}
    },
    (
        get,
        set,
        next:
            | Record<string, ChatSession>
            | ((prev: Record<string, ChatSession>) => Record<string, ChatSession>),
    ) => {
        const appId = getAppId(get)
        const all = get(chatSessionsByAppAtom)
        const prev = all[appId] ?? {}
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(chatSessionsByAppAtom, {...all, [appId]: value})
    },
)

export const chatSessionIdsAtom = atom(
    (get) => {
        const appId = getAppId(get)
        const all = get(chatSessionIdsByAppAtom)
        return all[appId] ?? []
    },
    (get, set, next: string[] | ((prev: string[]) => string[])) => {
        const appId = getAppId(get)
        const all = get(chatSessionIdsByAppAtom)
        const prev = all[appId] ?? []
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(chatSessionIdsByAppAtom, {...all, [appId]: value})
    },
)

const chatTurnsByAppAtom = atom<Record<string, Record<string, ChatTurn>>>({})

export const chatTurnsByIdAtom = atom(
    (get) => {
        const appId = getAppId(get)
        const all = get(chatTurnsByAppAtom)
        return all[appId] ?? {}
    },
    (
        get,
        set,
        next:
            | Record<string, ChatTurn>
            | ((prev: Record<string, ChatTurn>) => Record<string, ChatTurn>),
    ) => {
        const appId = getAppId(get)
        const all = get(chatTurnsByAppAtom)
        const prev = all[appId] ?? {}
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(chatTurnsByAppAtom, {...all, [appId]: value})
    },
)
// Derived index can be added later if necessary; for now selectors will compute by session

// Indexes for bridging legacy rowIds to normalized context during migration
export interface RowIdIndexEntry {
    latestRevisionId?: string
    chatTurnIds?: string[]
}

const rowIdIndexByAppAtom = atom<Record<string, Record<string, RowIdIndexEntry>>>({})

export const rowIdIndexAtom = atom(
    (get) => {
        const appId = getAppId(get)
        const all = get(rowIdIndexByAppAtom)
        return all[appId] ?? {}
    },
    (
        get,
        set,
        next:
            | Record<string, RowIdIndexEntry>
            | ((prev: Record<string, RowIdIndexEntry>) => Record<string, RowIdIndexEntry>),
    ) => {
        const appId = getAppId(get)
        const all = get(rowIdIndexByAppAtom)
        const prev = all[appId] ?? {}
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(rowIdIndexByAppAtom, {...all, [appId]: value})
    },
)

// Mapping of logical (shared) turn ids to per-revision session turn ids
// logicalTurnId -> { [revisionId]: sessionTurnId }
const logicalTurnIndexByAppAtom = atom<Record<string, Record<string, Record<string, string>>>>({})

export const logicalTurnIndexAtom = atom(
    (get) => {
        const appId = getAppId(get)
        const all = get(logicalTurnIndexByAppAtom)
        return all[appId] ?? {}
    },
    (
        get,
        set,
        next:
            | Record<string, Record<string, string>>
            | ((
                  prev: Record<string, Record<string, string>>,
              ) => Record<string, Record<string, string>>),
    ) => {
        const appId = getAppId(get)
        const all = get(logicalTurnIndexByAppAtom)
        const prev = all[appId] ?? {}
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(logicalTurnIndexByAppAtom, {...all, [appId]: value})
    },
)

// Normalized run status per row + revision
// Keyed by `${rowId}:${revisionId}` to avoid nested structures churn
const runStatusByAppAtom = atom<
    Record<string, Record<string, {isRunning?: string | false; resultHash?: string | null}>>
>({})

export const runStatusByRowRevisionAtom = atom(
    (get) => {
        const appId = getAppId(get)
        const all = get(runStatusByAppAtom)
        return all[appId] ?? {}
    },
    (
        get,
        set,
        next:
            | Record<string, {isRunning?: string | false; resultHash?: string | null}>
            | ((
                  prev: Record<string, {isRunning?: string | false; resultHash?: string | null}>,
              ) => Record<string, {isRunning?: string | false; resultHash?: string | null}>),
    ) => {
        const appId = getAppId(get)
        const all = get(runStatusByAppAtom)
        const prev = all[appId] ?? {}
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(runStatusByAppAtom, {...all, [appId]: value})
    },
)
