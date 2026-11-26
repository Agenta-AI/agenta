/**
 * The project's prompt folders as a cached query. Every folder comes in one request: the
 * screens derive each level (breadcrumb, move tree, search) from that one list.
 */
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import type {QueryClient} from "@tanstack/react-query"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import type {ListQueryState} from "../../shared"

import {queryFolders} from "./api"
import type {Folder} from "./schema"

const projectFoldersKey = (projectId: string | null) => ["folders", projectId] as const

export const projectFoldersQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: projectFoldersKey(projectId),
        // A failed request throws, so the list reads as an error and not as "no folders".
        queryFn: (): Promise<Folder[]> =>
            projectId ? queryFolders({projectId}) : Promise.resolve([]),
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
    }
})

export const projectFoldersListQueryStateAtom = atom<ListQueryState<Folder>>((get) => {
    const query = get(projectFoldersQueryAtom)
    return {
        data: query.data ?? [],
        isPending: query.isPending ?? false,
        isFetching: query.isFetching,
        isError: query.isError ?? false,
        error: query.error ?? null,
    }
})

/** Marks every cached folder list stale and refetches the ones on screen. */
export const invalidateProjectFolders = (queryClient: QueryClient) =>
    queryClient.invalidateQueries({queryKey: ["folders"]})
