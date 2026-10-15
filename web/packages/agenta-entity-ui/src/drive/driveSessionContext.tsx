/**
 * Ambient session for drive components rendered deep inside a conversation (in-thread file
 * cards, the context rail) — the provider sits once per conversation so cards can enrich
 * themselves (size/type, download) without threading sessionId through the message tree. Also
 * carries the conversation's `artifactId` so the drive can fold in the agent's durable mount
 * (nested as `agent-files/`), which is keyed by artifact, not session.
 */
import {createContext, useCallback, useContext, useMemo, type ReactNode} from "react"

import {fileOrigin} from "@agenta/entities/drive"

/** A template zip in the session's own files; the host opens its create-from-template flow. */
export type CreateAgentFromTemplateFile = (file: {sessionId: string; path: string}) => void

interface DriveSession {
    sessionId: string | null
    artifactId: string | null
    onCreateAgentFromTemplate?: CreateAgentFromTemplateFile
}

const DriveSessionContext = createContext<DriveSession>({sessionId: null, artifactId: null})

export function DriveSessionProvider({
    sessionId,
    artifactId = null,
    onCreateAgentFromTemplate,
    children,
}: {
    sessionId: string
    artifactId?: string | null
    /** Offer "Create agent from template" on .zip files; the host owns the navigation. */
    onCreateAgentFromTemplate?: CreateAgentFromTemplateFile
    children: ReactNode
}) {
    const value = useMemo(
        () => ({sessionId, artifactId, onCreateAgentFromTemplate}),
        [sessionId, artifactId, onCreateAgentFromTemplate],
    )
    return <DriveSessionContext.Provider value={value}>{children}</DriveSessionContext.Provider>
}

/** The enclosing conversation's session id; null outside a conversation. */
export const useDriveSessionId = (): string | null => useContext(DriveSessionContext).sessionId

/** The enclosing conversation's artifact (workflow) id — for the agent's durable `agent-files`
 * mount; null outside a conversation. */
export const useDriveArtifactId = (): string | null => useContext(DriveSessionContext).artifactId

/** Create an agent from this session-file zip (the loader can't read `agent-files/`), else null. */
export const useCreateAgentFromTemplate = (path: string, isFolder = false): (() => void) | null => {
    const {sessionId, onCreateAgentFromTemplate} = useContext(DriveSessionContext)
    const eligible =
        Boolean(sessionId && onCreateAgentFromTemplate) &&
        !isFolder &&
        path.toLowerCase().endsWith(".zip") &&
        fileOrigin(path) === "session"
    const run = useCallback(() => {
        if (sessionId) onCreateAgentFromTemplate?.({sessionId, path: path.replace(/^\/+/, "")})
    }, [onCreateAgentFromTemplate, path, sessionId])
    return eligible ? run : null
}
