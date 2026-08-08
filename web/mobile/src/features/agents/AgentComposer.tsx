import {useState} from "react"

import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import {HomeTaskComposer} from "@agenta/home-ui"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {stashPendingTaskAtom} from "../home/pendingTask"

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
    const [sessionId] = useState(() => crypto.randomUUID())
    const attachments = useComposerAttachments({sessionId})

    const start = async ({text}: {agentId: string; text: string}) => {
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        stash({sessionId, task: {agentId, text, parts}})
        attachments.clearAttachments(staged.map((file) => file.uid))
        await router.push(`${base}/sessions/${sessionId}?agent=${agentId}`)
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
