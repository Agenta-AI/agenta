import {createContext, useCallback, useContext, useEffect, useState} from "react"

import {mountFileContentQueryFamily, type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {downloadMountFile, useMountFileMediaSrc, useMountFileObjectUrl} from "./driveMedia"

/**
 * Lets the Drives viewer render files that are NOT backed by a mount — a handful of local, in-memory
 * blobs (the composer's attachments), previewed in the same drawer as agent files instead of a
 * parallel viewer.
 *
 * A provider maps a node path to its `File` and a ready object URL. The viewer's byte hooks consult
 * this first and fall back to the mount download when it is absent — so every existing host (chat
 * browse, config panel), which never provides one, keeps its exact mount behaviour.
 */

export interface LocalDriveFile {
    file: File
    /** Object URL for the blob, owned and revoked by the provider. */
    objectUrl: string
}

export type DriveFileSource = Map<string, LocalDriveFile>

export const DriveFileSourceContext = createContext<DriveFileSource | null>(null)

const useLocalFile = (path: string): LocalDriveFile | null =>
    useContext(DriveFileSourceContext)?.get(path) ?? null

/** Streaming media source (image / audio / video). Object URL locally; mount media otherwise. */
export function useDriveMediaSrc(
    mount: Mount | null,
    path: string,
): {src: string | null; isPending: boolean; failed: boolean; onError: () => void} {
    const local = useLocalFile(path)
    const mountRes = useMountFileMediaSrc(mount, path)
    if (local) return {src: local.objectUrl, isPending: false, failed: false, onError: () => {}}
    return mountRes
}

/** Object URL for a downloadable preview (PDF). */
export function useDriveObjectUrl(
    mount: Mount | null,
    path: string,
): {url: string | null; isPending: boolean; failed: boolean} {
    const local = useLocalFile(path)
    const mountRes = useMountFileObjectUrl(mount, path)
    if (local) return {url: local.objectUrl, isPending: false, failed: false}
    return mountRes
}

/** Text content for the source-family bodies. Reads the local blob; else the mount content query. */
export function useDriveFileText(
    mount: Mount | null,
    path: string,
): {data: string | undefined; isPending: boolean} {
    const local = useLocalFile(path)
    const mountQuery = useAtomValue(mountFileContentQueryFamily({mountId: mount?.id ?? "", path}))
    const [text, setText] = useState<string | undefined>(undefined)
    useEffect(() => {
        if (!local) return
        let cancelled = false
        local.file
            .text()
            .then((t) => !cancelled && setText(t))
            .catch(() => !cancelled && setText(""))
        return () => {
            cancelled = true
        }
    }, [local])
    if (local) return {data: text, isPending: text === undefined}
    return {data: mountQuery.data as string | undefined, isPending: mountQuery.isPending}
}

/** Download action: saves the local blob directly, or routes to the mount download. */
export function useDriveDownload(mount: Mount | null, path: string): () => void {
    const local = useLocalFile(path)
    const projectId = useAtomValue(projectIdAtom)
    return useCallback(() => {
        if (local) {
            const a = document.createElement("a")
            a.href = local.objectUrl
            a.download = path.split("/").pop() || "file"
            a.click()
            return
        }
        void downloadMountFile({mount, path, projectId})
    }, [local, mount, path, projectId])
}
