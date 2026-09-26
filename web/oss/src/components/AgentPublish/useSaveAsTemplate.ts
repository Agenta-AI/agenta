import {useCallback} from "react"

import {sessionStatusAtomFamily} from "@agenta/chat/state"
import {SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {useAtomValue, useStore} from "jotai"

import {useChatScopeKey} from "@/oss/components/AgentChatSlice/state/scope"
import {activeSessionIdAtomFamily} from "@/oss/components/AgentChatSlice/state/sessions"

const isBusy = (status: string) => status === "running" || status === "awaiting"

/**
 * Sends the Save as template request through the chat's run-this-turn seam, in the CURRENT
 * session: the active conversation submits it like a typed message and never touches the
 * composer, so an unsent draft stays where it is. A new session would switch away from it.
 */
export const useSaveAsTemplate = (entityId: string | null | undefined) => {
    const store = useStore()
    const scope = useChatScopeKey()

    const pending = useAtomValue(simulatedAgentRunAtomFamily(entityId ?? "")) !== null
    const activeSessionId = useAtomValue(activeSessionIdAtomFamily(scope))
    const agentBusy = isBusy(useAtomValue(sessionStatusAtomFamily(activeSessionId)))

    const saveAsTemplate = useCallback((): boolean => {
        if (!entityId) return false
        const runAtom = simulatedAgentRunAtomFamily(entityId)
        // Read the store, not the render: a double click lands before the re-render.
        if (store.get(runAtom) !== null) return false
        const sessionId = store.get(activeSessionIdAtomFamily(scope))
        if (isBusy(store.get(sessionStatusAtomFamily(sessionId)))) return false
        store.set(runAtom, {text: SAVE_AS_TEMPLATE_MESSAGE, nonce: Date.now()})
        return true
    }, [entityId, scope, store])

    return {saveAsTemplate, pending, agentBusy, disabled: !entityId || pending || agentBusy}
}
