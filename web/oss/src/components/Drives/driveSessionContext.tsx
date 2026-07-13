/**
 * Ambient session for drive components rendered deep inside a conversation (in-thread file
 * cards, the context rail) — the provider sits once per conversation so cards can enrich
 * themselves (size/type, download) without threading sessionId through the message tree. Also
 * carries the conversation's `artifactId` so the drive can fold in the agent's durable mount
 * (nested as `agent-files/`), which is keyed by artifact, not session.
 */
import {createContext, useContext, useMemo, type ReactNode} from "react"

interface DriveSession {
    sessionId: string | null
    artifactId: string | null
}

const DriveSessionContext = createContext<DriveSession>({sessionId: null, artifactId: null})

export function DriveSessionProvider({
    sessionId,
    artifactId = null,
    children,
}: {
    sessionId: string
    artifactId?: string | null
    children: ReactNode
}) {
    const value = useMemo(() => ({sessionId, artifactId}), [sessionId, artifactId])
    return <DriveSessionContext.Provider value={value}>{children}</DriveSessionContext.Provider>
}

/** The enclosing conversation's session id; null outside a conversation. */
export const useDriveSessionId = (): string | null => useContext(DriveSessionContext).sessionId

/** The enclosing conversation's artifact (workflow) id — for the agent's durable `agent-files`
 * mount; null outside a conversation. */
export const useDriveArtifactId = (): string | null => useContext(DriveSessionContext).artifactId
