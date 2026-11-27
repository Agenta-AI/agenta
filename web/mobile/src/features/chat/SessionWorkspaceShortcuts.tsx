import {useCallback} from "react"

import type {SessionStream} from "@agenta/entities/session"
import {sharingKeys, type SessionSharingResponse} from "@agenta/entities/sharing"
import {useSessionActions} from "@agenta/sessions-ui"
import {getHostQueryClient} from "@agenta/shared/api"
import {useSessionShortcuts} from "@agenta/ui/shortcuts"

import {useAgentPanel} from "../agent-layout/agentPanelContext"

import {useLeaveSession} from "./useLeaveSession"
import {sessionHeaderKey} from "./useSessionHeader"
import {useStartBlankSession} from "./useStartBlankSession"

/**
 * The session shortcuts the header still offers: archive, new session and the two panel toggles.
 * The tab-strip shortcuts (jump, step, close, rename a tab) went with the strip.
 */
const NO_SESSIONS: {id: string}[] = []
const ignore = () => undefined
export const SessionWorkspaceShortcuts = ({
    agentId,
    sessionId,
    base,
    projectId,
}: {
    agentId: string | null
    sessionId: string
    base: string
    projectId: string
}) => {
    const panel = useAgentPanel()
    const startBlank = useStartBlankSession(base)
    // Archiving the session you are on has to move you off it.
    const sessionActions = useSessionActions({onRemoved: useLeaveSession(base)})
    // Read from the session row the screen already caches (it carries the reader's sharing
    // state), or from the Share dialog's read; not fetched here.
    const isNotOwner = useCallback(
        (id: string) => {
            const client = getHostQueryClient()
            const cached =
                client.getQueryData<SessionStream | null>(sessionHeaderKey(projectId, id))
                    ?.sharing ??
                client.getQueryData<SessionSharingResponse>(sharingKeys.session(id, projectId))
                    ?.sharing
            return Boolean(cached?.policy.owner_user_id) && cached?.my_role !== "owner"
        },
        [projectId],
    )
    useSessionShortcuts({
        sessions: NO_SESSIONS,
        activeId: sessionId,
        onJump: ignore,
        onRename: ignore,
        onArchive: useCallback(
            (id: string) => {
                // Archiving an owned chat is its owner's verb; the shortcut follows the menu.
                if (isNotOwner(id)) return
                void sessionActions.setArchived({
                    sessionId: id,
                    appId: agentId ?? null,
                    archived: false,
                })
            },
            [agentId, isNotOwner, sessionActions],
        ),
        onNewSession: useCallback(() => {
            if (agentId) startBlank(agentId)
        }, [agentId, startBlank]),
        onCloseSession: ignore,
        onSearch: ignore,
        onToggleConfigPanel: useCallback(() => void panel.toggle("configuration"), [panel]),
        onToggleFilesPane: useCallback(() => void panel.toggle("files"), [panel]),
    })
    return null
}
