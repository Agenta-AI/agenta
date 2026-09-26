import {useCallback} from "react"

import {SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {useAtomValue, useStore} from "jotai"

/**
 * Sends the Save as template request through the chat's run-this-turn seam, in the CURRENT
 * session: the active conversation submits it like a typed message and never touches the
 * composer, so an unsent draft stays where it is. A new session would switch away from it.
 *
 * Only an unsent request disables it. While the agent runs, a second click queues a second
 * message behind the run, which is visible and removable like any queued message.
 */
export const useSaveAsTemplate = (entityId: string | null | undefined) => {
    const store = useStore()
    const pending = useAtomValue(simulatedAgentRunAtomFamily(entityId ?? "")) !== null

    const saveAsTemplate = useCallback((): boolean => {
        if (!entityId) return false
        const runAtom = simulatedAgentRunAtomFamily(entityId)
        // Read the store, not the render: a double click lands before the re-render.
        if (store.get(runAtom) !== null) return false
        store.set(runAtom, {text: SAVE_AS_TEMPLATE_MESSAGE, nonce: Date.now()})
        return true
    }, [entityId, store])

    return {saveAsTemplate, pending, disabled: !entityId || pending}
}
