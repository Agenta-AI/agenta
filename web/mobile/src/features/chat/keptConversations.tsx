import {Activity, useRef, type ReactElement} from "react"

/** How many conversations stay mounted: the open one and the last ones the person left. */
export const KEPT_CONVERSATIONS = 3

/**
 * The open conversation and the last ones the person left, newest last. A return to a kept one
 * shows it at once: its transcript, composer text and scroll position were never torn down.
 *
 * Each entry keeps the element it last rendered with. The order is recorded on render; recording
 * the same session twice moves nothing, so a repeated render stays the same.
 */
export const useKeptConversations = (
    sessionId: string,
    element: ReactElement | null,
): {sessionId: string; element: ReactElement}[] => {
    const kept = useRef(new Map<string, ReactElement>())
    if (element) {
        kept.current.delete(sessionId)
        kept.current.set(sessionId, element)
        while (kept.current.size > KEPT_CONVERSATIONS) {
            const oldest = kept.current.keys().next().value as string
            kept.current.delete(oldest)
        }
    }
    return [...kept.current].map(([id, kept]) => ({sessionId: id, element: kept}))
}

/**
 * Renders the kept conversations. Only the open one is visible. A hidden one keeps its state but
 * React runs none of its effects and renders it only when nothing else waits, so a hidden stream
 * does not take the screen's frames.
 */
export const KeptConversations = ({
    sessionId,
    kept,
}: {
    sessionId: string
    kept: {sessionId: string; element: ReactElement}[]
}) => (
    <>
        {/* The open one first, so a page query for the conversation finds the one on screen. */}
        {[...kept]
            .sort((a, b) => Number(b.sessionId === sessionId) - Number(a.sessionId === sessionId))
            .map((entry) => (
                <Activity
                    key={entry.sessionId}
                    mode={entry.sessionId === sessionId ? "visible" : "hidden"}
                >
                    {entry.element}
                </Activity>
            ))}
    </>
)
