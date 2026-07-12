import {useMemo} from "react"

import {
    mountFilesQueryFamily,
    mountPathMatchesToolPath,
    sessionFileActivityAtomFamily,
    sessionMountsQueryFamily,
    type Mount,
    type MountFile,
} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {driveFiles, driveTotalSize, relativeTime} from "./driveTree"

export interface DriveRecentFile extends MountFile {
    /** Best-effort last-touched timestamp — from the file-activity signal log. The listing
     * carries NO mtime (backend ask: thread S3 LastModified through `MountFile`), so recency
     * exists only for files the agent touched while this browser watched. */
    touchedAt?: number
}

export interface SessionDriveData {
    /** The session's primary drive (slug `cwd`, else the first mount). */
    mount: Mount | null
    files: MountFile[]
    fileCount: number
    totalSize: number
    /** Files ordered most-recently-touched first (signal-stamped first, then alpha). */
    recents: DriveRecentFile[]
    /** The most recent touch across the drive, for the `Updated {rel} · {n} files` summary. */
    lastTouchedAt: number | null
    summary: string
    isLoading: boolean
    /** Listing (or mount discovery) failed — e.g. object store not configured. */
    errored: boolean
}

/**
 * One data source for every session-drive surface (config row, drawer, chat rail/grid): the
 * primary mount + its listing from the centralized mount atoms, enriched with recency from the
 * per-session file-activity signals.
 */
export function useSessionDrive(sessionId: string): SessionDriveData {
    const mountsQuery = useAtomValue(sessionMountsQueryFamily(sessionId))
    const mounts = mountsQuery.data ?? []
    const mount = mounts.find((m) => m.slug === "cwd") ?? mounts[0] ?? null

    const filesQuery = useAtomValue(mountFilesQueryFamily(mount?.id ?? ""))
    const activity = useAtomValue(sessionFileActivityAtomFamily(sessionId))

    return useMemo(() => {
        const listing = filesQuery.data ?? null
        const files = driveFiles(listing)

        // Newest signal wins per file; matching is tail-based (tool paths are absolute/relative).
        const touchedAt = new Map<string, number>()
        for (const entry of activity) {
            for (const file of files) {
                if (mountPathMatchesToolPath(file.path, entry.path)) {
                    touchedAt.set(file.path, Math.max(touchedAt.get(file.path) ?? 0, entry.at))
                }
            }
        }
        const recents: DriveRecentFile[] = [...files]
            .map((f) => ({...f, touchedAt: touchedAt.get(f.path)}))
            .sort((a, b) =>
                (b.touchedAt ?? 0) !== (a.touchedAt ?? 0)
                    ? (b.touchedAt ?? 0) - (a.touchedAt ?? 0)
                    : a.path.localeCompare(b.path),
            )
        const lastTouchedAt = recents.length ? (recents[0].touchedAt ?? null) : null

        const isLoading = mountsQuery.isPending || Boolean(mount && filesQuery.isPending)
        const errored =
            (!mountsQuery.isPending && (mountsQuery.data === null || mountsQuery.isError)) ||
            (Boolean(mount) && !filesQuery.isPending && (listing === null || filesQuery.isError))

        const summary = isLoading
            ? "…"
            : errored
              ? "Unavailable"
              : files.length === 0
                ? "No files yet"
                : lastTouchedAt
                  ? `Updated ${relativeTime(lastTouchedAt)} · ${files.length} file${files.length === 1 ? "" : "s"}`
                  : `${files.length} file${files.length === 1 ? "" : "s"}`

        return {
            mount,
            files,
            fileCount: files.length,
            totalSize: driveTotalSize(listing),
            recents,
            lastTouchedAt,
            summary,
            isLoading,
            errored,
        }
    }, [
        mount,
        filesQuery.data,
        filesQuery.isPending,
        filesQuery.isError,
        mountsQuery.data,
        mountsQuery.isPending,
        mountsQuery.isError,
        activity,
    ])
}
