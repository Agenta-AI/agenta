import {useCallback, useState} from "react"

import {
    agentTemplateByKey,
    agentTemplateSeed,
    appendSetupPreamble,
    invalidateWorkflowsListCache,
    type AgentSetupSelection,
} from "@agenta/entities/workflow"
import {useCreateAgent} from "@agenta/home-ui"
import type {FileUIPart} from "ai"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {newId} from "@/lib/ids"

import {stashPendingTaskAtom, takePendingTaskAtom} from "../home/pendingTask"

import {agentHandoffPath, isSeededCreate} from "./agentHandoff"

/**
 * Create an agent from this app, over the SHARED mint+commit core — blank, seeded from a starter
 * template, or seeded from what the user typed on the first-run hero. One hook so every entry runs
 * the same create rather than three copies of it.
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
        async (params?: {
            name?: string
            seedMessage?: string
            /**
             * A session id the caller already minted, because it needed a stable scope to stage
             * attachments against before the agent existed. Without one, a seed mints its own.
             */
            sessionId?: string
            seedParts?: FileUIPart[]
            /**
             * What the pre-create connect step decided (#6043) — which accounts are connected,
             * which were skipped, how much the agent may do. Rides along on the seed so the
             * builder knows; see `appendSetupPreamble`. Absent when the step didn't run.
             */
            setup?: AgentSetupSelection
            /**
             * Commit THIS already-minted ephemeral instead of minting a fresh one — first run
             * configures the agent before it exists (see `useEphemeralAgent`), so the entity the
             * user has been editing is the one that must be committed.
             */
            entityId?: string
        }): Promise<boolean> => {
            if (creating) return false
            setCreating(true)
            setError(null)
            const created = await createAgent({name: params?.name, entityId: params?.entityId})
            if (!created) {
                setCreating(false)
                return false
            }
            // The agents list is a filtered view over the workflows list query; invalidate it or the
            // new agent is missing from the roster until something else refetches.
            void invalidateWorkflowsListCache()

            const typed = params?.seedMessage?.trim() ?? ""
            const seed = params?.setup ? appendSetupPreamble(typed, params.setup) : typed
            const seedParts = params?.seedParts
            const seeded = isSeededCreate({seed, partCount: seedParts?.length ?? 0})
            const sessionId = seeded ? (params?.sessionId ?? newId()) : null
            if (sessionId) {
                // The session does not exist server-side until its first turn — mint the id, stash
                // the instruction, and let the chat screen's engine send it once.
                stashTask({
                    sessionId,
                    task: {agentId: created.appId, text: seed, parts: seedParts},
                })
            }

            // A cancelled navigation RESOLVES false rather than throwing, so both outcomes have to
            // land here — otherwise the caller is told the hand-off worked and clears its draft.
            const navigated = await router
                .push(agentHandoffPath({base, appId: created.appId, sessionId}))
                .catch(() => false)
            if (!navigated) {
                // The agent exists; only the navigation failed. Release the latch, or the button
                // stays dead for the rest of the mount.
                if (sessionId) dropTask(sessionId)
                setError("Agent created, but couldn't open it — find it under Agents")
                setCreating(false)
                return false
            }
            return true
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

    /**
     * The first-run hero's submit: what the user typed IS the agent's first instruction. The name
     * is left to the create core's own default ("New agent"), the same default desktop onboarding
     * mints its ephemeral with — naming from the prompt is the agent's job, not the composer's.
     */
    const createFromPrompt = useCallback(
        (input: {
            text: string
            sessionId?: string
            parts?: FileUIPart[]
            setup?: AgentSetupSelection
            entityId?: string
        }) =>
            run({
                seedMessage: input.text,
                sessionId: input.sessionId,
                seedParts: input.parts,
                setup: input.setup,
                entityId: input.entityId,
            }),
        [run],
    )

    return {create, createFromTemplate, createFromPrompt, creating, error}
}
