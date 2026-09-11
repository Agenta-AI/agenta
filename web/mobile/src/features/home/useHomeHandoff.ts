import {useCallback, useState} from "react"

import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import {markSessionFresh} from "@agenta/chat/state"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {newId} from "@/lib/ids"

import {useNewAgentAction} from "../agents/useNewAgentAction"

import {stashPendingTaskAtom, takePendingTaskAtom} from "./pendingTask"

/**
 * Home's verbs, bound to mobile's routing: mint the session id here, stash the task, and navigate
 * to the chat route that owns the conversation engine — the first send is what actually creates
 * the session server-side.
 *
 * The id is minted once per mount rather than per send so staged attachments have a stable scope
 * to upload against before the session exists. Creating an agent reuses that same id, so a file
 * staged before "+ New" was pressed still rides along.
 */
export const useHomeHandoff = (base: string) => {
    const router = useRouter()
    const stash = useSetAtom(stashPendingTaskAtom)
    const dropPendingTask = useSetAtom(takePendingTaskAtom)
    const newAgent = useNewAgentAction(base)
    const [sessionId] = useState(() => {
        const id = newId()
        // Same reason as the rail's "+": a session minted here has no durable records yet.
        markSessionFresh(id)
        return id
    })
    const attachments = useComposerAttachments({sessionId})
    // The task path navigates too, and the moment between send and the chat route mounting was
    // silent. On success the page unmounts, so this only ever has to come back down on failure.
    const [starting, setStarting] = useState(false)

    const stagedParts = useCallback(() => {
        const staged = attachments.files
        return {
            staged,
            parts: staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined,
        }
    }, [attachments.files, sessionId])

    const onStartTask = useCallback(
        async ({agentId, text}: {agentId: string; text: string}) => {
            const {staged, parts} = stagedParts()
            stash({sessionId, task: {agentId, text, parts}})
            setStarting(true)
            // A cancelled navigation RESOLVES false rather than throwing, so both outcomes have to
            // land here — the same hazard `useNewAgentAction` documents. Catching alone cleared the
            // attachments while the task sat unplayed in the stash.
            const navigated = await router
                .push(`${base}/sessions/${sessionId}?agent=${agentId}`)
                .catch(() => false)
            if (!navigated) {
                // The chat route never mounted, so drop the stash — otherwise the task replays the
                // next time this session id is opened. Attachments stay staged, still sendable.
                dropPendingTask(sessionId)
                setStarting(false)
                return
            }
            // Cleared only once the destination is committed to.
            attachments.clearAttachments(staged.map((file) => file.uid))
        },
        [attachments, base, dropPendingTask, router, sessionId, stagedParts, stash],
    )

    const onCreateFromPrompt = useCallback(
        async ({text, templateName}: {text: string; templateName?: string}) => {
            const {staged, parts} = stagedParts()
            const ok = await newAgent.createFromPrompt({
                text,
                sessionId,
                parts,
                // A template names the agent after itself; free text leaves the create core's
                // own default to name it from the task.
                name: templateName,
            })
            if (ok) {
                attachments.clearAttachments(staged.map((file) => file.uid))
                return
            }
            // The same channel the chat composer uses for a send that did not land: docked above
            // the input, dismissable, and the draft is still there. Without it a failed create
            // just stopped spinning and said nothing. Generic on purpose: `newAgent.error` here
            // is this closure's copy from before the failure, and would always read null.
            attachments.setRejections([{name: "Agent", reason: "couldn't be created — try again."}])
        },
        [attachments, newAgent, sessionId, stagedParts],
    )

    return {attachments, onStartTask, onCreateFromPrompt, sending: starting || newAgent.creating}
}
