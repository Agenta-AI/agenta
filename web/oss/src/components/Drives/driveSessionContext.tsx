/**
 * Ambient session for drive components rendered deep inside a conversation (in-thread file
 * cards, the context rail) — the provider sits once per conversation so cards can enrich
 * themselves (size/type, download) without threading sessionId through the message tree.
 */
import {createContext, useContext, type ReactNode} from "react"

const DriveSessionContext = createContext<string | null>(null)

export function DriveSessionProvider({
    sessionId,
    children,
}: {
    sessionId: string
    children: ReactNode
}) {
    return <DriveSessionContext.Provider value={sessionId}>{children}</DriveSessionContext.Provider>
}

/** The enclosing conversation's session id; null outside a conversation. */
export const useDriveSessionId = (): string | null => useContext(DriveSessionContext)
