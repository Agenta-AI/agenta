import {useAtomValue} from "jotai"

import {sessionsLoadingAtom, sessionsSpansAtom} from "@/oss/state/newObservability/atoms/queries"

import {
    activeChatSessionAtom,
    activeChatSessionSummaryAtom,
    activeChatTurnAtom,
    chatSessionsAtom,
    chatSessionsQueryAtom,
    traceDrawerActiveSpanIdAtom,
    traceDrawerTraceIdAtom,
} from "../store/sessionDrawerStore"

export const useSessionDrawer = () => {
    const sessionId = useAtomValue(traceDrawerTraceIdAtom)
    const activeTurnId = useAtomValue(traceDrawerActiveSpanIdAtom)
    const sessionsQuery = useAtomValue(chatSessionsQueryAtom)
    const sessions = useAtomValue(chatSessionsAtom)
    const activeSession = useAtomValue(activeChatSessionAtom)
    const activeTurn = useAtomValue(activeChatTurnAtom)
    const sessionSummary = useAtomValue(activeChatSessionSummaryAtom)

    const spansMap = useAtomValue(sessionsSpansAtom)
    const sessionSpans = (sessionId && spansMap[sessionId]) || []
    const isLoading = useAtomValue(sessionsLoadingAtom)

    return {
        sessionId,
        activeTurnId,
        sessions,
        activeSession,
        activeTurn,
        sessionSummary,
        sessionSpans,
        isLoading,
        error: sessionsQuery.error,
    }
}

export default useSessionDrawer
