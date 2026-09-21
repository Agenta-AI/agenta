import {useCallback, useState} from "react"

import {markSessionFresh} from "@agenta/chat/state"
import {
    agentTemplateByKey,
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
import {templateSetupDraftAtom} from "./templateSetupDraft"

/**
 * Create an agent from this app, over the SHARED mint+commit core — blank, seeded from a starter
 * template, or seeded from what the user typed on the first-run hero. One hook so every entry runs
 * the same create rather than three copies of it.
 *
 * Template entries first visit the existing setup surface. Its confirmed selection reaches the
 * loader before the server starts the first session. Ordinary creation keeps the pending-task
 * handoff used by the chat screen.
 */
export const useNewAgentAction = (base: string) => {
    const router = useRouter()
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const createAgent = useCreateAgent({onError: setError})
    const stashTask = useSetAtom(stashPendingTaskAtom)
    const dropTask = useSetAtom(takePendingTaskAtom)
    const setSetupDraft = useSetAtom(templateSetupDraftAtom)

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
            /** The starter template this create came from, carried to the session's connect step. */
            templateKey?: string
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
            // Template loading starts the first run server-side. Collect choices on the existing
            // setup screen BEFORE calling it; the live session is already too late for a gate.
            if (params?.templateKey && !params.entityId && !params.setup) {
                setSetupDraft({
                    base,
                    templateKey: params.templateKey,
                    text: params.seedMessage,
                    sessionId: params.sessionId,
                    parts: params.seedParts,
                })
                const navigated = await router
                    .push(`${base}/agents/new?template=${encodeURIComponent(params.templateKey)}`)
                    .catch(() => false)
                if (!navigated) setSetupDraft(null)
                return navigated
            }
            setCreating(true)
            setError(null)
            const template = params?.templateKey
                ? agentTemplateByKey(params.templateKey)
                : undefined
            const created = await createAgent({
                name: params?.name,
                entityId: params?.entityId,
                template,
                initialMessage: params?.seedMessage,
                setup: params?.setup,
            })
            if (!created) {
                setCreating(false)
                return false
            }

            const typed = params?.seedMessage?.trim() ?? ""
            const seed = params?.setup ? appendSetupPreamble(typed, params.setup) : typed
            const seedParts = params?.seedParts
            const seeded = isSeededCreate({seed, partCount: seedParts?.length ?? 0})
            const sessionId = created.sessionId ?? (seeded ? (params?.sessionId ?? newId()) : null)
            if (sessionId && !created.sessionId) {
                // The session does not exist server-side until its first turn — mint the id, stash
                // the instruction, and let the chat screen's engine send it once. Fresh-marked
                // (idempotent for a caller-minted id): without it the chat treats the id as an
                // EXISTING session and goes asking the server for history it doesn't have.
                markSessionFresh(sessionId)
                stashTask({
                    sessionId,
                    task: {
                        agentId: created.appId,
                        text: seed,
                        parts: seedParts,
                        templateKey: params?.templateKey,
                    },
                })
            }

            // A cancelled navigation RESOLVES false rather than throwing, so both outcomes have to
            // land here — otherwise the caller is told the hand-off worked and clears its draft.
            const navigated = await router
                .push(agentHandoffPath({base, appId: created.appId, sessionId}))
                .catch(() => false)
            // AFTER the navigation, deliberately: the agents list is a filtered view over the
            // workflows query, and Home's first-run surface flips to the overview the moment the
            // refetch lands — invalidating before the push raced the hand-off and could strand
            // the user on Home with the seed never sent (and the creator's error line unmounted).
            void invalidateWorkflowsListCache()
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
        [base, createAgent, creating, dropTask, router, setSetupDraft, stashTask],
    )

    const create = useCallback(() => void run(), [run])

    /**
     * A template pick opens the existing setup surface before the first run can start.
     */
    const createFromTemplate = useCallback(
        (templateKey: string) => {
            const template = agentTemplateByKey(templateKey)
            if (!template) return
            void run({name: template.name, templateKey})
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
            /** A template pick carries the template's name; a plain description carries none. */
            name?: string
            /** And its key, so the session can ask for the accounts the template declares. */
            templateKey?: string
            sessionId?: string
            parts?: FileUIPart[]
            setup?: AgentSetupSelection
            entityId?: string
        }) =>
            run({
                name: input.name,
                templateKey: input.templateKey,
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
