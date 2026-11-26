import {useEffect} from "react"

import {atom, useSetAtom} from "jotai"

/**
 * The session the page shows, or null off a session page. The session screen writes it; code in
 * the right panel (the builder's context chip) reads it here, so no session id is passed down into
 * the builder (design D6).
 */
export const pageSessionIdAtom = atom<string | null>(null)

/** Publishes the page session while the session screen is mounted. */
export const usePublishPageSessionId = (sessionId: string) => {
    const setPageSessionId = useSetAtom(pageSessionIdAtom)
    useEffect(() => {
        setPageSessionId(sessionId)
        // Only this mount's value is cleared: a newer session screen may have written its own.
        return () => setPageSessionId((current) => (current === sessionId ? null : current))
    }, [sessionId, setPageSessionId])
}
