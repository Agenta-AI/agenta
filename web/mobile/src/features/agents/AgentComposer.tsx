import {useState} from "react"

import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import {HomeTaskComposer} from "@agenta/home-ui"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {newId} from "@/lib/ids"

import {stashPendingTaskAtom, takePendingTaskAtom} from "../home/pendingTask"

/**
 * The agent overview's composer — Home's composer pinned to this agent (no picker: the route
 * already answers which agent). Same mint-stash-route mechanism as [[useHomeHandoff]]: the id is
 * minted once per mount so staged attachments have a stable scope before the session exists,
 * and the first send is what actually creates it server-side.
 */
export const AgentComposer = ({
    agentId,
    agentName,
    base,
}: {
    agentId: string
    agentName: string
    /** `/w/:workspace/p/:project` */
    base: string
}) => {
    const router = useRouter()
    const stash = useSetAtom(stashPendingTaskAtom)
    const dropPendingTask = useSetAtom(takePendingTaskAtom)
    const [sessionId] = useState(() => newId())
    const attachments = useComposerAttachments({sessionId})

    const start = async ({text}: {agentId: string; text: string}) => {
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        stash({sessionId, task: {agentId, text, parts}})
        // Cleared BEFORE the navigation — the chat route seeds its own tray from the per-session
        // store on mount, which `router.push` resolves after (see [[useHomeHandoff]], #6777).
        attachments.clearAttachments(staged.map((file) => file.uid))
        // A cancelled navigation RESOLVES false rather than throwing, so both outcomes land here.
        const navigated = await router
            .push(`${base}/sessions/${sessionId}?agent=${agentId}`)
            .catch((error: unknown) => {
                console.error("[AgentComposer] could not open the session", error)
                return false
            })
        if (!navigated) {
            // The chat route never mounted, so drop the stash — otherwise the task replays the
            // next time this session id is opened. The attachments go back, still sendable.
            dropPendingTask(sessionId)
            attachments.restoreAttachments(staged)
        }
    }

    return (
        <HomeTaskComposer
            fixedAgentId={agentId}
            attachments={attachments}
            onStart={start}
            // Home's composer, mic and all — this is the same start-a-session control.
            voice
        />
    )
}
