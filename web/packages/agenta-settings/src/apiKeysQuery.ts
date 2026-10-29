import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchAllListApiKeys} from "./api/apiKeys"
import type {ApiKeyRow} from "./useApiKeys"

/**
 * The workspace's API keys, as a query atom.
 *
 * This used to be `useEffect` + `useState` + a manual `fetchAllListApiKeys`, which the frontend
 * conventions rule out for data fetching — and it showed: every mount refetched, two surfaces
 * showing keys each kept their own copy, and nothing invalidated after a create or delete except
 * a hand-rolled `list()` call.
 *
 * Keyed by workspace AND project because the request is scoped by both; `projectIdAtom` is read
 * inside so a project switch re-keys the query on its own.
 */
export const apiKeysQueryAtomFamily = atomFamily((workspaceId: string) =>
    atomWithQuery<ApiKeyRow[]>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["settings", "api-keys", workspaceId, projectId],
            queryFn: async () => {
                const records = await fetchAllListApiKeys(workspaceId)
                // The table keys rows off `key` and reads arbitrary fields off the record.
                return records.map((record) => ({
                    ...record,
                    key: record.prefix,
                    id: record.prefix,
                })) as ApiKeyRow[]
            },
            enabled: Boolean(workspaceId.trim()),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

export const apiKeysQueryKey = (workspaceId: string, projectId: string | null) =>
    ["settings", "api-keys", workspaceId, projectId] as const
