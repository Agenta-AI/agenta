/**
 * The builder: the platform agent every project has, served from the static catalog under one
 * reserved slug. This reads it by slug and puts it in the revision detail cache, where the
 * workflow molecule reads it by id like any other revision.
 */
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom, getDefaultStore} from "jotai"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {resolveAgentModelSelection} from "../../secret/core"
import {retrieveWorkflowRevision} from "../api"

import {agentCreationPrefsAtom, selectionFromAgentCreationPrefs} from "./agentCreationPrefs"
import {agentModelCandidatesAtomFamily} from "./agentModelCandidates"
import {builderRevisionHasModel, commitBuilderDefaultModel} from "./builderAgentModel"
import {primeWorkflowRevisionDetailCacheImperative, workflowQueryAtomFamily} from "./store"

export const BUILDER_AGENT_SLUG = "__ag__builder"

const BUILDER_AGENT_REVISION_KEY = ["workflows", "builder-agent-revision"] as const

/** The builder's revision id in this project, read at once; null when there is no builder. */
const builderAgentRevisionBaseQueryAtom = atomWithQuery<string | null>((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: [...BUILDER_AGENT_REVISION_KEY, projectId],
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
        // The code version changes only with a deploy; a commit invalidates it.
        staleTime: 5 * 60_000,
    }
})

/**
 * The new-agent default model for a builder that has none, committed once in the background.
 *
 * It never holds up the builder: the model sources (connections, built-in models, subscription
 * sign-ins) are read only while the loaded builder has no model, and the commit runs only once
 * they have answered with a model the rule may pick. A source that fails means no pick, so
 * nothing is committed. After a commit, or a conflict with someone else's, the builder is read
 * again.
 */
const builderAgentDefaultModelQueryAtom = atomWithQuery<boolean>((get) => {
    const projectId = get(projectIdAtom)
    const revisionId = get(builderAgentRevisionBaseQueryAtom).data ?? null
    const revision = revisionId ? (get(workflowQueryAtomFamily(revisionId)).data ?? null) : null
    const needsModel = !!revision && !builderRevisionHasModel(revision)
    const candidates = needsModel ? get(agentModelCandidatesAtomFamily(true)) : null
    const selection =
        candidates?.status === "ready"
            ? resolveAgentModelSelection({
                  candidates: candidates.candidates,
                  last: selectionFromAgentCreationPrefs(get(agentCreationPrefsAtom)),
              })
            : null
    return {
        queryKey: [
            "workflows",
            "builder-agent-default-model",
            projectId,
            revisionId,
            selection?.connectionKey ?? null,
            selection?.modelId ?? null,
        ],
        queryFn: async () => {
            if (!projectId || !revision || !selection) return false
            const changed = await commitBuilderDefaultModel({projectId, revision, selection})
            if (changed) invalidateBuilderAgentRevisionCache()
            return changed
        },
        enabled: !!projectId && !!selection,
        retry: false,
        staleTime: Infinity,
    }
})

/**
 * The builder's revision id in this project; null when the project has no builder. A project
 * commits the builder's model, and the revision it reads is the code version with that commit
 * on top. Reading this also runs the background default-model commit, so both builder chats get
 * it from this one place.
 */
export const builderAgentRevisionIdQueryAtom = atom((get) => {
    get(builderAgentDefaultModelQueryAtom)
    return get(builderAgentRevisionBaseQueryAtom)
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
