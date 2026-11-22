import {fetchRevisionColumnKeys} from "@agenta/entities/testset"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

/** The column names of a test set revision, by `projectId|revisionId`. */
export const testsetColumnKeysAtomFamily = atomFamily((key: string) =>
    atomWithQuery(() => {
        const [projectId, revisionId] = key.split("|")
        return {
            queryKey: ["evaluations", "testset-columns", projectId, revisionId],
            queryFn: () => fetchRevisionColumnKeys({projectId, revisionId}),
            enabled: Boolean(projectId && revisionId),
            staleTime: 60_000,
            retry: false,
        }
    }),
)
