/**
 * Tells a running app when files in its folder changed underneath it (an agent write, an upload)
 * and gives the host's `onWrite` the drive bump that keeps the Files pane honest.
 *
 * The drive has no generation counter: `useDriveGeneration` in FilesDrawer is a mount-SWAP key,
 * and what actually moves after a write is the per-directory listing query
 * (`mountDirQueryFamily`) once `refreshMountListing` invalidates it — every drive write, the
 * finished-turn revalidation and the upload path all go through that invalidation. So this hook
 * subscribes to the app dir's listing, snapshots `etag` (mtime, then size, until lane B's etag
 * ships) per path, and on a refetch NOT caused by the app's own write diffs the snapshot and
 * calls `host.notifyChanged` with the paths that moved, relative to the app dir.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {refreshMountListing, type HtmlAppHost} from "@agenta/entities/drive"
import {mountDirQueryFamily, type MountFile} from "@agenta/entities/session"
import {getHostQueryClient} from "@agenta/shared/api"
import {useAtomValue} from "jotai"

/** The bump behind the drive's listings: invalidate them (not the bodies — the app has the text). */
export const bumpDriveListing = (projectId: string): Promise<void> =>
    refreshMountListing(getHostQueryClient(), projectId, {contents: false})

const fingerprint = (file: MountFile & {etag?: string | null}): string =>
    file.etag ?? (file.mtime != null ? `m${file.mtime}` : `s${file.size ?? ""}`)

const relativeTo = (dir: string, path: string): string =>
    dir && path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path

export interface ChangedHintOptions {
    mountId: string | null
    projectId: string | null
    /** App dir, mount-relative. */
    dir: string
    host: HtmlAppHost | null
    /** Only while the app runs; off disables the listing subscription entirely. */
    enabled: boolean
}

export interface ChangedHint {
    /** Paths (relative to the app dir) from the most recent outside change; empty after `clear`. */
    changedPaths: string[]
    clear: () => void
    /** Wire as the host's `onWrite`: marks the next refetch as self-caused and bumps the listing. */
    onWrite: () => void
}

export function useChangedHint({mountId, projectId, dir, host, enabled}: ChangedHintOptions) {
    const active = enabled && !!mountId && !!projectId && !!host
    const listing = useAtomValue(mountDirQueryFamily({mountId: active ? mountId : "", path: dir}))
    const snapshot = useRef<Map<string, string> | null>(null)
    const ownWrite = useRef(false)
    const [changedPaths, setChangedPaths] = useState<string[]>([])

    // A new run starts from a clean snapshot: the first listing after mount seeds it.
    useEffect(() => {
        snapshot.current = null
        setChangedPaths([])
    }, [active, mountId, dir])

    useEffect(() => {
        if (!active || !listing.data) return
        const next = new Map<string, string>()
        for (const file of listing.data) {
            if (file.is_folder) continue
            next.set(relativeTo(dir, file.path), fingerprint(file))
        }
        const prev = snapshot.current
        snapshot.current = next
        const selfCaused = ownWrite.current
        ownWrite.current = false
        if (!prev || selfCaused) return

        const changed: string[] = []
        for (const [path, print] of next) if (prev.get(path) !== print) changed.push(path)
        for (const path of prev.keys()) if (!next.has(path)) changed.push(path)
        if (changed.length === 0) return
        host?.notifyChanged(changed)
        setChangedPaths(changed)
    }, [active, listing.data, dir, host])

    const onWrite = useCallback(() => {
        ownWrite.current = true
        if (projectId) void bumpDriveListing(projectId)
    }, [projectId])

    const clear = useCallback(() => setChangedPaths([]), [])

    return {changedPaths, clear, onWrite} satisfies ChangedHint
}
