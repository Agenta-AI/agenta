import {useAtomValue} from "jotai"

import {
    activeChatSessionAtom,
    activeChatSessionSummaryAtom,
    activeChatTurnAtom,
    chatSessionsAtom,
    chatSessionsQueryAtom,
    traceDrawerActiveSpanIdAtom,
    traceDrawerTraceIdAtom,
} from "@/oss/components/SharedDrawers/SessionDrawer/store/sessionDrawerStore"

export const useSessionDrawer = () => {
    const sessionId = useAtomValue(traceDrawerTraceIdAtom)
    const activeTurnId = useAtomValue(traceDrawerActiveSpanIdAtom)
    const sessionsQuery = useAtomValue(chatSessionsQueryAtom)
    const sessions = useAtomValue(chatSessionsAtom)
    const activeSession = useAtomValue(activeChatSessionAtom)
    const activeTurn = useAtomValue(activeChatTurnAtom)
    const sessionSummary = useAtomValue(activeChatSessionSummaryAtom)

    return {
        sessionId,
        activeTurnId,
        sessions,
        activeSession,
        activeTurn,
        sessionSummary,
        isLoading: Boolean(sessionsQuery.isLoading),
        error: sessionsQuery.error,
    }
}

export default useSessionDrawer
