import {isSessionFresh} from "@agenta/chat/state"
import {useAtomValue} from "jotai"

import {useChatScopeKey} from "@/oss/components/AgentChatSlice/state/scope"
import {
    activeSessionIdAtomFamily,
    sessionsListAtomFamily,
} from "@/oss/components/AgentChatSlice/state/sessions"

/**
 * This app's answer to "which conversation's drive is the config panel showing?" — resolved the
 * same way the chat resolves it: a stale active id (closed tab) falls back to the first open tab,
 * and a brand-new never-run tab resolves to none so the queries stay held off.
 *
 * Lives here, not in the shared drive code: open chat TABS are a desktop concept. A
 * session-scoped surface passes its own id straight through instead.
 */
export const useChatScopeSessionId = (): string => {
    const scope = useChatScopeKey()
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    const resolved = sessions.some((s) => s.id === rawActiveId)
        ? rawActiveId
        : (sessions[0]?.id ?? "")
    return resolved && !isSessionFresh(resolved) ? resolved : ""
}
