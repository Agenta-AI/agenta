import {getQueriesClient} from "@agenta/sdk/resources"
import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {QueryFilteringText} from "../core/liveQuery"

import type {RunQueryReference} from "./runDetails"

/** What a live run's overview shows of its query: the filtering and the sampling rate. */
export interface RunQueryConfig {
    filtering: QueryFilteringText | null
    rate: number | null
}

/**
 * The query revision a live run stored, else the query's latest revision when the run stored
 * none. The run keeps reading its stored revision after someone edits the query.
 */
export const runQueryConfigQueryAtomFamily = atomFamily(
    ({queryId, revisionId}: RunQueryReference) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["queries", "revision", projectId ?? "", queryId, revisionId ?? ""],
                enabled: Boolean(projectId && (queryId || revisionId)),
                staleTime: 60_000,
                queryFn: async (): Promise<RunQueryConfig> => {
                    const response = await getQueriesClient().retrieveQueryRevision(
                        revisionId
                            ? {query_revision_ref: {id: revisionId}}
                            : {query_ref: {id: queryId}},
                        {queryParams: {project_id: projectId ?? ""}},
                    )
                    const data = response.query_revision?.data
                    const rate = data?.windowing?.rate
                    return {
                        filtering: (data?.filtering as QueryFilteringText | undefined) ?? null,
                        rate: typeof rate === "number" ? rate : null,
                    }
                },
            }
        }),
    (a, b) => a.queryId === b.queryId && a.revisionId === b.revisionId,
)
