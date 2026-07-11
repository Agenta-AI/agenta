import {Typography} from "antd"
import {useAtomValue} from "jotai"

import MountsTab from "@/oss/components/SessionInspector/tabs/MountsTab"

import {useChatScopeKey} from "../state/scope"
import {activeSessionIdAtomFamily, sessionsListAtomFamily} from "../state/sessions"

/**
 * Body for the config panel's "Session drive" section: the ACTIVE conversation's durable files,
 * browsed with the same mount file browser the session panel uses. Lives in the app layer because
 * it reads the chat slice's session state (scope + active tab), which the entity-ui package
 * can't reach; the section slots it in via `AgentOperationsSections`' `sessionDrive` prop.
 */
const SessionDriveContent = () => {
    const scope = useChatScopeKey()
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    // Same fallback the chat uses: a stale active id (closed tab) resolves to the first open tab.
    const sessionId = sessions.some((s) => s.id === rawActiveId)
        ? rawActiveId
        : (sessions[0]?.id ?? "")

    if (!sessionId) {
        return (
            <Typography.Text type="secondary" className="text-xs">
                No conversation open — start a chat and its working files show up here.
            </Typography.Text>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <Typography.Text type="secondary" className="!text-[11px]">
                Files of the active conversation. New conversations get a drive on their first run.
            </Typography.Text>
            <MountsTab sessionId={sessionId} />
        </div>
    )
}

export default SessionDriveContent
