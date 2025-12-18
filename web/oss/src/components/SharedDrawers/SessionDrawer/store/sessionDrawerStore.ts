import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomWithImmer} from "jotai-immer"
import {atomWithQuery} from "jotai-tanstack-query"

import sessionsMock from "../assets/dummyChatSessions.json"

// ---------- Types ----------
interface ChatSessionTurn {
    turn_index: number
    user_message: {content: string; timestamp: string}
    assistant_message: {content: string; timestamp: string; finish_reason?: string}
    status: "success" | "error"
    latency_ms: number
    cost_usd: number
    usage: {prompt_tokens: number; completion_tokens: number; total_tokens: number}
    trace: Record<string, any>
    evaluations?: any[]
}

interface ChatSession {
    session_id: string
    title: string
    application: {id: string; slug: string}
    environment: string
    agent: {name: string; version: string; deployed_at: string}
    created_at: string
    ended_at: string
    summary: {
        traces_count: number
        messages_count: number
        duration_ms: number
        avg_latency_ms: number
        avg_tokens: number
        total_tokens: number
        avg_cost_usd: number
        total_cost_usd: number
        success_rate: number
    }
    participants: {
        user: {id: string; email: string}
        organization: {id: string; name: string; workspace: string}
    }
    turns: ChatSessionTurn[]
    aggregated_evaluator_metrics?: Record<string, any>
}

interface ChatSessionsResponse {
    sessions: ChatSession[]
}

// ---------- Drawer state ----------
export interface SessionDrawerState {
    open: boolean
    sessionId: string | null
    activeTurnId: number | null
}

const initialSessionDrawerState: SessionDrawerState = {
    open: false,
    sessionId: null,
    activeTurnId: null,
}

export const sessionDrawerAtom = atomWithImmer<SessionDrawerState>(initialSessionDrawerState)

export const isDrawerOpenAtom = atom((get) => get(sessionDrawerAtom).open)
export const traceDrawerTraceIdAtom = atom((get) => get(sessionDrawerAtom).sessionId)
export const traceDrawerActiveSpanIdAtom = atom((get) => get(sessionDrawerAtom).activeTurnId)

export const openSessionDrawerAtom = atom(
    null,
    (_get, set, payload: {traceId: string; activeSpanId?: number | null}) => {
        set(sessionDrawerAtom, (draft) => {
            draft.open = true
            draft.sessionId = payload.traceId
            draft.activeTurnId = payload.activeSpanId ?? null
        })
    },
)

export const closeSessionDrawerAtom = atom(null, (_get, set) => {
    set(sessionDrawerAtom, (draft) => {
        draft.open = false
    })
})

export const setTraceDrawerActiveSpanAtom = atom(null, (_get, set, activeTurnId: number | null) => {
    set(sessionDrawerAtom, (draft) => {
        draft.activeTurnId = activeTurnId
    })
})

export const setTraceDrawerTraceAtom = atom(
    null,
    (_get, set, payload: {traceId?: string; activeSpanId?: number | null} | null) => {
        const {traceId, activeSpanId} = payload || {}
        if (!traceId) return

        set(sessionDrawerAtom, (draft) => {
            draft.sessionId = traceId
            if (activeSpanId !== undefined) {
                draft.activeTurnId = activeSpanId
            } else {
                draft.activeTurnId = null
            }
        })
    },
)

// ---------- Data fetching (mocked) ----------
export const chatSessionsQueryAtom = atomWithQuery<ChatSessionsResponse>(() => ({
    queryKey: ["chat-sessions-mock"],
    refetchOnWindowFocus: false,
    queryFn: async () => {
        // Simulate async fetch so UI wiring later behaves like a real endpoint
        await new Promise((resolve) => setTimeout(resolve, 50))
        return sessionsMock as ChatSessionsResponse
    },
}))

export const chatSessionsAtom = atom<ChatSession[]>(
    (get) => get(chatSessionsQueryAtom).data?.sessions || [],
)

// Helper to get a session by id
export const chatSessionByIdAtom = atom<(id?: string | null) => ChatSession | undefined>((get) => {
    const sessions = get(chatSessionsAtom)
    return (id?: string | null) => sessions.find((s) => s.session_id === id)
})

// Currently selected/active session based on drawer state
export const activeChatSessionAtom = atom<ChatSession | undefined>((get) => {
    const sessionId = get(traceDrawerTraceIdAtom)
    const sessions = get(chatSessionsAtom)
    if (!sessions.length) return undefined
    return sessions.find((s) => s.session_id === sessionId) || sessions[0]
})

// Currently selected turn (message pair)
export const activeChatTurnAtom = atom<ChatSessionTurn | undefined>((get) => {
    const session = get(activeChatSessionAtom)
    if (!session) return undefined

    const activeTurnId = get(traceDrawerActiveSpanIdAtom)
    if (activeTurnId !== null && activeTurnId !== undefined) {
        return session.turns.find((t) => t.turn_index === activeTurnId)
    }
    return session.turns[session.turns.length - 1]
})

// Expose lightweight stats useful for header/summary UI
export const activeChatSessionSummaryAtom = atom((get) => {
    const session = get(activeChatSessionAtom)
    if (!session) return null
    return {
        title: session.title,
        sessionId: session.session_id,
        environment: session.environment,
        agent: session.agent,
        summary: session.summary,
        startedAt: session.created_at,
        endedAt: session.ended_at,
        participants: session.participants,
    }
})

// mutate visibility of annotations
export const isAnnotationVisibleAtom = atomWithStorage("chat-session-annotation-ui", true)
