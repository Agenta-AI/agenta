import {useCallback} from "react"

import {useSetAtom} from "jotai"

import {useSessionActions} from "../hooks/useSessionActions"
import {useSessionShortcuts} from "../hooks/useSessionShortcuts"
import {type AgentChatSession, setActiveSessionAtomFamily} from "../state/sessions"
import {focusComposerRequestAtom, renameSessionRequestAtom} from "../state/uiRequests"

interface SessionShortcutsProps {
    scope: string
    /** Open sessions in tab order — Alt+N targets the Nth. */
    sessions: AgentChatSession[]
    activeId?: string
    enabled: boolean
}

/**
 * Keyboard verbs for the session strip: Alt+1…9 switches, Alt+R renames, Alt+A archives. Switch and
 * rename are carried out inside the per-session components (the composer's input handle, the tab
 * label's edit mode), so they travel as requests on the shared atoms.
 *
 * Renders nothing, and stays a component rather than a hook in the panel: `useSessionActions`
 * subscribes to the pinned set and the project id, and the panel rebuilds every conversation pane
 * on each render — a pin toggled in the sidebar would re-render the whole chat.
 */
const SessionShortcuts = ({scope, sessions, activeId, enabled}: SessionShortcutsProps) => {
    const {setArchived} = useSessionActions()
    const setActiveSession = useSetAtom(setActiveSessionAtomFamily(scope))
    const requestComposerFocus = useSetAtom(focusComposerRequestAtom)
    const requestRename = useSetAtom(renameSessionRequestAtom)

    const handleJump = useCallback(
        (id: string) => {
            setActiveSession(id)
            requestComposerFocus({scope, sessionId: id, nonce: Date.now()})
        },
        [scope, setActiveSession, requestComposerFocus],
    )
    const handleRename = useCallback(
        (id: string) => requestRename({scope, sessionId: id, nonce: Date.now()}),
        [scope, requestRename],
    )
    const handleArchive = useCallback(
        (id: string) => {
            const session = sessions.find((s) => s.id === id)
            if (!session) return
            void setArchived({
                sessionId: id,
                appId: scope,
                name: session.title,
                archived: Boolean(session.archived),
            })
        },
        [sessions, scope, setArchived],
    )

    useSessionShortcuts({
        sessions,
        activeId,
        enabled,
        onJump: handleJump,
        onRename: handleRename,
        onArchive: handleArchive,
    })

    return null
}

export default SessionShortcuts
