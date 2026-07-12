/**
 * Raw-bytes access for drive files (build-spec 3): media/binary bodies and downloads go through
 * `GET /mounts/{id}/files/download` (bytes + guessed content-type). DEVIATION from the spec's
 * "signed short-lived URL as src": the endpoint sends `Content-Disposition: attachment` and auth
 * can be header-based cross-origin, so a direct `src=` is unreliable — phase 1 fetches the bytes
 * through the authenticated client once (cached blob → object URL). BACKEND ASK: an inline
 * disposition (or real signed URLs) to let media stream natively.
 */
import {useEffect, useMemo} from "react"

import {mountFileContentQueryKey, type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project"

export async function fetchMountFileBlob({
    mountId,
    projectId,
    path,
}: {
    mountId: string
    projectId: string
    path: string
}): Promise<Blob | null> {
    if (!mountId || !projectId || !path) return null
    try {
        // Axios (not Fern): Fern JSON-parses response bodies, mangling binary payloads.
        const response = await axios.get(`${getAgentaApiUrl()}/mounts/${mountId}/files/download`, {
            params: {project_id: projectId, path},
            responseType: "blob",
        })
        return response.data as Blob
    } catch {
        return null
    }
}

/** One drive file's raw bytes. Keyed UNDER the text-content key so the drive revalidation
 * (turn-finish / mid-stream signals) marks blobs stale with the same prefix invalidation. */
export const mountFileBlobQueryFamily = atomFamily(
    ({mountId, path}: {mountId: string; path: string}) =>
        atomWithQuery<Blob | null>((get) => {
            const projectId = get(projectIdAtom) ?? ""
            return {
                queryKey: [...mountFileContentQueryKey(projectId, mountId, path), "blob"],
                queryFn: () => fetchMountFileBlob({mountId, projectId, path}),
                enabled: Boolean(mountId && path && projectId),
                staleTime: 30_000,
                refetchOnWindowFocus: false,
            }
        }),
    (a, b) => a.mountId === b.mountId && a.path === b.path,
)

/** Object URL for a drive file's bytes — revoked on change/unmount. */
export function useMountFileObjectUrl(
    mount: Mount | null,
    path: string,
): {url: string | null; isPending: boolean; failed: boolean} {
    const query = useAtomValue(mountFileBlobQueryFamily({mountId: mount?.id ?? "", path}))
    const blob = query.data ?? null
    const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
    useEffect(() => {
        return () => {
            if (url) URL.revokeObjectURL(url)
        }
    }, [url])
    return {url, isPending: query.isPending, failed: !query.isPending && !blob}
}

/** Download one drive file (any type) via the bytes endpoint. */
export async function downloadMountFile({
    mount,
    path,
    projectId,
}: {
    mount: Mount | null
    path: string
    projectId: string | null | undefined
}): Promise<boolean> {
    if (!mount || !projectId) return false
    const blob = await fetchMountFileBlob({mountId: mount.id, projectId, path})
    if (!blob) return false
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = path.split("/").pop() ?? "download"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return true
}
