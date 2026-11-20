/**
 * The builder: the platform agent every project has, served from the static catalog under one
 * reserved slug. Its revision has no database row, so the batch revision query does not return
 * it; this reads it by slug and puts it in the revision detail cache, where the workflow molecule
 * reads it by id like any other revision.
 */
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atomWithQuery} from "jotai-tanstack-query"

import {retrieveWorkflowRevision} from "../api"

import {primeWorkflowRevisionDetailCacheImperative} from "./store"

export const BUILDER_AGENT_SLUG = "__ag__builder"

/** The builder's revision id in this project; null when the project has no builder. */
export const builderAgentRevisionIdQueryAtom = atomWithQuery<string | null>((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["workflows", "builder-agent-revision", projectId],
        queryFn: async () => {
            if (!projectId) return null
            const revision = await retrieveWorkflowRevision({
                projectId,
                workflowRef: {slug: BUILDER_AGENT_SLUG},
            })
            if (!revision?.id) return null
            primeWorkflowRevisionDetailCacheImperative(revision, {projectId})
            return revision.id
        },
        enabled: get(sessionAtom) && !!projectId,
        // The catalog revision changes only with a deploy.
        staleTime: 5 * 60_000,
    }
})
