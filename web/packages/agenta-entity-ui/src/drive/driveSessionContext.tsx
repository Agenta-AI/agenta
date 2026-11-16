/**
 * Ambient session for drive components rendered deep inside a conversation (in-thread file
 * cards, the context rail) — the provider sits once per conversation so cards can enrich
 * themselves (size/type, download) without threading sessionId through the message tree. Also
 * carries the conversation's `artifactId` so the drive can fold in the agent's durable mount
 * (nested as `agent-files/`), which is keyed by artifact, not session.
 */
import {createContext, useContext, useMemo, type ReactNode} from "react"

import {projectDrivesAtomFamily, type ProjectDrive} from "@agenta/entities/drive"
import {useAtomValue} from "jotai"

interface DriveSession {
    sessionId: string | null
    artifactId: string | null
    revisionId: string | null
}

const DriveSessionContext = createContext<DriveSession>({
    sessionId: null,
    artifactId: null,
    revisionId: null,
})

export function DriveSessionProvider({
    sessionId,
    artifactId = null,
    revisionId = null,
    children,
}: {
    sessionId: string
    artifactId?: string | null
    /** The revision the conversation runs; its `drives` list names the project drives. */
    revisionId?: string | null
    children: ReactNode
}) {
    const value = useMemo(
        () => ({sessionId, artifactId, revisionId}),
        [sessionId, artifactId, revisionId],
    )
    return <DriveSessionContext.Provider value={value}>{children}</DriveSessionContext.Provider>
}

/** The enclosing conversation's session id; null outside a conversation. */
export const useDriveSessionId = (): string | null => useContext(DriveSessionContext).sessionId

/** The enclosing conversation's artifact (workflow) id — for the agent's durable `agent-files`
 * mount; null outside a conversation. */
export const useDriveArtifactId = (): string | null => useContext(DriveSessionContext).artifactId

/** The enclosing conversation's revision id — for the project drives (`drives/<slug>/`) its
 * configuration names; null outside a conversation. */
export const useDriveRevisionId = (): string | null => useContext(DriveSessionContext).revisionId

/** The enclosing conversation's project drives (none outside a conversation) — which `drives/<slug>`
 * paths are project paths rather than session files. */
export const useDriveProjectDrives = (): ProjectDrive[] =>
    useAtomValue(projectDrivesAtomFamily(useDriveRevisionId() ?? ""))
