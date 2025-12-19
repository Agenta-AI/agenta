import {useAtomValue} from "jotai"

import {
    isSessionDrawerLoadingAtom,
    sessionAnnotatedTracesAtom,
    sessionDrawerActiveSpanIdAtom,
    sessionDrawerSessionIdAtom,
} from "../store/sessionDrawerStore"

export const useSessionDrawer = () => {
    const sessionId = useAtomValue(sessionDrawerSessionIdAtom)
    const activeSpanId = useAtomValue(sessionDrawerActiveSpanIdAtom)
    const sessionTraces = useAtomValue(sessionAnnotatedTracesAtom)
    const isLoading = useAtomValue(isSessionDrawerLoadingAtom)

    return {
        sessionId,
        activeSpanId,
        sessionTraces,
        isLoading,
    }
}

export default useSessionDrawer
