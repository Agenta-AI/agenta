/**
 * Raw-bytes access for drive files (build-spec 3): media/binary bodies and downloads go through
 * `GET /mounts/{id}/files/download` (bytes + guessed content-type). DEVIATION from the spec's
 * "signed short-lived URL as src": the endpoint sends `Content-Disposition: attachment` and auth
 * can be header-based cross-origin, so a direct `src=` is unreliable — phase 1 fetches the bytes
 * through the authenticated client once (cached blob → object URL). BACKEND ASK: an inline
 * disposition (or real signed URLs) to let media stream natively.
 */
import {useEffect, useMemo, useState} from "react"

import {type Mount} from "@agenta/entities/session"
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

/** One drive file's raw bytes (up to the 25 MB media cap). MEMORY POLICY: a blob lives only
 * while a body renders it — `gcTime: 0` drops it the moment the viewer unmounts (paging away,
 * closing the preview), so browsing N media files never pins N blobs. Deliberately keyed OUTSIDE
 * the content-key prefix: the drive revalidation must not re-download an actively-viewed video
 * on every finished turn — reopening refetches anyway since nothing is retained. */
export const mountFileBlobQueryFamily = atomFamily(
    ({mountId, path}: {mountId: string; path: string}) =>
        atomWithQuery<Blob | null>((get) => {
            const projectId = get(projectIdAtom) ?? ""
            return {
                queryKey: ["mounts", "file-blob", projectId, mountId, path],
                queryFn: () => fetchMountFileBlob({mountId, projectId, path}),
                enabled: Boolean(mountId && path && projectId),
                staleTime: Infinity,
                gcTime: 0,
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

/** The raw-bytes URL for one drive file. Media tags can use it DIRECTLY on same-origin
 * cookie-auth deployments (the browser streams progressively — bytes never enter the JS heap;
 * Content-Disposition is ignored by <img>/<audio>/<video>). Header-auth/cross-origin setups 401
 * on it — callers must handle onError and fall back to the blob path. */
export function mountFileDownloadUrl(
    mount: Mount | null,
    path: string,
    projectId: string | null | undefined,
): string | null {
    if (!mount || !projectId || !path) return null
    const params = new URLSearchParams({path, project_id: projectId})
    return `${getAgentaApiUrl()}/mounts/${mount.id}/files/download?${params.toString()}`
}

/**
 * Media source with streaming-first semantics: try the direct URL (zero JS-heap, progressive
 * playback), and only on tag error (auth/cross-origin) fetch the cached blob. `src` is null
 * while the blob fallback loads. Wire `onError` to the media element.
 */
export function useMountFileMediaSrc(
    mount: Mount | null,
    path: string,
): {src: string | null; isPending: boolean; failed: boolean; onError: () => void} {
    const projectId = useAtomValue(projectIdAtom)
    const directUrl = mountFileDownloadUrl(mount, path, projectId)
    const [mode, setMode] = useState<"direct" | "blob">(directUrl ? "direct" : "blob")

    // New file (paging) → try direct again.
    useEffect(() => {
        setMode(directUrl ? "direct" : "blob")
    }, [directUrl])

    const blobQuery = useAtomValue(
        mountFileBlobQueryFamily({mountId: mode === "blob" ? (mount?.id ?? "") : "", path}),
    )
    const blob = mode === "blob" ? (blobQuery.data ?? null) : null
    const blobUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
    useEffect(() => {
        return () => {
            if (blobUrl) URL.revokeObjectURL(blobUrl)
        }
    }, [blobUrl])

    return {
        src: mode === "direct" ? directUrl : blobUrl,
        isPending: mode === "blob" && blobQuery.isPending,
        failed: mode === "blob" && !blobQuery.isPending && !blob,
        onError: () => setMode("blob"),
    }
}
