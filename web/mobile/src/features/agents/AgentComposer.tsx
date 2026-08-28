import {useState} from "react"

import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import {HomeTaskComposer} from "@agenta/home-ui"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {newId} from "@/lib/ids"

import {stashPendingTaskAtom, takePendingTaskAtom} from "../home/pendingTask"

/**
 * The agent overview's composer — Home's composer pinned to this agent (no picker: the route
 * already answers which agent). Same mint-stash-route mechanism as [[HomeComposer]]: the id is
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
        try {
            await router.push(`${base}/sessions/${sessionId}?agent=${agentId}`)
        } catch (error) {
            // The chat route never mounted, so drop the stash — otherwise the task replays the
            // next time this session id is opened. Attachments stay staged, still sendable.
            dropPendingTask(sessionId)
            console.error("[AgentComposer] could not open the session", error)
            return
        }
        // Cleared only once the destination is committed to.
        attachments.clearAttachments(staged.map((file) => file.uid))
    }

    return (
        <HomeTaskComposer
            agents={[{id: agentId, name: agentName}]}
            fixedAgentId={agentId}
            placeholder={`Ask ${agentName}… — starts a new session`}
            attachments={attachments}
            onStart={start}
        />
    )
}
