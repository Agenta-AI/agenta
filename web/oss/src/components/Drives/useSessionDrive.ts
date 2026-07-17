import {useMemo} from "react"

import {
    mountFilesQueryFamily,
    sessionFileActivityAtomFamily,
    sessionMountsQueryFamily,
    sessionRecordFileRecencyAtomFamily,
    type Mount,
    type MountFile,
} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {agentMountQueryFamily} from "./agentDrive"
import {cleanPath, driveFileStats, relativeTime} from "./driveTree"

/** The agent's durable mount is symlinked into the session cwd under this name (runner:
 * `AGENT_FILES_LINK_NAME`). Its files live in a SEPARATE mount/prefix, so the drive folds them in
 * under this path — matching how the agent sees them on disk. */
export const AGENT_FILES_DIR = "agent-files"

/** Where a presented drive path comes from: the durable per-agent mount (`agent-files/…`, shared
 * across the agent's sessions) or the ephemeral session cwd. Drives it visually + the grid filter. */
export type FileOrigin = "session" | "agent"

/** Strip leading slashes only (linear scan, ReDoS-safe). Mirrors the package's `mountPathMatchesToolPath`
 * normalization of the mount side — it keeps any trailing slash, so folder-marker paths stay distinct. */
const stripLeadingSlashes = (s: string): string => {
    let i = 0
    while (i < s.length && s.charCodeAt(i) === 47) i++
    return i === 0 ? s : s.slice(i)
}

export const fileOrigin = (path: string): FileOrigin => {
    const rel = cleanPath(path)
    return rel === AGENT_FILES_DIR || rel.startsWith(`${AGENT_FILES_DIR}/`) ? "agent" : "session"
}

/** True when a listing holds BOTH agent and session files — the only time the origin tags/filter
 * carry information (a single-origin drive doesn't need them). */
export const driveHasMixedOrigins = (files: {path: string}[]): boolean => {
    let agent = false
    let session = false
    for (const f of files) {
        if (fileOrigin(f.path) === "agent") agent = true
        else session = true
        if (agent && session) return true
    }
    return false
}

export interface DriveRecentFile extends MountFile {
    /** Best-effort last-touched timestamp — from the file-activity signal log. The listing
     * carries NO mtime (backend ask: thread S3 LastModified through `MountFile`), so recency
     * exists only for files the agent touched while this browser watched. */
    touchedAt?: number
}

/** Which mount backs a presented drive path, and that path relative to the mount's own root. */
export interface ResolvedMountPath {
    mount: Mount
    path: string
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
    /** Map a presented path (as it appears in `files`/`recents`) to the mount + mount-relative path
     * that backs it — the cwd mount, or the nested `agent-files/` agent mount — for read/download. */
    resolveMount: (path: string) => ResolvedMountPath | null
}

/**
 * One data source for every session-drive surface (config row, drawer, chat rail/grid): the
 * primary (cwd) mount + its listing, PLUS the agent's durable mount folded in under `agent-files/`
 * (queried by `artifactId` — the agent mount is keyed by artifact, shared across the agent's
 * sessions). Enriched with recency from the per-session file-activity signals.
 */
export function useSessionDrive(sessionId: string, artifactId?: string): SessionDriveData {
    const mountsQuery = useAtomValue(sessionMountsQueryFamily(sessionId))
    const mounts = mountsQuery.data ?? []
    const mount = mounts.find((m) => m.slug === "cwd") ?? mounts[0] ?? null

    const filesQuery = useAtomValue(mountFilesQueryFamily(mount?.id ?? ""))

    // Agent (durable) mount — keyed by artifact, not session. Its files are surfaced under
    // `agent-files/`. Queries stay disabled (empty key) when there's no artifact.
    const agentMountQuery = useAtomValue(agentMountQueryFamily(artifactId ?? ""))
    const agentMount = artifactId ? (agentMountQuery.data ?? null) : null
    const agentFilesQuery = useAtomValue(mountFilesQueryFamily(agentMount?.id ?? ""))

    const activity = useAtomValue(sessionFileActivityAtomFamily(sessionId))
    // Durable, cross-device recency from the record log — the base layer under the live browser
    // activity below (which only sees THIS tab's turns). Without it, files created before this tab
    // opened (or on another device) have no timestamp and fall back to alpha order.
    const recordRecency = useAtomValue(sessionRecordFileRecencyAtomFamily(sessionId))

    // STRUCTURAL: the file listing, sizes, mount resolution and loading/error flags. This is the
    // expensive folder-inference work, so it depends ONLY on the listings/mounts — never on the
    // recency signals below. Without this split, every file-activity tick re-ran the whole tree
    // shaping and froze the main thread (issue #5367).
    const structural = useMemo(() => {
        const listing = filesQuery.data ?? null
        const cwdStats = driveFileStats(listing)
        const cwdFiles = cwdStats.files.filter((f) => cleanPath(f.path) !== AGENT_FILES_DIR)

        // Agent-mount files, presented under `agent-files/` so they read as a subfolder of cwd.
        const agentListing = agentFilesQuery.data ?? null
        const agentStats = driveFileStats(agentListing)
        const agentFiles = agentStats.files.map((f) => ({
            ...f,
            path: `${AGENT_FILES_DIR}/${cleanPath(f.path)}`,
        }))
        const files: MountFile[] = [...cwdFiles, ...agentFiles]

        // Index files by leading-stripped path so recency stamping matches tool paths by suffix in
        // O(segments) instead of rescanning every file per signal (the secondary O(n²)). Key exactly
        // as `mountPathMatchesToolPath` normalizes the mount side (leading-strip, trailing kept).
        const filesByPath = new Map<string, MountFile[]>()
        for (const f of files) {
            const key = stripLeadingSlashes(f.path)
            if (!key) continue
            const bucket = filesByPath.get(key)
            if (bucket) bucket.push(f)
            else filesByPath.set(key, [f])
        }

        const resolveMount = (path: string): ResolvedMountPath | null => {
            const rel = cleanPath(path)
            if (agentMount && (rel === AGENT_FILES_DIR || rel.startsWith(`${AGENT_FILES_DIR}/`))) {
                return {mount: agentMount, path: rel.slice(AGENT_FILES_DIR.length + 1)}
            }
            return mount ? {mount, path: rel} : null
        }

        // Disabled queries (no session) stay isPending forever — an empty id means "no drive",
        // not "loading". The agent mount is optional: it only contributes loading/error when an
        // artifact was supplied AND a mount resolved.
        // The agent mount is artifact-scoped, so it loads (and shows files) with no session at all.
        const agentPending =
            Boolean(artifactId) &&
            (agentMountQuery.isPending || Boolean(agentMount && agentFilesQuery.isPending))
        const isLoading =
            (Boolean(sessionId) &&
                (mountsQuery.isPending || Boolean(mount && filesQuery.isPending))) ||
            agentPending
        // The session cwd mount and the artifact-scoped agent mount fail independently — mirror the
        // `isLoading` split above so an agent-mount failure surfaces as an error even with no session
        // (otherwise the drive reads as an empty "No files yet" instead of the real failure).
        const sessionErrored =
            Boolean(sessionId) &&
            ((!mountsQuery.isPending && (mountsQuery.data === null || mountsQuery.isError)) ||
                (Boolean(mount) &&
                    !filesQuery.isPending &&
                    (listing === null || filesQuery.isError)))
        const agentErrored =
            Boolean(artifactId) &&
            ((!agentMountQuery.isPending &&
                (agentMountQuery.data === null || agentMountQuery.isError)) ||
                (Boolean(agentMount) &&
                    !agentFilesQuery.isPending &&
                    (agentListing === null || agentFilesQuery.isError)))
        const errored = sessionErrored || agentErrored

        const totalSize = cwdStats.totalSize + agentStats.totalSize

        return {mount, files, filesByPath, resolveMount, totalSize, isLoading, errored}
    }, [
        sessionId,
        artifactId,
        mount,
        agentMount,
        filesQuery.data,
        filesQuery.isPending,
        filesQuery.isError,
        agentFilesQuery.data,
        agentFilesQuery.isPending,
        agentFilesQuery.isError,
        agentMountQuery.data,
        agentMountQuery.isPending,
        agentMountQuery.isError,
        mountsQuery.data,
        mountsQuery.isPending,
        mountsQuery.isError,
    ])

    // RECENCY: ordering by last-touched. Recomputes on every activity/record tick, but stays O(n)
    // (base mtime pass) + O(signals · path segments) via the `filesByPath` index — never touching
    // the structural folder-inference work above.
    const {recents, lastTouchedAt} = useMemo(() => {
        const {files, filesByPath} = structural
        // Base recency = the object store's mtime — covers files made ANY way (bash-run scripts,
        // uploads, Write tools). The tool-event signals below can only raise it (Math.max).
        const touchedAt = new Map<string, number>()
        for (const file of files) {
            if (typeof file.mtime === "number") touchedAt.set(file.path, file.mtime)
        }
        // Newest signal wins per file; matching is tail-based (tool paths are sandbox-absolute or
        // cwd-relative). A tool path matches a file when the file's cleaned path equals the tool
        // path or is a `/`-boundary suffix of it — so we look up exactly those suffixes.
        const stamp = (toolPath: string, at: number) => {
            const tool = cleanPath(toolPath)
            if (!tool) return
            const apply = (key: string) => {
                const bucket = filesByPath.get(key)
                if (!bucket) return
                for (const f of bucket) {
                    touchedAt.set(f.path, Math.max(touchedAt.get(f.path) ?? 0, at))
                }
            }
            apply(tool)
            for (let i = tool.indexOf("/"); i !== -1; i = tool.indexOf("/", i + 1)) {
                apply(tool.slice(i + 1))
            }
        }
        for (const [toolPath, at] of recordRecency) stamp(toolPath, at)
        for (const entry of activity) stamp(entry.path, entry.at)
        const ordered: DriveRecentFile[] = [...files]
            .map((f) => ({...f, touchedAt: touchedAt.get(f.path)}))
            .sort((a, b) =>
                (b.touchedAt ?? 0) !== (a.touchedAt ?? 0)
                    ? (b.touchedAt ?? 0) - (a.touchedAt ?? 0)
                    : a.path.localeCompare(b.path),
            )
        return {
            recents: ordered,
            lastTouchedAt: ordered.length ? (ordered[0].touchedAt ?? null) : null,
        }
    }, [structural, activity, recordRecency])

    return useMemo(() => {
        const {mount: primaryMount, files, totalSize, resolveMount, isLoading, errored} = structural
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
            mount: primaryMount,
            files,
            fileCount: files.length,
            totalSize,
            recents,
            lastTouchedAt,
            summary,
            isLoading,
            errored,
            resolveMount,
        }
    }, [structural, recents, lastTouchedAt])
}
