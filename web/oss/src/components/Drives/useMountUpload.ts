import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

import {SIMULATE_UPLOAD, uploadMountFile} from "./driveMedia"
import {useImagePreviews} from "./useImagePreviews"

/**
 * Uploads files INTO a mount from the Files drawer (writing to the agent's working files), with
 * per-item progress and retry — distinct from delivering a composer attachment to the model, which
 * is held on the reference contract. Reuses `driveMedia.uploadMountFile` for the transport.
 *
 * A finished upload invalidates the mount's file queries (host-agnostic: keyed on project + mount,
 * so it refreshes the open directory whether the host is a session or the config panel).
 */

/** Stable identity for a picked File — so a re-drop, or staging then dropping the same file, is
 * recognised as the SAME upload and never duplicated. */
export const fileKey = (f: File): string => `${f.name}::${f.size}::${f.lastModified}`

export interface MountUploadItem {
    id: string
    /** Stable file identity (see fileKey) — lets a host reconcile staged files against in-flight ones. */
    key: string
    name: string
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
    upload: (files: File[], target: MountUploadTarget) => void
    retry: (id: string) => void
    dismiss: (id: string) => void
}

export function useMountUpload(): MountUpload {
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useAtomValue(queryClientAtom)
    const [items, setItems] = useState<MountUploadItem[]>([])

    // Per-item inputs kept for retry, plus abort controllers for cleanup.
    const sources = useRef(new Map<string, {file: File; target: MountUploadTarget}>())
    const controllers = useRef(new Map<string, AbortController>())

    const patch = useCallback((id: string, next: Partial<MountUploadItem>) => {
        setItems((prev) => prev.map((it) => (it.id === id ? {...it, ...next} : it)))
    }, [])

    const refreshListing = useCallback(() => {
        // Prefix-match every mount file-query root for the project (dir listing, root, latest, summary).
        for (const root of ["files", "files-latest", "files-root", "files-dir"]) {
            void queryClient.invalidateQueries({queryKey: ["mounts", root, projectId]})
        }
    }, [queryClient, projectId])

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
                file: src.file,
                projectId,
                onProgress: (percent) => patch(id, {percent}),
                signal: controller.signal,
            })
                .then(() => {
                    if (controller.signal.aborted) return
                    controllers.current.delete(id)
                    // TEMP(test): with the transport stubbed no real file arrives from a refetch, so
                    // removing the optimistic tile just made the drop "disappear". Keep it as a done
                    // tile instead. Remove with the SIMULATE_UPLOAD stub.
                    if (SIMULATE_UPLOAD) {
                        patch(id, {percent: 100})
                        return
                    }
                    // Dropping the item removes its file from the list → useImagePreviews revokes the URL.
                    sources.current.delete(id)
                    setItems((prev) => prev.filter((it) => it.id !== id))
                    refreshListing()
                })
                .catch((e: unknown) => {
                    if (controller.signal.aborted) return
                    controllers.current.delete(id)
                    patch(id, {error: e instanceof Error ? e.message : "Upload failed"})
                })
        },
        [projectId, patch, refreshListing],
    )

    const upload = useCallback(
        (files: File[], target: MountUploadTarget) => {
            // Skip files already in flight (same key) so a re-drop, or a drop of a file that's also
            // staged, can't create a second upload item for the same file.
            const inFlight = new Set(
                Array.from(sources.current.values()).map((s) => fileKey(s.file)),
            )
            const fresh = files.filter((f) => !inFlight.has(fileKey(f)))
            if (!fresh.length) return
            const started: MountUploadItem[] = []
            fresh.forEach((file, i) => {
                const id = `${Date.now()}-${i}-${file.name}`
                sources.current.set(id, {file, target})
                started.push({
                    id,
                    key: fileKey(file),
                    name: file.name,
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
            started.forEach((it) => run(it.id))
        },
        [run],
    )

    const retry = useCallback((id: string) => run(id), [run])
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
