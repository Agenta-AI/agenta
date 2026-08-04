import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {type Mount} from "@agenta/entities/session"
import {type QueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

import {uploadMountFile} from "./driveMedia"
import {type DroppedFile} from "./dropEntries"
import {useImagePreviews} from "./useImagePreviews"

/**
 * Uploads files INTO a mount from the Files drawer (writing to the agent's working files), with
 * per-item progress and retry — distinct from delivering a composer attachment to the model, which
 * is held on the reference contract. Reuses `driveMedia.uploadMountFile` for the transport.
 *
 * A finished upload invalidates the mount's file queries (host-agnostic: keyed on project + mount,
 * so it refreshes the open directory whether the host is a session or the config panel).
 */

/** How many files upload at once (a dropped folder can queue far more than that). */
const MAX_CONCURRENT_UPLOADS = 4

/** Stable identity for a picked file — so a re-drop, or staging then dropping the same file, is
 * recognised as the SAME upload and never duplicated. Keyed on the relative path, not the bare name,
 * so same-named files from two subfolders of a dropped directory stay distinct. */
export const fileKey = (f: DroppedFile): string =>
    `${f.relativePath}::${f.file.size}::${f.file.lastModified}`

export interface MountUploadItem {
    id: string
    /** Stable file identity (see fileKey) — lets a host reconcile staged files against in-flight ones. */
    key: string
    name: string
    /** Destination path relative to `destFolder` — nested for a file from a dropped folder. */
    relativePath: string
    size: number
    /** The picked file — drives the image preview (via useImagePreviews). */
    file: File
    percent: number
    /** Failure message, or null while pending. */
    error: string | null
    /** Mount-relative destination folder (transport). */
    destFolder: string
    /** Drive-root-relative destination folder ("" = root) — where the item slots into the tree/grid. */
    presentedFolder: string
    /** Object URL for an image preview (derived from `file`), else null. */
    previewUrl: string | null
}

/** Where an upload lands: the resolved mount (cwd or the folded agent-files mount) + folder. */
export interface MountUploadTarget {
    mount: Mount
    /** Mount-relative folder ("" = root) — the transport path. */
    destFolder: string
    /** Drive-root-relative folder the user chose — for placing the item in the tree/grid. */
    presentedFolder: string
}

export interface MountUpload {
    items: MountUploadItem[]
    upload: (files: DroppedFile[], target: MountUploadTarget) => void
    retry: (id: string) => void
    dismiss: (id: string) => void
}

export function invalidateMountListings(
    queryClient: QueryClient,
    projectId: string | null | undefined,
): void {
    if (!projectId) return
    for (const root of ["files", "files-latest", "files-root", "files-dir"]) {
        void queryClient.invalidateQueries({queryKey: ["mounts", root, projectId]})
    }
}

export function useMountUpload(): MountUpload {
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useAtomValue(queryClientAtom)
    const [items, setItems] = useState<MountUploadItem[]>([])

    // Per-item inputs kept for retry, plus abort controllers for cleanup.
    const sources = useRef(new Map<string, {dropped: DroppedFile; target: MountUploadTarget}>())
    const controllers = useRef(new Map<string, AbortController>())
    // A dropped folder can hold hundreds of files, so runs are gated: ids wait here until a slot frees.
    const waiting = useRef<string[]>([])
    const running = useRef(0)
    const pumpRef = useRef<() => void>(() => undefined)

    const patch = useCallback((id: string, next: Partial<MountUploadItem>) => {
        setItems((prev) => prev.map((it) => (it.id === id ? {...it, ...next} : it)))
    }, [])

    const refreshListing = useCallback(
        () => invalidateMountListings(queryClient, projectId),
        [queryClient, projectId],
    )

    const run = useCallback(
        (id: string) => {
            const src = sources.current.get(id)
            if (!src) return
            controllers.current.get(id)?.abort()
            const controller = new AbortController()
            controllers.current.set(id, controller)
            patch(id, {percent: 0, error: null})
            uploadMountFile({
                mountId: src.target.mount.id ?? "",
                destFolder: src.target.destFolder,
                file: src.dropped.file,
                destName: src.dropped.relativePath,
                projectId,
                onProgress: (percent) => patch(id, {percent}),
                signal: controller.signal,
            })
                .then(() => {
                    running.current = Math.max(0, running.current - 1)
                    pumpRef.current()
                    if (controller.signal.aborted) return
                    controllers.current.delete(id)
                    // On success the real file arrives via the listing refetch, so drop the optimistic
                    // item — removing its file from the list also lets useImagePreviews revoke the URL.
                    sources.current.delete(id)
                    setItems((prev) => prev.filter((it) => it.id !== id))
                    refreshListing()
                })
                .catch((e: unknown) => {
                    running.current = Math.max(0, running.current - 1)
                    pumpRef.current()
                    if (controller.signal.aborted) return
                    controllers.current.delete(id)
                    patch(id, {error: e instanceof Error ? e.message : "Upload failed"})
                })
        },
        [projectId, patch, refreshListing],
    )

    // Start queued uploads up to the concurrency limit; ids dismissed while waiting are skipped.
    const pump = useCallback(() => {
        while (running.current < MAX_CONCURRENT_UPLOADS && waiting.current.length) {
            const id = waiting.current.shift() as string
            if (!sources.current.has(id)) continue
            running.current += 1
            run(id)
        }
    }, [run])
    // `run` settles asynchronously and pumps the queue again, so it reaches pump through a ref.
    useEffect(() => {
        pumpRef.current = pump
    }, [pump])

    const enqueue = useCallback(
        (id: string) => {
            waiting.current.push(id)
            pump()
        },
        [pump],
    )

    const upload = useCallback(
        (files: DroppedFile[], target: MountUploadTarget) => {
            // Skip files already in flight (same key) so a re-drop, or a drop of a file that's also
            // staged, can't create a second upload item for the same file.
            const inFlight = new Set(
                Array.from(sources.current.values()).map((s) => fileKey(s.dropped)),
            )
            const fresh = files.filter((f) => !inFlight.has(fileKey(f)))
            if (!fresh.length) return
            const started: MountUploadItem[] = []
            fresh.forEach((dropped, i) => {
                const {file, relativePath} = dropped
                const id = `${Date.now()}-${i}-${relativePath}`
                sources.current.set(id, {dropped, target})
                started.push({
                    id,
                    key: fileKey(dropped),
                    name: file.name,
                    relativePath,
                    size: file.size,
                    file,
                    percent: 0,
                    error: null,
                    destFolder: target.destFolder,
                    presentedFolder: target.presentedFolder,
                    previewUrl: null, // derived below via useImagePreviews
                })
            })
            setItems((prev) => [...prev, ...started])
            started.forEach((it) => enqueue(it.id))
        },
        [enqueue],
    )

    const retry = useCallback((id: string) => enqueue(id), [enqueue])
    const dismiss = useCallback((id: string) => {
        controllers.current.get(id)?.abort()
        controllers.current.delete(id)
        sources.current.delete(id)
        // Removing the item frees its file from the preview list → useImagePreviews revokes the URL.
        setItems((prev) => prev.filter((it) => it.id !== id))
    }, [])

    useEffect(() => {
        const map = controllers.current
        return () => map.forEach((c) => c.abort())
    }, [])

    // Image previews are owned by the shared hook (created lazily, revoked when a file leaves / unmount);
    // the returned items carry the derived URL so consumers keep reading `item.previewUrl`.
    const previews = useImagePreviews(useMemo(() => items.map((it) => it.file), [items]))
    const itemsWithPreviews = useMemo(
        () => items.map((it) => ({...it, previewUrl: previews.get(it.file) ?? null})),
        [items, previews],
    )

    return {items: itemsWithPreviews, upload, retry, dismiss}
}
