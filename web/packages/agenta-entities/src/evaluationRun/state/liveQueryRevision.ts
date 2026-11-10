/**
 * The stored query of a live evaluation, one revision per atom, every revision asked for in one
 * frame in one request.
 *
 * @packageDocumentation
 */

import {projectIdAtom} from "@agenta/shared/state"
import {createBatchFetcher} from "@agenta/shared/utils"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryLiveQueryRevisions, type LiveQueryRevision} from "../api/queryRevisions"

const liveQueryRevisionBatchFetcher = createBatchFetcher<
    {projectId: string; revisionId: string},
    LiveQueryRevision | null
>({
    serializeKey: ({projectId, revisionId}) => `${projectId}:${revisionId}`,
    batchFn: async (keys, serializedKeys) => {
        const projectId = keys[0].projectId
        if (keys.some((key) => key.projectId !== projectId)) {
            throw new Error("liveQueryRevisionBatchFetcher: requests span multiple projects")
        }
        const revisions = await queryLiveQueryRevisions({
            projectId,
            revisionIds: [...new Set(keys.map((key) => key.revisionId))],
        })
        const byId = new Map(revisions.map((revision) => [revision.id, revision]))
        const results = new Map<string, LiveQueryRevision | null>()
        keys.forEach((key, index) =>
            results.set(serializedKeys[index], byId.get(key.revisionId) ?? null),
        )
        return results
    },
})

export const liveQueryRevisionQueryKey = (projectId: string, revisionId: string) =>
    ["live-query-revision", projectId, revisionId] as const

/** A query revision by id. A revision never changes, so it is read once. */
export const liveQueryRevisionQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: liveQueryRevisionQueryKey(projectId ?? "", revisionId),
            queryFn: async (): Promise<LiveQueryRevision | null> =>
                projectId ? liveQueryRevisionBatchFetcher({projectId, revisionId}) : null,
            enabled: Boolean(projectId && revisionId),
            staleTime: Infinity,
        }
    }),
)
