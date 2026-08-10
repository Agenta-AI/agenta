import {useState} from "react"

import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import {HomeTaskComposer} from "@agenta/home-ui"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {dropPendingTaskAtom, stashPendingTaskAtom} from "../home/pendingTask"

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
    const drop = useSetAtom(dropPendingTaskAtom)
    const [sessionId] = useState(() => crypto.randomUUID())
    const attachments = useComposerAttachments({sessionId})

    const start = async ({text}: {agentId: string; text: string}) => {
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        stash({sessionId, task: {agentId, text, parts}})
        // Cleared BEFORE the navigation, not after: the chat screen's composer restores this
        // session's staged rows from the per-session store, so rows left here would come back as
        // a second copy of what the first turn already carries as reference parts.
        attachments.clearAttachments(staged.map((file) => file.uid))
        // A cancelled route change resolves `false`, a real failure rejects — and an unhandled
        // rejection here escapes the composer's submit handler. Either way the screen that would
        // have sent this never opened, so the stash comes back out (it would otherwise fire at
        // whoever opens that session id next) and the attachments go back in the tray instead of
        // disappearing with a message that was never sent.
        const navigated = await router
            .push(`${base}/sessions/${sessionId}?agent=${agentId}`)
            .catch(() => false)
        if (navigated) return
        drop(sessionId)
        attachments.restoreAttachments(staged)
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
