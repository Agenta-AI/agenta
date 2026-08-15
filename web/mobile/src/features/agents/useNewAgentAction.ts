import {useCallback, useState} from "react"

import {
    agentTemplateByKey,
    agentTemplateSeed,
    invalidateWorkflowsListCache,
} from "@agenta/entities/workflow"
import {useCreateAgent} from "@agenta/home-ui"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {stashPendingTaskAtom, takePendingTaskAtom} from "../home/pendingTask"

/**
 * Create an agent from this app, over the SHARED mint+commit core — blank, or seeded from a
 * starter template. One hook so the hero button and the roster's "New agent" run the same create
 * rather than two copies of it.
 *
 * A template pick means what it means everywhere (`agentTemplateSeed`: the template's name, its
 * builder instruction). Only the DELIVERY is this app's: the desktop stashes a first-run seed and
 * lands in the playground, so here it stashes a pending task against a freshly minted session and
 * lands in the conversation that sends it — the same hand-off Home's composer uses.
 */
export const useNewAgentAction = (base: string) => {
    const router = useRouter()
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const createAgent = useCreateAgent({onError: setError})
    const stashTask = useSetAtom(stashPendingTaskAtom)
    const dropTask = useSetAtom(takePendingTaskAtom)

    const run = useCallback(
        async (params?: {name?: string; seedMessage?: string}) => {
            if (creating) return
            setCreating(true)
            setError(null)
            const created = await createAgent({name: params?.name})
            if (!created) {
                setCreating(false)
                return
            }
            // The agents list is a filtered view over the workflows list query; invalidate it or the
            // new agent is missing from the roster until something else refetches.
            void invalidateWorkflowsListCache()

            const seed = params?.seedMessage?.trim()
            const sessionId = seed ? crypto.randomUUID() : null
            if (sessionId) {
                // The session does not exist server-side until its first turn — mint the id, stash
                // the instruction, and let the chat screen's engine send it once.
                stashTask({sessionId, task: {agentId: created.appId, text: seed as string}})
            }

            try {
                await router.push(
                    sessionId
                        ? `${base}/sessions/${sessionId}?agent=${created.appId}`
                        : `${base}/agents/${created.appId}`,
                )
            } catch {
                // The agent exists; only the navigation failed. Release the latch, or the button
                // stays dead for the rest of the mount.
                if (sessionId) dropTask(sessionId)
                setError("Agent created, but couldn't open it — find it under Agents")
                setCreating(false)
            }
        },
        [base, createAgent, creating, dropTask, router, stashTask],
    )

    const create = useCallback(() => void run(), [run])

    const createFromTemplate = useCallback(
        (templateKey: string) => {
            const template = agentTemplateByKey(templateKey)
            if (!template) return
            void run(agentTemplateSeed(template))
        },
        [run],
    )

    return {create, createFromTemplate, creating, error}
}
