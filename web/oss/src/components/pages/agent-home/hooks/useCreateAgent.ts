import {useCallback} from "react"

import {useCreateAgent as useCreateAgentCore} from "@agenta/home-ui"
import {projectIdAtom} from "@agenta/shared/state"
import {App} from "antd"
import {useAtomValue, useStore} from "jotai"
import {useRouter} from "next/router"

import {addFirstRunSeedAtom} from "@/oss/components/AgentChatSlice/state/firstRunSeed"
import {registerCreatedAgent} from "@/oss/components/pages/agents/store"
import {urlAtom} from "@/oss/state/url"

interface CreateAgentParams {
    /** Agent name; defaults to the ephemeral factory's name when omitted. */
    name?: string
    /** Composer text / template seed — pre-fills the playground composer via the first-run seed. */
    seedMessage?: string
    /**
     * Commit THIS existing ephemeral (`local-*`) instead of minting a fresh one. Used by
     * playground-native onboarding, which already minted the ephemeral to render the shell.
     */
    entityId?: string
    /**
     * Called after a successful commit with the real ids INSTEAD of navigating to the app playground.
     * The caller then handles placement (e.g. an in-place `setEntityIds` + shallow URL update, no
     * redirect). Omit for the default `router.push` to `/apps/<id>/playground`.
     */
    onCommitted?: (ids: {appId: string; revisionId: string}) => void
    /** Mark the seed as an explicit "go" so the chat auto-sends it once the model is ready (no Start). */
    autoSendSeed?: boolean
}

/**
 * Create a new agent and either land in its playground (default) or hand the real ids back to the
 * caller (`onCommitted`).
 *
 * The mint + commit itself is the SHARED core (`@agenta/home-ui`), so every app creates an agent
 * the same way. What stays here is this app's: the roster-cache refresh, the first-run seed, and
 * the playground redirect.
 */
export function useCreateAgent() {
    const {message} = App.useApp()
    const router = useRouter()
    const store = useStore()
    const {baseAppURL} = useAtomValue(urlAtom)
    const projectId = useAtomValue(projectIdAtom)
    const createAgent = useCreateAgentCore({onError: (text) => message.error(text)})

    return useCallback(
        async ({
            name,
            seedMessage,
            entityId,
            onCommitted,
            autoSendSeed,
        }: CreateAgentParams = {}) => {
            const created = await createAgent({name, entityId})
            if (!created) return false

            const {appId, revisionId} = created

            // The commit only busts the entities-level workflows cache; the agents list (Home's
            // first-run decision + the agents table) is a separate query and would stay empty.
            // Scoped to this project so the row can't land in another project's cached list.
            if (projectId) {
                void registerCreatedAgent({
                    projectId,
                    workflowId: appId,
                    name: created.name,
                    createdAt: created.createdAt ?? null,
                    createdById: created.createdById ?? null,
                })
            }

            if (seedMessage?.trim()) {
                store.set(addFirstRunSeedAtom, {
                    appId,
                    revisionId,
                    seedMessage: seedMessage.trim(),
                    autoSend: autoSendSeed,
                })
            }

            if (onCommitted) {
                onCommitted({appId, revisionId})
            } else {
                void router.push(`${baseAppURL}/${appId}/playground?revisions=${revisionId}`)
            }
            return true
        },
        [createAgent, projectId, store, router, baseAppURL],
    )
}
