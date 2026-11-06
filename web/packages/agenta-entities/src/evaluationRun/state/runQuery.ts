import {getQueriesClient} from "@agenta/sdk/resources"
import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {QueryFilteringText} from "../core/liveQuery"

/** What a live run's overview shows of its query: the filtering and the sampling rate. */
export interface RunQueryConfig {
    filtering: QueryFilteringText | null
    rate: number | null
}

/** The current revision of a stored query (a live run's trace query), by query id. */
export const runQueryConfigQueryAtomFamily = atomFamily((queryId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["queries", "revision", projectId ?? "", queryId],
            enabled: Boolean(projectId && queryId),
            staleTime: 60_000,
            queryFn: async (): Promise<RunQueryConfig> => {
                const response = await getQueriesClient().retrieveQueryRevision(
                    {query_ref: {id: queryId}},
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
)
