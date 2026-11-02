import {useCallback, useEffect, useMemo, useState} from "react"

import {
    browseRows,
    buildFolderTree,
    filterTreeBySearch,
    folderChain,
    indexFolders,
    projectFoldersListQueryStateAtom,
    promptWorkflowsListQueryStateAtom,
    siblingFolders,
    type Folder,
} from "@agenta/entities/workflow"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {flattenTree, promptType, type PromptItem, type PromptsRow} from "./promptRow"

const FOLDER_PARAM = "folderId"

export type PromptsEmptyKind = "project" | "folder" | "search"

/**
 * What the Prompts page shows: the open folder (kept in the `folderId` URL parameter), the rows
 * for it or for the search, and the load state. Reads only; the writes are in
 * `usePromptFolderActions`.
 */
export const usePromptsBrowser = () => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const foldersQuery = useAtomValue(projectFoldersListQueryStateAtom)
    const promptsQuery = useAtomValue(promptWorkflowsListQueryStateAtom)
    const [search, setSearch] = useState("")

    const rawFolderId = router.query[FOLDER_PARAM]
    const urlFolderId = typeof rawFolderId === "string" && rawFolderId ? rawFolderId : null

    const foldersById = useMemo(() => indexFolders(foldersQuery.data), [foldersQuery.data])
    const foldersLoaded = !foldersQuery.isPending && !foldersQuery.isError

    const openFolder = useCallback(
        (id: string | null) => {
            const {[FOLDER_PARAM]: _previous, ...rest} = router.query
            void router.replace(
                {pathname: router.pathname, query: id ? {...rest, [FOLDER_PARAM]: id} : rest},
                undefined,
                {shallow: true},
            )
        },
        [router],
    )

    // A link to a folder that is gone (or was deleted) lands on the root, not on an empty page.
    const unknownFolder = urlFolderId !== null && foldersLoaded && !foldersById.has(urlFolderId)
    useEffect(() => {
        if (unknownFolder) openFolder(null)
    }, [unknownFolder, openFolder])
    const folderId = unknownFolder ? null : urlFolderId

    const prompts = useMemo<PromptItem[]>(
        () =>
            promptsQuery.data.map((workflow) => ({...workflow, type: promptType(workflow.flags)})),
        [promptsQuery.data],
    )

    const term = search.trim()
    const rows = useMemo<PromptsRow[]>(() => {
        const nodes = term
            ? filterTreeBySearch(buildFolderTree(foldersQuery.data, prompts), term)
            : browseRows({folders: foldersQuery.data, prompts, folderId})
        return flattenTree(nodes)
    }, [folderId, foldersQuery.data, prompts, term])

    const chain = useMemo(() => folderChain(foldersById, folderId), [foldersById, folderId])
    const siblingsOf = useCallback(
        (parentId: string | null): Folder[] => siblingFolders(foldersById, parentId),
        [foldersById],
    )

    const isPending = foldersQuery.isPending || promptsQuery.isPending
    const isError = foldersQuery.isError || promptsQuery.isError
    let emptyKind: PromptsEmptyKind | null = null
    if (!isPending && !isError && rows.length === 0) {
        emptyKind = term ? "search" : folderId ? "folder" : "project"
    }

    const refetch = useCallback(() => {
        void queryClient.invalidateQueries({queryKey: ["folders"]})
        void queryClient.invalidateQueries({queryKey: ["workflows"]})
    }, [queryClient])

    return {
        folderId,
        openFolder,
        foldersById,
        chain,
        siblingsOf,
        rows,
        search,
        setSearch,
        isPending,
        isError,
        refetch,
        emptyKind,
    }
}
