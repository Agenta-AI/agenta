import {useCallback, useEffect, useState} from "react"

import {createApiKey, deleteApiKey, fetchAllListApiKeys} from "./api/apiKeys"

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
    const [keys, setKeys] = useState<ApiKeyRow[]>([])
    const [listing, setListing] = useState(false)
    const [creating, setCreating] = useState(false)
    const [deleting, setDeleting] = useState(false)

    const list = useCallback(() => {
        if (!canView || !workspaceId.trim()) {
            setKeys([])
            return
        }
        setListing(true)
        fetchAllListApiKeys(workspaceId)
            .then((records) => {
                setKeys(
                    (records as ApiKey[]).map((key) => ({
                        ...key,
                        key: key.prefix,
                        id: key.prefix,
                    })),
                )
            })
            .catch(console.error)
            .finally(() => setListing(false))
    }, [canView, workspaceId])

    useEffect(() => {
        list()
    }, [list])

    const remove = useCallback(
        async (prefix: string) => {
            if (!canEdit) return
            if (!(await confirmDelete())) return
            setDeleting(true)
            try {
                await deleteApiKey(prefix)
                setKeys((current) => current.filter((key) => key.prefix !== prefix))
            } catch (error) {
                console.error(error)
            } finally {
                setDeleting(false)
            }
        },
        [canEdit, confirmDelete],
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
