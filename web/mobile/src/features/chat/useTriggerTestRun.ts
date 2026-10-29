import {useEffect, useRef} from "react"

import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"

import {useStartTaskSession} from "./useStartTaskSession"

/**
 * Consume a "Test run" from the shared automations section for the agent being built.
 *
 * The section publishes the run to `simulatedAgentRunAtomFamily`, keyed by the revision it
 * shows, and on the desktop the playground's chat panel picks it up. This surface has no
 * such panel, so without a reader here the menu item did nothing at all. A test run here is
 * the same hand-off the automation detail screen's Test run makes: a NEW session with the
 * agent, the run's text sent as its first turn.
 */
export const useTriggerTestRun = ({
    entityId,
    agentId,
    base,
}: {
    /** The revision the config pane shows — the key the section publishes under. */
    entityId: string | null
    /** The workflow id; the chat route resolves a revision id too, so this is the better key. */
    agentId?: string | null
    /** `/w/:workspace/p/:project` */
    base: string
}) => {
    const pendingRun = useAtomValue(simulatedAgentRunAtomFamily(entityId ?? ""))
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(entityId ?? ""))
    const startTask = useStartTaskSession(base)
    // Strict Mode replays the effect with the same request; the nonce keeps it to one session.
    const consumedNonceRef = useRef<number | null>(null)

    useEffect(() => {
        if (!entityId || !pendingRun) return
        if (consumedNonceRef.current === pendingRun.nonce) return
        consumedNonceRef.current = pendingRun.nonce
        setPendingRun(null)
        void startTask(agentId ?? entityId, pendingRun.text)
    }, [entityId, agentId, pendingRun, setPendingRun, startTask])
}
