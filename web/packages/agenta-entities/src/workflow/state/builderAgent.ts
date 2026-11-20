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
 * whether the project has a connection, so the first connection, added from the chat's
 * "connect a model" strip, reads again and commits the default then. (Each form that adds a
 * connection would otherwise have to invalidate this query itself.) A read that finds a model
 * commits nothing; two reads that both commit end in one conflict, and the second one reads
 * the first's commit.
 */
export const builderAgentRevisionIdQueryAtom = atomWithQuery<string | null>((get) => {
    const projectId = get(projectIdAtom)
    const userId = get(userAtom)?.id ?? null
    const hasConnection = (get(vaultSecretsQueryAtom).data?.length ?? 0) > 0
    return {
        queryKey: [...BUILDER_AGENT_REVISION_KEY, projectId, hasConnection],
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
        enabled: get(sessionAtom) && !!projectId && !!userId,
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
