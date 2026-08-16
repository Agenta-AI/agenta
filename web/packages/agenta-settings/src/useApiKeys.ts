import {useCallback, useMemo, useState} from "react"

import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {createApiKey, deleteApiKey} from "./api/apiKeys"
import {apiKeysQueryAtomFamily, apiKeysQueryKey} from "./apiKeysQuery"

export interface ApiKey {
    prefix: string
    created_at?: string | null
    expiration_date?: string | null
    last_used_at?: string | null
    [extra: string]: unknown
}

/** The virtual table keys rows off `key` and reads arbitrary fields. */
export interface ApiKeyRow extends ApiKey {
    key: string
    id: string
}

export interface UseApiKeysOptions {
    /** The owning workspace. Empty until org data resolves; the hook simply waits. */
    workspaceId: string
    canView: boolean
    canEdit: boolean
    /**
     * Confirm a destructive delete. The host supplies its own dialog; resolving false (or never
     * calling back) leaves the key alone.
     */
    confirmDelete: () => Promise<boolean>
    /**
     * A key was created. It is returned ONCE and cannot be retrieved again, so the host must
     * show it immediately and offer a copy.
     */
    onCreated: (secret: string) => void
    /** The workspace has not loaded yet, so a key cannot be scoped. */
    onWorkspacePending?: () => void
}

/**
 * Workspace API keys: the list, and the create/delete verbs.
 *
 * Headless because the two surfaces that show keys differ only in chrome, while the parts that
 * genuinely differ per host — the delete confirmation and the one-time reveal of a new key —
 * arrive as callbacks rather than being baked in.
 */
export const useApiKeys = ({
    workspaceId,
    canView,
    canEdit,
    confirmDelete,
    onCreated,
    onWorkspacePending,
}: UseApiKeysOptions) => {
    const [creating, setCreating] = useState(false)
    const [deleting, setDeleting] = useState(false)

    const projectId = useAtomValue(projectIdAtom)
    const query = useAtomValue(
        useMemo(() => apiKeysQueryAtomFamily(canView ? workspaceId : ""), [canView, workspaceId]),
    )
    const keys = useMemo<ApiKeyRow[]>(
        () => (canView ? (query.data ?? []) : []),
        [canView, query.data],
    )
    // A disabled query is pending forever, so it cannot stand in for "loading".
    const listing = query.fetchStatus === "fetching"

    /** Refetch after a mutation. The cache is the list now, so nothing writes rows by hand. */
    const list = useCallback(() => {
        void getHostQueryClient().invalidateQueries({
            queryKey: apiKeysQueryKey(workspaceId, projectId),
        })
    }, [projectId, workspaceId])

    const remove = useCallback(
        async (prefix: string) => {
            if (!canEdit) return
            if (!(await confirmDelete())) return
            setDeleting(true)
            try {
                await deleteApiKey(prefix)
                list()
            } catch (error) {
                console.error(error)
            } finally {
                setDeleting(false)
            }
        },
        [canEdit, confirmDelete, list],
    )

    const create = useCallback(async () => {
        if (!canEdit) return
        if (!workspaceId.trim()) {
            onWorkspacePending?.()
            return
        }
        setCreating(true)
        try {
            const created = await createApiKey(workspaceId)
            list()
            onCreated(created)
        } catch (error) {
            console.error(error)
        } finally {
            setCreating(false)
        }
    }, [canEdit, list, onCreated, onWorkspacePending, workspaceId])

    return {keys, listing, creating, deleting, list, create, remove}
}
