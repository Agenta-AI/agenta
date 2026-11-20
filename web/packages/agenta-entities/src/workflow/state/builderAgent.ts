/**
 * The builder: the platform agent every project has, served from the static catalog under one
 * reserved slug. This reads it by slug and puts it in the revision detail cache, where the
 * workflow molecule reads it by id like any other revision.
 */
import {projectIdAtom, sessionAtom, userAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {vaultSecretsQueryAtom} from "../../secret/state"
import {retrieveWorkflowRevision} from "../api"

import {ensureBuilderAgentModel} from "./builderAgentModel"
import {primeWorkflowRevisionDetailCacheImperative} from "./store"

export const BUILDER_AGENT_SLUG = "__ag__builder"

const BUILDER_AGENT_REVISION_KEY = ["workflows", "builder-agent-revision"] as const

/**
 * The builder's revision id in this project; null when the project has no builder. A project
 * commits the builder's model, and the revision it reads is the code version with that commit
 * on top. When it has no model yet, the first read commits the new-agent default
 * (`ensureBuilderAgentModel`), so both builder chats get it from this one place. The key holds
 * the number of project connections, so a connection added from the chat's "connect a model"
 * strip reads again and commits the default then.
 */
export const builderAgentRevisionIdQueryAtom = atomWithQuery<string | null>((get) => {
    const projectId = get(projectIdAtom)
    const userId = get(userAtom)?.id ?? null
    const vault = get(vaultSecretsQueryAtom)
    const connections = vault.data?.length ?? 0
    return {
        queryKey: [...BUILDER_AGENT_REVISION_KEY, projectId, connections],
        queryFn: async () => {
            if (!projectId || !userId) return null
            const read = await retrieveWorkflowRevision({
                projectId,
                workflowRef: {slug: BUILDER_AGENT_SLUG},
            })
            if (!read?.id) return null
            const revision = await ensureBuilderAgentModel({projectId, userId, revision: read})
            primeWorkflowRevisionDetailCacheImperative(revision, {projectId})
            return revision.id
        },
        // After the first connection read, so the first read does not run twice.
        enabled: get(sessionAtom) && !!projectId && !!userId && !vault.isLoading,
        // A new key keeps showing the last id while it reads again.
        placeholderData: (previous: string | null | undefined) => previous,
        // The code version changes only with a deploy; a commit invalidates it.
        staleTime: 5 * 60_000,
    }
})

/** Read the builder's revision again, after a commit of its fields. */
export function invalidateBuilderAgentRevisionCache(): void {
    try {
        getDefaultStore()
            .get(queryClientAtom)
            .invalidateQueries({queryKey: [...BUILDER_AGENT_REVISION_KEY]})
    } catch {
        // queryClientAtom may not be initialized yet
    }
}
