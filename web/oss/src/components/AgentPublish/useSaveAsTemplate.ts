import {useCallback} from "react"

import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {useAtomValue, useStore} from "jotai"

/**
 * Sends a template request (save as a zip, or share in the marketplace) through the chat's
 * run-this-turn seam, in the CURRENT session: the active conversation submits it like a typed
 * message and never touches the composer, so an unsent draft stays where it is. A new session
 * would switch away from it.
 *
 * Only an unsent request disables it. While the agent runs, a second request queues behind the
 * run, which is visible and removable like any queued message.
 */
export const useSaveAsTemplate = (entityId: string | null | undefined) => {
    const store = useStore()
    const pending = useAtomValue(simulatedAgentRunAtomFamily(entityId ?? "")) !== null

    const sendTemplateRequest = useCallback(
        (text: string): boolean => {
            if (!entityId) return false
            const runAtom = simulatedAgentRunAtomFamily(entityId)
            // Read the store, not the render: a double click lands before the re-render.
            if (store.get(runAtom) !== null) return false
            store.set(runAtom, {text, nonce: Date.now()})
            return true
        },
        [entityId, store],
    )

    return {sendTemplateRequest, pending, disabled: !entityId || pending}
}
