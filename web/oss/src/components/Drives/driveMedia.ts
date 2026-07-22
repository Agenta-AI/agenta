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
import {getJWT} from "@/oss/services/api"
import {projectIdAtom} from "@/oss/state/project"

import {renderPdfFirstPage} from "./pdfThumb"

/** Subset of the File System Access API we use to stream a download straight to disk (Chromium).
 * Declared locally — the global typings aren't present in every browser even when the runtime is,
 * and the buffered fallback needs none of it. Mirrors the ETL `exportWriter` feature-detect. We
 * write chunks with `writable.write()` (NOT `ReadableStream.pipeTo(writable)`, which no-ops into a
 * FileSystemWritableFileStream and leaves a 0-byte file). */
interface WritableFileStreamLike {
    write(chunk: Uint8Array): Promise<void>
    close(): Promise<void>
    abort(reason?: unknown): Promise<void>
}
type ShowSaveFilePicker = (options?: {
    suggestedName?: string
    types?: {description?: string; accept: Record<string, string[]>}[]
}) => Promise<{createWritable(): Promise<WritableFileStreamLike>}>

const getShowSaveFilePicker = (): ShowSaveFilePicker | undefined => {
    if (typeof window === "undefined") return undefined
    const picker = (window as unknown as {showSaveFilePicker?: ShowSaveFilePicker})
        .showSaveFilePicker
    return typeof picker === "function" ? picker : undefined
}

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

/** Longest side of a generated grid thumbnail, in px. */
const THUMB_PX = 256

/** Downscale an image blob to a small thumbnail data URL on the CLIENT (webp, `THUMB_PX` longest
 * side). `createImageBitmap` decodes off the main thread; the draw + encode are tiny. Returns null
 * if the browser can't decode it (caller falls back to the type icon). This is what lets the grid
 * cache a few KB per tile instead of pinning the full-size original in memory while browsing many
 * files — the whole point of the FE thumbnail path (no server resize). */
async function downscaleImage(blob: Blob): Promise<string | null> {
    if (typeof createImageBitmap !== "function") return null
    let bitmap: ImageBitmap | null = null
    try {
        bitmap = await createImageBitmap(blob)
        const scale = Math.min(1, THUMB_PX / Math.max(bitmap.width, bitmap.height))
        const w = Math.max(1, Math.round(bitmap.width * scale))
        const h = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) return null
        ctx.drawImage(bitmap, 0, 0, w, h)
        return canvas.toDataURL("image/webp", 0.7)
    } catch {
        return null
    } finally {
        bitmap?.close()
    }
}

/**
 * A file's grid THUMBNAIL as a small data-URL string — a downscaled image or a rendered PDF first
 * page. The heavy original bytes are fetched, converted, and DROPPED; only the tiny string is
 * retained (generous `gcTime`, strings are cheap). So browsing thousands of image/pdf files keeps
 * memory bounded (KBs per seen tile, not the full originals) and scroll-back is instant with no
 * re-decode/re-render. Keyed separately from the full-size {@link mountFileBlobQueryFamily} viewer.
 */
export const mountFileThumbnailQueryFamily = atomFamily(
    ({mountId, path, mode}: {mountId: string; path: string; mode: "image" | "pdf"}) =>
        atomWithQuery<string | null>((get) => {
            const projectId = get(projectIdAtom) ?? ""
            return {
                queryKey: ["mounts", "thumb", projectId, mountId, path, mode],
                queryFn: async () => {
                    const blob = await fetchMountFileBlob({mountId, projectId, path})
                    if (!blob) return null
                    return mode === "pdf" ? renderPdfFirstPage(blob) : downscaleImage(blob)
                },
                enabled: Boolean(mountId && path && projectId),
                staleTime: Infinity,
                gcTime: 5 * 60_000,
                refetchOnWindowFocus: false,
            }
        }),
    (a, b) => a.mountId === b.mountId && a.path === b.path && a.mode === b.mode,
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
/**
 * Upload a file into a mount folder, reporting real progress via axios `onUploadProgress` (the
 * Fern client uses fetch, which can't stream upload progress). `destFolder` is the mount-relative
 * directory ("" = root); the filename is appended.
 */
export async function uploadMountFile({
    mountId,
    destFolder,
    file,
    projectId,
    onProgress,
    signal,
}: {
    mountId: string
    destFolder: string
    file: File
    projectId?: string | null
    onProgress?: (percent: number) => void
    signal?: AbortSignal
}): Promise<void> {
    const form = new FormData()
    form.append("file", file, file.name)
    const path = destFolder ? `${destFolder.replace(/\/$/, "")}/${file.name}` : file.name
    await axios.post(`${getAgentaApiUrl()}/mounts/${mountId}/files/upload`, form, {
        params: {path, project_id: projectId},
        signal,
        onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
        },
    })
}

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

/** Download the WHOLE drive as ONE zip ("download all") — spanning every mount the drive folds in
 * (cwd at the root, the agent's durable folder under `agent-files/`). The backend STREAMS the zip
 * (never buffered whole) and reads file bodies with bounded concurrency.
 *
 * On Chromium (File System Access API) the server's zip stream is piped STRAIGHT TO DISK — client
 * memory stays bounded by one chunk, matching the server. Safari/Firefox (no picker) fall back to
 * buffering the blob + an anchor-click (the whole zip transits the JS heap there). `cancelled` is
 * returned when the user dismisses the native save dialog, so the caller can skip the error toast. */
export async function downloadMountArchive({
    mounts,
    projectId,
    filename = "files.zip",
}: {
    /** Each mount: `prefix` = where in the zip its files go (folded drive); `path` = a source folder
     * within the mount to scope to ("" = whole mount, for "download all"). */
    mounts: {mountId: string; prefix?: string; path?: string}[]
    projectId: string | null | undefined
    filename?: string
}): Promise<{ok: boolean; error?: string; cancelled?: boolean}> {
    const valid = mounts.filter((m) => m.mountId)
    if (!valid.length || !projectId) return {ok: false}
    const payload = {
        mounts: valid.map((m) => ({
            mount_id: m.mountId,
            prefix: m.prefix ?? "",
            path: m.path ?? "",
        })),
        filename,
    }

    // ─── Streaming-to-disk (Chromium) ────────────────────────────────────────────────────────────
    const showSaveFilePicker = getShowSaveFilePicker()
    if (showSaveFilePicker) {
        let handle: {createWritable(): Promise<WritableFileStreamLike>} | null = null
        try {
            handle = await showSaveFilePicker({
                suggestedName: filename,
                types: [{description: "Zip archive", accept: {"application/zip": [".zip"]}}],
            })
        } catch (error) {
            // User dismissed the picker → bail without downloading; other failures fall through.
            if ((error as Error)?.name === "AbortError") return {ok: false, cancelled: true}
        }
        if (handle) {
            const writable = await handle.createWritable()
            try {
                const jwt = await getJWT()
                const url = `${getAgentaApiUrl()}/mounts/files/export?project_id=${encodeURIComponent(projectId)}`
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(jwt ? {Authorization: `Bearer ${jwt}`} : {}),
                    },
                    body: JSON.stringify(payload),
                })
                if (!response.ok || !response.body) throw new Error(`archive ${response.status}`)
                // Manual read → write per chunk (pipeTo into a FileSystemWritableFileStream no-ops).
                const reader = response.body.getReader()
                for (;;) {
                    const {done, value} = await reader.read()
                    if (done) break
                    if (value) await writable.write(value)
                }
                await writable.close()
                return {ok: true}
            } catch {
                await writable.abort().catch(() => undefined)
                return {ok: false, error: "Couldn't prepare the download."}
            }
        }
    }

    // ─── Buffered fallback (Safari / Firefox / no picker) ─────────────────────────────────────────
    try {
        const response = await axios.post(`${getAgentaApiUrl()}/mounts/files/export`, payload, {
            params: {project_id: projectId},
            responseType: "blob",
        })
        const url = URL.createObjectURL(response.data as Blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        return {ok: true}
    } catch {
        return {ok: false, error: "Couldn't prepare the download."}
    }
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
