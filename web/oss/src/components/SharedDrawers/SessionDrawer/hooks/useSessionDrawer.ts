import {useAtomValue} from "jotai"

import {
    isSessionDrawerLoadingAtom,
    sessionAnnotatedTracesAtom,
    sessionDrawerActiveSpanIdAtom,
    sessionDrawerSessionIdAtom,
    sessionStatsAtom,
} from "../store/sessionDrawerStore"

export const useSessionDrawer = () => {
    const sessionId = useAtomValue(sessionDrawerSessionIdAtom)
    const activeSpanId = useAtomValue(sessionDrawerActiveSpanIdAtom)
    const sessionTraces = useAtomValue(sessionAnnotatedTracesAtom)
    const isLoading = useAtomValue(isSessionDrawerLoadingAtom)
    const aggregatedStats = useAtomValue(sessionStatsAtom)

    return {
        sessionId,
        activeSpanId,
        sessionTraces,
        isLoading,
        aggregatedStats,
    }
}

export default useSessionDrawer
