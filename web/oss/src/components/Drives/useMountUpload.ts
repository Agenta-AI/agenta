import {useCallback, useEffect, useRef, useState} from "react"

import {type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

import {uploadMountFile} from "./driveMedia"

/**
 * Uploads files INTO a mount from the Files drawer (writing to the agent's working files), with
 * per-item progress and retry — distinct from delivering a composer attachment to the model, which
 * is held on the reference contract. Reuses `driveMedia.uploadMountFile` for the transport.
 *
 * A finished upload invalidates the mount's file queries (host-agnostic: keyed on project + mount,
 * so it refreshes the open directory whether the host is a session or the config panel).
 */

export interface MountUploadItem {
    id: string
    name: string
    percent: number
    /** Failure message, or null while pending. */
    error: string | null
}

export interface MountUpload {
    items: MountUploadItem[]
    /** Upload files into `destFolder` (mount-relative; "" = root). */
    upload: (files: File[], destFolder: string) => void
    retry: (id: string) => void
    dismiss: (id: string) => void
}

export function useMountUpload(mount: Mount | null): MountUpload {
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useAtomValue(queryClientAtom)
    const [items, setItems] = useState<MountUploadItem[]>([])

    // Per-item inputs kept for retry, plus abort controllers for cleanup.
    const sources = useRef(new Map<string, {file: File; destFolder: string}>())
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
            if (!src || !mount) return
            controllers.current.get(id)?.abort()
            const controller = new AbortController()
            controllers.current.set(id, controller)
            patch(id, {percent: 0, error: null})
            uploadMountFile({
                mountId: mount.id ?? "",
                destFolder: src.destFolder,
                file: src.file,
                projectId,
                onProgress: (percent) => patch(id, {percent}),
                signal: controller.signal,
            })
                .then(() => {
                    if (controller.signal.aborted) return
                    controllers.current.delete(id)
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
        [mount, projectId, patch, refreshListing],
    )

    const upload = useCallback(
        (files: File[], destFolder: string) => {
            const started: MountUploadItem[] = []
            files.forEach((file, i) => {
                const id = `${Date.now()}-${i}-${file.name}`
                sources.current.set(id, {file, destFolder})
                started.push({id, name: file.name, percent: 0, error: null})
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
        setItems((prev) => prev.filter((it) => it.id !== id))
    }, [])

    useEffect(() => {
        const map = controllers.current
        return () => map.forEach((c) => c.abort())
    }, [])

    return {items, upload, retry, dismiss}
}
