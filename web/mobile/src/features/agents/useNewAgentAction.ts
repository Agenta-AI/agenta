import {useCallback, useState} from "react"

import {
    agentTemplateByKey,
    agentTemplateSeed,
    invalidateWorkflowsListCache,
} from "@agenta/entities/workflow"
import {useCreateAgent} from "@agenta/home-ui"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {stashPendingTaskAtom} from "../home/pendingTask"

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

    const run = useCallback(
        async (params?: {name?: string; seedMessage?: string}) => {
            if (creating) return
            setCreating(true)
            setError(null)
            // Every exit from here has to clear `creating` — a rejected create, or a navigation
            // that never lands, would otherwise leave the button spinning with no way back.
            try {
                const created = await createAgent({name: params?.name})
                if (!created) return
                // The agents list is a filtered view over the workflows list query; invalidate it
                // or the new agent is missing from the roster until something else refetches.
                void invalidateWorkflowsListCache()

                const seed = params?.seedMessage?.trim()
                let target = `${base}/agents/${created.appId}`
                if (seed) {
                    // The session does not exist server-side until its first turn — mint the id,
                    // stash the instruction, and let the chat screen's engine send it once.
                    const sessionId = crypto.randomUUID()
                    stashTask({sessionId, task: {agentId: created.appId, text: seed}})
                    target = `${base}/sessions/${sessionId}?agent=${created.appId}`
                }
                // `router.push` resolves false on a cancelled route change and rejects on a real
                // navigation failure; either way the agent EXISTS, so say so rather than looking
                // like the create failed.
                const opened = await router.push(target).then(
                    (ok) => ok,
                    () => false,
                )
                if (!opened) {
                    setError("The agent was created, but opening it failed. Find it in the roster.")
                }
            } catch (error_) {
                setError(error_ instanceof Error ? error_.message : "Could not create the agent.")
            } finally {
                setCreating(false)
            }
        },
        [base, createAgent, creating, router, stashTask],
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
