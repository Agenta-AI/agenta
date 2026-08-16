import {useCallback, useRef} from "react"

import {
    createEphemeralAppFromTemplate,
    createWorkflowFromEphemeralAtom,
    generateSlug,
} from "@agenta/entities/workflow"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {useSetAtom} from "jotai"

export interface CreatedAgent {
    appId: string
    revisionId: string
    name: string
    createdAt?: string | null
    createdById?: string | null
}

export interface CreateAgentParams {
    /** Agent name; defaults to the ephemeral factory's own. */
    name?: string
    /**
     * Commit THIS existing ephemeral (`local-*`) instead of minting a fresh one. Used by
     * playground-native onboarding, which already minted the ephemeral to render the shell.
     */
    entityId?: string
}

export interface UseCreateAgentOptions {
    /** Surface the failure however the host does (antd message, a toast, an inline error). */
    onError?: (message: string) => void
}

/**
 * Mint an ephemeral agent, commit it, and hand back the real ids.
 *
 * The commit is what turns a `local-*` draft into an agent with an app id, so every create path
 * on every surface goes through it. What happens NEXT — refreshing a roster cache, stashing a
 * first-run seed, where to navigate — is the host's, and stays out of here.
 *
 * A re-entry latch protects every caller (home button, composer, template cards) from a rapid
 * double-click minting two agents; the UI-level disabled/loading guards don't cover every path.
 */
export const useCreateAgent = ({onError}: UseCreateAgentOptions = {}) => {
    const commitFromEphemeral = useSetAtom(createWorkflowFromEphemeralAtom)
    const inFlightRef = useRef(false)

    return useCallback(
        async ({name, entityId}: CreateAgentParams = {}): Promise<CreatedAgent | null> => {
            if (inFlightRef.current) return null
            inFlightRef.current = true
            try {
                const agentName = name?.trim() || "New agent"
                const ephemeralId =
                    entityId ??
                    (await createEphemeralAppFromTemplate({
                        type: "agent",
                        defaultName: agentName,
                    }))
                if (!ephemeralId) {
                    onError?.("Couldn't start agent creation — please retry")
                    return null
                }

                // Slug must be unique per project — the default slug ("agent") collides on every
                // create now that the name is no longer typed by the user.
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
                    onError?.(extractApiErrorMessage(result.error))
                    return null
                }

                const appId = result.workflow?.workflow_id ?? result.workflow?.id
                const revisionId = result.newRevisionId
                if (!appId || !revisionId) {
                    onError?.("Agent created, but couldn't open it — find it under Agents")
                    return null
                }

                return {
                    appId,
                    revisionId,
                    name: agentName,
                    createdAt: result.workflow?.created_at ?? null,
                    createdById: result.workflow?.created_by_id ?? null,
                }
            } catch (error) {
                onError?.(extractApiErrorMessage(error))
                return null
            } finally {
                inFlightRef.current = false
            }
        },
        [commitFromEphemeral, onError],
    )
}
