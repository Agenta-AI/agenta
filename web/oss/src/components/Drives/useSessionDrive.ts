import {useMemo} from "react"

import {
    mountFilesQueryFamily,
    mountPathMatchesToolPath,
    sessionFileActivityAtomFamily,
    sessionMountsQueryFamily,
    sessionRecordFileRecencyAtomFamily,
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
    // Durable, cross-device recency from the record log — the base layer under the live browser
    // activity below (which only sees THIS tab's turns). Without it, files created before this tab
    // opened (or on another device) have no timestamp and fall back to alpha order.
    const recordRecency = useAtomValue(sessionRecordFileRecencyAtomFamily(sessionId))

    return useMemo(() => {
        const listing = filesQuery.data ?? null
        const files = driveFiles(listing)

        // Newest signal wins per file; matching is tail-based (tool paths are absolute/relative).
        // Seed from the durable record log first, then let the live browser activity (fresher, same
        // turn) raise it — Math.max folds both without double-counting.
        const touchedAt = new Map<string, number>()
        const stamp = (toolPath: string, at: number) => {
            for (const file of files) {
                if (mountPathMatchesToolPath(file.path, toolPath)) {
                    touchedAt.set(file.path, Math.max(touchedAt.get(file.path) ?? 0, at))
                }
            }
        }
        for (const [toolPath, at] of recordRecency) stamp(toolPath, at)
        for (const entry of activity) stamp(entry.path, entry.at)
        const recents: DriveRecentFile[] = [...files]
            .map((f) => ({...f, touchedAt: touchedAt.get(f.path)}))
            .sort((a, b) =>
                (b.touchedAt ?? 0) !== (a.touchedAt ?? 0)
                    ? (b.touchedAt ?? 0) - (a.touchedAt ?? 0)
                    : a.path.localeCompare(b.path),
            )
        const lastTouchedAt = recents.length ? (recents[0].touchedAt ?? null) : null

        // Disabled queries (no session) stay isPending forever — an empty id means "no drive",
        // not "loading".
        const isLoading =
            Boolean(sessionId) && (mountsQuery.isPending || Boolean(mount && filesQuery.isPending))
        const errored =
            Boolean(sessionId) &&
            ((!mountsQuery.isPending && (mountsQuery.data === null || mountsQuery.isError)) ||
                (Boolean(mount) &&
                    !filesQuery.isPending &&
                    (listing === null || filesQuery.isError)))

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
        sessionId,
        mount,
        filesQuery.data,
        filesQuery.isPending,
        filesQuery.isError,
        mountsQuery.data,
        mountsQuery.isPending,
        mountsQuery.isError,
        activity,
        recordRecency,
    ])
}
