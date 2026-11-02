/**
 * Replay joins durable records with interaction rows because records omit later row lifecycle.
 * New rows join through `data.request.tool_call_id`; legacy rows join through token equality.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {queryInteractions} from "../api/api"
import type {
    SessionInteraction,
    SessionInteractionKind,
    SessionInteractionStatusCode,
} from "../core/schema"
import {sessionInteractionWatchEventSchema} from "../core/schema"

const SESSION_INTERACTION_ROWS_STALE_MS = 15_000

export const sessionInteractionRowsQueryKey = (projectId: string, sessionId: string) =>
    ["session", "interactions", "rows", projectId, sessionId] as const

const sessionInteractionRowsQueryOptions = (projectId: string, sessionId: string) => ({
    queryKey: sessionInteractionRowsQueryKey(projectId, sessionId),
    queryFn: async (): Promise<SessionInteraction[]> =>
        (await queryInteractions({sessionId, projectId})) ?? [],
    staleTime: SESSION_INTERACTION_ROWS_STALE_MS,
})

export interface SessionInteractionRowState {
    id?: string
    token: string
    turnId?: string
    status: SessionInteractionStatusCode
    kind: SessionInteractionKind
    resolution?: Record<string, unknown>
    toolCallId?: string
}

export type SessionInteractionRowStates = ReadonlyMap<string, SessionInteractionRowState>

export function interactionStatesFromRows(rows: SessionInteraction[]): SessionInteractionRowStates {
    const states = new Map<string, SessionInteractionRowState>()
    for (const row of rows) {
        if (typeof row.token !== "string" || !row.token) continue

        const toolCallId = row.data?.request?.tool_call_id
        states.set(row.token, {
            id: row.id ?? row.token,
            token: row.token,
            status: row.status as SessionInteractionStatusCode,
            kind: row.kind as SessionInteractionKind,
            ...(row.data?.resolution ? {resolution: row.data.resolution} : {}),
            ...(typeof toolCallId === "string" && toolCallId ? {toolCallId} : {}),
            ...(typeof row.turn_id === "string" && row.turn_id ? {turnId: row.turn_id} : {}),
        })
    }
    return states
}

/** Row states delivered by the session watch relay; undefined means the caller must refetch. */
export function interactionStatesFromWatchEvent(
    data: string,
    sessionId: string,
): SessionInteractionRowStates | undefined {
    try {
        const parsed = sessionInteractionWatchEventSchema.safeParse(JSON.parse(data))
        if (!parsed.success || parsed.data.session_id !== sessionId || !parsed.data.interactions)
            return undefined
        return interactionStatesFromRows(parsed.data.interactions)
    } catch {
        return undefined
    }
}

/**
 * Imperative, best-effort fetch through the shared query cache. Never throws — a failure (network,
 * missing project scope) resolves to an empty map, so a replay-join miss degrades to today's
 * behavior (still pending) rather than blocking the whole transcript from loading.
 */
export const fetchSessionInteractionStatesAtom = atom(
    null,
    async (get, _set, sessionId: string): Promise<SessionInteractionRowStates> => {
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId) return new Map()
        try {
            const client = get(queryClientAtom)
            const rows = await client.fetchQuery(
                sessionInteractionRowsQueryOptions(projectId, sessionId),
            )
            return interactionStatesFromRows(rows)
        } catch (err) {
            console.warn("[fetchSessionInteractionStatesAtom] fetch failed:", err)
            return new Map()
        }
    },
)

export const revalidateSessionInteractionsAtom = atom(
    null,
    async (get, _set, sessionId: string) => {
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId) return
        // Keep an initial rows fetch in flight while marking its cache entry stale.
        await get(queryClientAtom).invalidateQueries(
            {queryKey: sessionInteractionRowsQueryKey(projectId, sessionId)},
            {cancelRefetch: false},
        )
    },
)

/** A row whose lifecycle has ended; `pending` is the only other value the API returns. */
const isTerminalRow = (row: SessionInteractionRowState): boolean =>
    row.status === "responded" || row.status === "resolved" || row.status === "cancelled"

/**
 * Is any interaction still waiting on the user? Feeds `shouldAdoptServerTranscript`'s
 * `awaitingUser` guard (#5942) — positive evidence of a parked card, rather than the client
 * failing to recognise one.
 */
export const hasWaitingInteraction = (rows: SessionInteractionRowStates | undefined): boolean => {
    for (const row of rows?.values() ?? []) if (!isTerminalRow(row)) return true
    return false
}
