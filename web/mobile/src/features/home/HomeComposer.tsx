import {useState} from "react"

import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import {markSessionFresh} from "@agenta/chat/state"
import type {Workflow} from "@agenta/entities/workflow"
import {HomeTaskComposer, type HomeTaskComposerAgent} from "@agenta/home-ui"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {stashPendingTaskAtom, takePendingTaskAtom} from "./pendingTask"

/**
 * Home's composer, bound to mobile's routing: mint the session id here, stash the task, and
 * navigate to the chat route that owns the conversation engine — the first send is what
 * actually creates the session server-side.
 *
 * The id is minted once per mount rather than per send so staged attachments have a stable
 * scope to upload against before the session exists.
 */
export const HomeComposer = ({
    agents,
    base,
}: {
    agents: Workflow[]
    /** `/w/:workspace/p/:project` */
    base: string
}) => {
    const router = useRouter()
    const stash = useSetAtom(stashPendingTaskAtom)
    const dropPendingTask = useSetAtom(takePendingTaskAtom)
    const [sessionId] = useState(() => {
        const id = crypto.randomUUID()
        // Same reason as the rail's "+": a session minted here has no durable records yet.
        markSessionFresh(id)
        return id
    })
    const attachments = useComposerAttachments({sessionId})

    const options: HomeTaskComposerAgent[] = agents.map((agent) => ({
        id: agent.id,
        name: agent.name || agent.slug || "Untitled agent",
    }))

    const start = async ({agentId, text}: {agentId: string; text: string}) => {
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        stash({sessionId, task: {agentId, text, parts}})
        try {
            await router.push(`${base}/sessions/${sessionId}?agent=${agentId}`)
        } catch (error) {
            // The chat route never mounted, so drop the stash — otherwise the task replays the
            // next time this session id is opened. Attachments stay staged, still sendable.
            dropPendingTask(sessionId)
            console.error("[HomeComposer] could not open the session", error)
            return
        }
        // Cleared only once the destination is committed to.
        attachments.clearAttachments(staged.map((file) => file.uid))
    }

    return <HomeTaskComposer agents={options} attachments={attachments} onStart={start} />
}
