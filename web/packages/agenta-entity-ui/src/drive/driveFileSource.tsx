import {createContext, useCallback, useContext, useEffect, useState} from "react"

import {useMountFileMediaSrc, useMountFileObjectUrl} from "@agenta/entities/drive"
import {mountFileContentQueryFamily, type Mount} from "@agenta/entities/session"
import {axios} from "@agenta/shared/api"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {useDriveFileDownload} from "./useDriveFileDownload"

/**
 * Lets the Drives viewer render files that are NOT backed by a mount — chat attachments (served by
 * the attachments endpoint) or files staged in the composer — through the same bodies as agent files
 * instead of a parallel viewer.
 *
 * A provider maps a node path to its source. The viewer's byte hooks consult this first and fall
 * back to the mount download when it is absent, so a host that provides none keeps its exact mount
 * behaviour.
 */

export interface LocalDriveFile {
    /** What media elements load and Download saves: an object URL, or an app-authenticated URL. */
    src: string
    /** The bytes, when they are already in memory; otherwise they are fetched from `src`. */
    file?: File
}

export type DriveFileSource = Map<string, LocalDriveFile>

export const DriveFileSourceContext = createContext<DriveFileSource | null>(null)

const useLocalFile = (path: string): LocalDriveFile | null =>
    useContext(DriveFileSourceContext)?.get(path) ?? null

/** A remote source's bytes, through the app's authenticated client (the URL may need a header). */
const remoteBytesQueryFamily = atomFamily(
    ({src, as}: {src: string; as: "blob" | "text"}) =>
        atomWithQuery<Blob | string | null>(() => ({
            queryKey: ["drive-source", as, src],
            queryFn: async () => {
                try {
                    const blob = (await axios.get(src, {responseType: "blob"})).data as Blob
                    return as === "text" ? await blob.text() : blob
                } catch {
                    return null
                }
            },
            enabled: Boolean(src),
            staleTime: Infinity,
            // A blob lives only while a body renders it, as with mount bytes.
            gcTime: as === "blob" ? 0 : 60_000,
            refetchOnWindowFocus: false,
        })),
    (a, b) => a.src === b.src && a.as === b.as,
)

const useRemoteBytes = (local: LocalDriveFile | null, as: "blob" | "text") =>
    useAtomValue(remoteBytesQueryFamily({src: local && !local.file ? local.src : "", as}))

/** An object URL for `blob`, minted in an effect so a strict-mode remount never keeps a revoked one. */
export function useObjectUrl(blob: Blob | null): string | null {
    const [minted, setMinted] = useState<{blob: Blob; url: string} | null>(null)
    useEffect(() => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        setMinted({blob, url})
        return () => URL.revokeObjectURL(url)
    }, [blob])
    return minted && minted.blob === blob ? minted.url : null
}

/** A remote source's bytes as an object URL; a null `src` fetches nothing. Media plays from the
 * blob because the attachments endpoint ignores `Range`, and an `<audio>` or `<video>` pointed at
 * it never gets its metadata. */
export function useRemoteObjectUrl(src: string | null): {
    url: string | null
    isPending: boolean
    failed: boolean
} {
    const remote = useAtomValue(remoteBytesQueryFamily({src: src ?? "", as: "blob"}))
    const blob = remote.data instanceof Blob ? remote.data : null
    const url = useObjectUrl(blob)
    return {
        url,
        isPending: Boolean(src) && (remote.isPending || (blob !== null && !url)),
        failed: Boolean(src) && !remote.isPending && !blob,
    }
}

/** Streaming media source (image / audio / video): the local file's URL, a remote source's
 * fetched bytes, or mount media. */
export function useDriveMediaSrc(
    mount: Mount | null,
    path: string,
): {src: string | null; isPending: boolean; failed: boolean; onError: () => void} {
    const local = useLocalFile(path)
    const mountRes = useMountFileMediaSrc(mount, path)
    const remote = useRemoteObjectUrl(local && !local.file ? local.src : null)
    // A local source can still fail to decode (corrupt / unsupported) — surface it like a mount
    // error so the viewer shows its "couldn't load" card rather than a broken element.
    const [failedSrc, setFailedSrc] = useState<string | null>(null)
    if (!local) return mountRes
    const src = local.file ? local.src : remote.url
    const failed = remote.failed || (src !== null && failedSrc === src)
    return {
        src: failed ? null : src,
        isPending: remote.isPending,
        failed,
        onError: () => setFailedSrc(src),
    }
}

/** Object URL for a downloadable preview (PDF). A remote source is fetched: its endpoint may send
 * `Content-Disposition: attachment`, which an `<embed>` obeys. */
export function useDriveObjectUrl(
    mount: Mount | null,
    path: string,
): {url: string | null; isPending: boolean; failed: boolean} {
    const local = useLocalFile(path)
    const mountRes = useMountFileObjectUrl(mount, path)
    const remote = useRemoteObjectUrl(local && !local.file ? local.src : null)
    if (!local) return mountRes
    if (local.file) return {url: local.src, isPending: false, failed: false}
    return remote
}

/** Text content for the source-family bodies: the local file, the remote source, or the mount. */
export function useDriveFileText(
    mount: Mount | null,
    path: string,
): {data: string | undefined; isPending: boolean} {
    const local = useLocalFile(path)
    const mountQuery = useAtomValue(mountFileContentQueryFamily({mountId: mount?.id ?? "", path}))
    const remote = useRemoteBytes(local, "text")
    const file = local?.file
    const [text, setText] = useState<{file: File; text: string} | null>(null)
    useEffect(() => {
        if (!file) return
        let cancelled = false
        file.text()
            .then((t) => !cancelled && setText({file, text: t}))
            .catch(() => !cancelled && setText({file, text: ""}))
        return () => {
            cancelled = true
        }
    }, [file])
    if (file) {
        const data = text?.file === file ? text.text : undefined
        return {data, isPending: data === undefined}
    }
    if (local) {
        const data = typeof remote.data === "string" ? remote.data : undefined
        return {data, isPending: remote.isPending}
    }
    return {data: mountQuery.data as string | undefined, isPending: mountQuery.isPending}
}

/** Download action: saves the local source directly, or routes to the mount download. */
export function useDriveDownload(mount: Mount | null, path: string): () => void {
    const local = useLocalFile(path)
    const downloadFile = useDriveFileDownload()
    return useCallback(() => {
        if (local) {
            const a = document.createElement("a")
            a.href = local.src
            a.download = path.split("/").pop() || "file"
            a.hidden = true
            document.body.append(a)
            a.click()
            a.remove()
            return
        }
        void downloadFile(mount, path)
    }, [local, mount, path, downloadFile])
}
