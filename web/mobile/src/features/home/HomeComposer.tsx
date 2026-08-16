import {useState} from "react"

import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import type {Workflow} from "@agenta/entities/workflow"
import {HomeTaskComposer, type HomeTaskComposerAgent} from "@agenta/home-ui"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {stashPendingTaskAtom} from "./pendingTask"

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
    const [sessionId] = useState(() => crypto.randomUUID())
    const attachments = useComposerAttachments({sessionId})

    const options: HomeTaskComposerAgent[] = agents.map((agent) => ({
        id: agent.id,
        name: agent.name || agent.slug || "Untitled agent",
    }))

    const start = async ({agentId, text}: {agentId: string; text: string}) => {
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        stash({sessionId, task: {agentId, text, parts}})
        attachments.clearAttachments(staged.map((file) => file.uid))
        await router.push(`${base}/sessions/${sessionId}?agent=${agentId}`)
    }

    return <HomeTaskComposer agents={options} attachments={attachments} onStart={start} />
}
