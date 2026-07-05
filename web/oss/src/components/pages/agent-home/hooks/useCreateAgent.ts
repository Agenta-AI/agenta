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
}

/**
 * Create a new agent app and land the user in its playground — no drawer. Creates the ephemeral,
 * commits it (so it gets a real app id + is classified as an agent), stashes the first-run seed on
 * the new revision, and navigates to `/apps/<id>/playground`. Everything else (connect-a-model, the
 * seed prompt, chat-to-build) is handled in the playground.
 */
export function useCreateAgent() {
    const {message} = App.useApp()
    const router = useRouter()
    const store = useStore()
    const {baseAppURL} = useAtomValue(urlAtom)
    const commitFromEphemeral = useSetAtom(createWorkflowFromEphemeralAtom)

    return useCallback(
        async ({name, seedMessage}: CreateAgentParams = {}) => {
            try {
                const agentName = name?.trim() || "New agent"
                const entityId = await createEphemeralAppFromTemplate({
                    type: "agent",
                    defaultName: agentName,
                })
                if (!entityId) {
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
                    revisionId: entityId,
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
                    })
                }

                void router.push(`${baseAppURL}/${appId}/playground?revisions=${revisionId}`)
            } catch (error) {
                message.error(extractApiErrorMessage(error))
            }
        },
        [message, commitFromEphemeral, store, router, baseAppURL],
    )
}
