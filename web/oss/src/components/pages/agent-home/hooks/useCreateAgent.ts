import {useCallback} from "react"

import {
    createEphemeralAppFromTemplate,
    createWorkflowFromEphemeralAtom,
    generateSlug,
} from "@agenta/entities/workflow"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {App} from "antd"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import {useRouter} from "next/router"

import {agentFirstRunSeedAtom} from "@/oss/components/AgentChatSlice/state/firstRunSeed"
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
 * caller (`onCommitted`). Mints an ephemeral (or commits a provided one), commits it (so it gets a
 * real app id + is classified as an agent), and stashes the first-run seed on the new revision.
 * Default flow navigates to `/apps/<id>/playground`; `onCommitted` lets onboarding commit in place.
 */
export function useCreateAgent() {
    const {message} = App.useApp()
    const router = useRouter()
    const store = useStore()
    const {baseAppURL} = useAtomValue(urlAtom)
    const commitFromEphemeral = useSetAtom(createWorkflowFromEphemeralAtom)

    return useCallback(
        async ({
            name,
            seedMessage,
            entityId,
            onCommitted,
            autoSendSeed,
        }: CreateAgentParams = {}) => {
            try {
                const agentName = name?.trim() || "New agent"
                const ephemeralId =
                    entityId ??
                    (await createEphemeralAppFromTemplate({
                        type: "agent",
                        defaultName: agentName,
                    }))
                if (!ephemeralId) {
                    message.error("Couldn't start agent creation — please retry")
                    return
                }

                // Slug must be unique per project — the drawer used to collect a user-typed name, so
                // without a unique suffix every create collides on the default slug ("agent").
                const uniqueSuffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296)
                    .toString(36)
                    .padStart(2, "0")}`
                const slug = `${generateSlug(agentName) || "agent"}-${uniqueSuffix}`
                const result = await commitFromEphemeral({
                    revisionId: ephemeralId,
                    name: agentName,
                    slug,
                })
                if (!result.success) {
                    message.error(extractApiErrorMessage(result.error))
                    return
                }

                const appId = result.workflow?.workflow_id ?? result.workflow?.id
                const revisionId = result.newRevisionId
                if (!appId || !revisionId) {
                    message.error(
                        "Agent created, but couldn't open its playground — find it under Agents",
                    )
                    return
                }

                if (seedMessage?.trim()) {
                    store.set(agentFirstRunSeedAtom, {
                        appId,
                        revisionId,
                        seedMessage: seedMessage.trim(),
                        autoSend: autoSendSeed,
                    })
                }

                if (onCommitted) {
                    console.log(
                        "%c[agent-onboarding]",
                        "color:#84cc16;font-weight:bold",
                        "useCreateAgent → IN-PLACE (onCommitted present)",
                        {appId, revisionId, name, seedMessage},
                    )
                    onCommitted({appId, revisionId})
                } else {
                    console.log(
                        "%c[agent-onboarding]",
                        "color:#f59e0b;font-weight:bold",
                        "useCreateAgent → REDIRECT (no onCommitted) router.push app playground",
                        {appId, revisionId, name, seedMessage},
                    )
                    void router.push(`${baseAppURL}/${appId}/playground?revisions=${revisionId}`)
                }
            } catch (error) {
                message.error(extractApiErrorMessage(error))
            }
        },
        [message, commitFromEphemeral, store, router, baseAppURL],
    )
}
