/**
 * Prompts Page Store
 *
 * Uses queryWorkflows entity API for workflow data and folder query for folders.
 * Both queries are scoped to the current folder for server-side filtering.
 * Search mode fetches all data (no folder filter) for client-side tree filtering.
 */

import type {Workflow} from "@agenta/entities/workflow"
import {queryWorkflows} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryFolders} from "@/oss/services/folders"
import type {Folder} from "@/oss/services/folders/types"

// ============================================================================
// UI STATE ATOMS
// ============================================================================

export const promptsSearchTermAtom = atom("")
export const currentFolderIdAtom = atom<string | null>(null)

// ============================================================================
// FOLDERS QUERY ATOM (scoped to current folder, or all for search)
// ============================================================================

const foldersQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const searchTerm = get(promptsSearchTermAtom)
    const currentFolderId = get(currentFolderIdAtom)

    // When searching, fetch ALL folders for client-side tree filtering
    // When browsing, fetch only direct children of current folder
    const isSearching = searchTerm.trim().length > 0

    return {
        queryKey: ["prompts-folders", projectId, isSearching ? "__all__" : currentFolderId],
        queryFn: async (): Promise<Folder[]> => {
            if (!projectId) return []

            const folderQuery = isSearching
                ? {} // all folders
                : {parent_id: currentFolderId} // direct children (null = root)

            const response = await queryFolders({folder: folderQuery}, projectId)
            return response?.folders ?? []
        },
        enabled: !!projectId,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    }
})

/** Derived atom exposing just the folders array */
export const foldersAtom = atom((get) => {
    const query = get(foldersQueryAtom)
    return query.data ?? []
})

/** Derived atom exposing folders loading state */
export const foldersLoadingAtom = atom((get) => {
    const query = get(foldersQueryAtom)
    return query.isPending
})

/** Action atom to refetch folders */
export const refetchFoldersAtom = atom(null, (_get) => {
    const query = _get(foldersQueryAtom)
    query.refetch()
})

// ============================================================================
// ALL FOLDERS QUERY (for breadcrumbs, move modal, and folder lookups)
// ============================================================================

const allFoldersQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["prompts-all-folders", projectId],
        queryFn: async (): Promise<Folder[]> => {
            if (!projectId) return []
            const response = await queryFolders({folder: {}}, projectId)
            return response?.folders ?? []
        },
        enabled: !!projectId,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    }
})

/** All folders (for breadcrumbs, move modal tree, lookups) */
export const allFoldersAtom = atom((get) => {
    const query = get(allFoldersQueryAtom)
    return query.data ?? []
})

/** Action atom to refetch all folders */
export const refetchAllFoldersAtom = atom(null, (_get) => {
    const query = _get(allFoldersQueryAtom)
    query.refetch()
})

// ============================================================================
// HELPERS
// ============================================================================

const deriveAppType = (flags: Workflow["flags"]): string => {
    if (flags?.is_custom) return "custom"
    if (flags?.is_chat) return "chat"
    return "completion"
}

const mapWorkflowToRow = (w: Workflow): PromptsWorkflowRow => ({
    key: w.id,
    workflowId: w.id,
    name: w.name ?? w.slug ?? w.id,
    appType: deriveAppType(w.flags),
    folderId: w.folder_id ?? null,
    updatedAt: w.updated_at ?? w.created_at ?? null,
    createdAt: w.created_at ?? null,
})

// ============================================================================
// WORKFLOW ROW TYPE
// ============================================================================

export interface PromptsWorkflowRow {
    key: string
    workflowId: string
    name: string
    appType: string
    folderId: string | null
    updatedAt: string | null
    createdAt: string | null
}

// ============================================================================
// WORKFLOWS QUERY ATOM (scoped to current folder, or all for search)
// ============================================================================

const workflowsQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const searchTerm = get(promptsSearchTermAtom)
    const currentFolderId = get(currentFolderIdAtom)

    // When searching, fetch ALL workflows for client-side filtering
    // When browsing, fetch only workflows in the current folder
    const isSearching = searchTerm.trim().length > 0

    return {
        queryKey: ["prompts-workflows", projectId, isSearching ? "__all__" : currentFolderId],
        queryFn: async (): Promise<PromptsWorkflowRow[]> => {
            if (!projectId) return []
            const response = await queryWorkflows({
                projectId,
                flags: {is_evaluator: false},
                // undefined = no filter (search), null = root, string = specific folder
                folderId: isSearching ? undefined : (currentFolderId ?? null),
            })
            return response.workflows.map(mapWorkflowToRow)
        },
        enabled: !!projectId,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    }
})

/** Workflows for the current view */
export const workflowsAtom = atom((get) => {
    const query = get(workflowsQueryAtom)
    return query.data ?? []
})

/** Loading state for workflows */
export const workflowsLoadingAtom = atom((get) => {
    const query = get(workflowsQueryAtom)
    return query.isPending
})

/** Action atom to refetch workflows */
export const refetchWorkflowsAtom = atom(null, (_get) => {
    const query = _get(workflowsQueryAtom)
    query.refetch()
})
