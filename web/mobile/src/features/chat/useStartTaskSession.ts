import {useCallback} from "react"

import {markSessionFresh} from "@agenta/chat/state"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {newId} from "@/lib/ids"

import {stashPendingTaskAtom, takePendingTaskAtom} from "../home/pendingTask"

/**
 * Start a session with an agent and SEND `text` as its first turn.
 *
 * The Home hand-off without the composer: mint the id, stash the task, land on the chat route,
 * which owns the engine and sends the task once it is ready (`pendingTasksAtom`). What
 * `useStartBlankSession` opens empty, this opens already running — an automation's test run
 * is a run, not a draft to read over first.
 *
 * Text only. Home and the agent composer stage attachments too, which is why they keep their
 * own copies of this hand-off; nothing here has a tray.
 */
export const useStartTaskSession = (base: string) => {
    const router = useRouter()
    const stash = useSetAtom(stashPendingTaskAtom)
    const dropPendingTask = useSetAtom(takePendingTaskAtom)
    return useCallback(
        async (agentId: string, text: string) => {
            const sessionId = newId()
            // Same as the rail's "+": a session minted here has no durable records yet.
            markSessionFresh(sessionId)
            stash({sessionId, task: {agentId, text}})
            // A cancelled navigation RESOLVES false rather than throwing, so both outcomes land
            // here — see `useHomeHandoff`.
            const navigated = await router
                .push(`${base}/sessions/${sessionId}?agent=${agentId}`)
                .catch(() => false)
            // The chat route never mounted, so drop the stash — otherwise the task replays the
            // next time this session id is opened.
            if (!navigated) dropPendingTask(sessionId)
        },
        [base, dropPendingTask, router, stash],
    )
}
