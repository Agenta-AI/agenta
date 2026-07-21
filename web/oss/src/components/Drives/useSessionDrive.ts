import {useCallback, useMemo} from "react"

import {
    latestMountFilesQueryFamily,
    mountFilesQueryFamily,
    mountRootQueryFamily,
    sessionFileActivityAtomFamily,
    sessionMountsQueryFamily,
    sessionRecordFileRecencyAtomFamily,
    type Mount,
    type MountFile,
} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {agentMountQueryFamily} from "./agentDrive"
import {cleanPath, driveFileStats, isInternalDrivePath, relativeTime} from "./driveTree"

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
    /** `fileCount` is a floor (the count scan hit its cap on a very large tree) — show "N+". */
    fileCountCapped?: boolean
    totalSize: number
    /** Files ordered most-recently-touched first (signal-stamped first, then alpha). */
    recents: DriveRecentFile[]
    /** The most recent touch across the drive, for the `Updated {rel} · {n} files` summary. */
    lastTouchedAt: number | null
    summary: string
    /** No data to show YET — a blocking skeleton is appropriate. Goes false as soon as the FIRST
     * mount answers (files, empty, or error); the other may still be loading — see {@link reconciling}
     * / {@link isFetching}. The fast drive is never blocked on the slow one. */
    isLoading: boolean
    /** Past the initial blank: one drive has answered but a sibling is still catching up. Surfaces
     * keep the list (content + a "loading more" hint) instead of the terminal "No files" while data
     * is still arriving. Optional (the full drive omits it). */
    reconciling?: boolean
    /** A listing is still in flight even though some data may already be shown — for a subtle
     * "loading more" hint rather than a blocking skeleton. Covers in-place revalidation too (a
     * session-switch refetch over cached data). Optional (the full drive omits it). */
    isFetching?: boolean
    /** Listing (or mount discovery) failed with nothing to show — e.g. object store not configured.
     * Drives the inline error + Retry card. Session-side only in the summary (an agent-only failure
     * is {@link partialErrored} instead). */
    errored: boolean
    /** A mount failed but the drive still shows content (or only the per-artifact agent mount broke) —
     * so the inline list stays clean and the failure is surfaced as a warning indicator on the
     * drawer-trigger, with the retry handled inside the drawer. Optional (the full drive omits it). */
    partialErrored?: boolean
    /** Re-run the failed listing/count queries (for a retry affordance in the {@link errored} state).
     * Optional — provided by the summary hook; the full drive omits it. `isFetching` goes true while a
     * retry is in flight. */
    retry?: () => void
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
export function useSessionDrive(
    sessionId: string,
    artifactId?: string,
    /** Surface `.gitignore`d files too (the "show git-ignored files" toggle). Default false = the
     * curated view. Fetches the WHOLE ignored tree (node_modules, …) when on, so it's opt-in. */
    includeGitignored = false,
): SessionDriveData {
    const mountsQuery = useAtomValue(sessionMountsQueryFamily(sessionId))
    const mounts = mountsQuery.data ?? []
    const mount = mounts.find((m) => m.slug === "cwd") ?? mounts[0] ?? null

    const filesQuery = useAtomValue(
        mountFilesQueryFamily({mountId: mount?.id ?? "", includeGitignored}),
    )

    // Agent (durable) mount — keyed by artifact, not session. Its files are surfaced under
    // `agent-files/`. Queries stay disabled (empty key) when there's no artifact.
    const agentMountQuery = useAtomValue(agentMountQueryFamily(artifactId ?? ""))
    const agentMount = artifactId ? (agentMountQuery.data ?? null) : null
    const agentFilesQuery = useAtomValue(
        mountFilesQueryFamily({mountId: agentMount?.id ?? "", includeGitignored}),
    )

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

/** The summary surfaces show the latest 5 recent files. */
const SUMMARY_LATEST_LIMIT = 5

/**
 * Lightweight drive summary for the ALWAYS-MOUNTED chrome (chat rail, config Files section, runtime
 * lens). Its cost is CONSTANT — independent of how many files the mount holds:
 *
 *  - RECENTS come from the session RECORD LOG (`sessionRecordFileRecencyAtomFamily`) — the files the
 *    agent wrote/edited, already loaded for the transcript — so there is NO object-store scan to
 *    surface "what did I just work on". (A file the agent only READ, or a bulk `git clone` created
 *    via bash, won't appear here — those aren't in the records; the full browser still lists them.)
 *  - The COUNT is a BOUNDED `limit=0` scan per mount (`total`/`total_capped`): the backend stops
 *    after a cap and reports "N+", so the "N files" badge never blocks on enumerating a huge tree.
 *
 * Returns the same {@link SessionDriveData} shape so consumers are unchanged.
 */
export function useSessionDriveSummary(sessionId: string, artifactId?: string): SessionDriveData {
    const mountsQuery = useAtomValue(sessionMountsQueryFamily(sessionId))
    const mounts = mountsQuery.data ?? []
    const mount = mounts.find((m) => m.slug === "cwd") ?? mounts[0] ?? null

    const agentMountQuery = useAtomValue(agentMountQueryFamily(artifactId ?? ""))
    const agentMount = artifactId ? (agentMountQuery.data ?? null) : null

    // Recents: the agent's own write/edit events from the durable record log (0 object-store scan).
    const recordRecency = useAtomValue(sessionRecordFileRecencyAtomFamily(sessionId))

    // Does the record log hold ANY visible (non-internal) change? When it doesn't, the "recent
    // changes" list would be empty even though the drive has files — so fall back to the top-level
    // listing below. Computed here (cheap — records are few) to GATE that query off when records
    // already carry the list, so an active conversation pays nothing extra.
    const hasVisibleRecords = useMemo(
        () =>
            [...recordRecency.keys()].some((toolPath) => {
                const p = cleanPath(toolPath)
                return Boolean(p) && !isInternalDrivePath(p)
            }),
        [recordRecency],
    )

    // Count only (limit=0): a bounded scan → `total` (+ `total_capped` when it hit the cap).
    const cwdCount = useAtomValue(latestMountFilesQueryFamily({mountId: mount?.id ?? "", limit: 0}))
    const agentCount = useAtomValue(
        latestMountFilesQueryFamily({mountId: agentMount?.id ?? "", limit: 0}),
    )
    // Fallback list (depth=1, one delimiter call): the drive's TOP-LEVEL entries, so a conversation
    // that changed nothing still shows what's in the drive instead of an empty list. Disabled (empty
    // id) whenever the record log already has visible changes — no wasted request in the common case.
    const rootQuery = useAtomValue(mountRootQueryFamily(hasVisibleRecords ? "" : (mount?.id ?? "")))

    // Re-run the underlying queries (retry from the errored state). `refetch()` bypasses `enabled`
    // and DOES invoke the queryFn on the empty-id (disabled) queries, but each queryFn guards its id
    // (`if (!mountId) return null`, etc.) and returns without a request — so this only ever re-hits
    // what could actually load. `isFetching` reflects it in flight, driving the retry button's spinner.
    const retry = useCallback(() => {
        void mountsQuery.refetch?.()
        void cwdCount.refetch?.()
        void rootQuery.refetch?.()
        if (artifactId) {
            void agentMountQuery.refetch?.()
            void agentCount.refetch?.()
        }
    }, [mountsQuery, cwdCount, rootQuery, agentMountQuery, agentCount, artifactId])

    const data = useMemo(() => {
        // Newest write/edit per path (the map already dedups by path, keeping the latest timestamp).
        const recordRecents: DriveRecentFile[] = [...recordRecency.entries()]
            .map(([toolPath, at]) => ({path: cleanPath(toolPath), touchedAt: at}))
            .filter((f) => f.path && !isInternalDrivePath(f.path))
            .sort((a, b) =>
                b.touchedAt !== a.touchedAt
                    ? b.touchedAt - a.touchedAt
                    : a.path.localeCompare(b.path),
            )
            .slice(0, SUMMARY_LATEST_LIMIT)
        // No in-conversation changes → present the top-level entries (files carry the store mtime;
        // folders sort after, alphabetically) so the surface reflects the drive's real contents.
        const rootRecents: DriveRecentFile[] = (rootQuery.data ?? [])
            .filter((f) => !isInternalDrivePath(f.path))
            .map((f) => ({...f, touchedAt: typeof f.mtime === "number" ? f.mtime : undefined}))
            .sort((a, b) =>
                (b.touchedAt ?? 0) !== (a.touchedAt ?? 0)
                    ? (b.touchedAt ?? 0) - (a.touchedAt ?? 0)
                    : a.path.localeCompare(b.path),
            )
            .slice(0, SUMMARY_LATEST_LIMIT)
        const recents = recordRecents.length ? recordRecents : rootRecents
        const lastTouchedAt = recents.length ? (recents[0].touchedAt ?? null) : null

        const fileCount =
            (cwdCount.data?.total ?? 0) + (agentMount ? (agentCount.data?.total ?? 0) : 0)
        const fileCountCapped =
            Boolean(cwdCount.data?.totalCapped) ||
            (Boolean(agentMount) && Boolean(agentCount.data?.totalCapped))
        const countLabel = `${fileCount}${fileCountCapped ? "+" : ""}`

        const resolveMount = (path: string): ResolvedMountPath | null => {
            const rel = cleanPath(path)
            if (agentMount && (rel === AGENT_FILES_DIR || rel.startsWith(`${AGENT_FILES_DIR}/`))) {
                return {mount: agentMount, path: rel.slice(AGENT_FILES_DIR.length + 1)}
            }
            return mount ? {mount, path: rel} : null
        }

        // The two drives — the session cwd and the per-artifact agent mount — resolve INDEPENDENTLY,
        // and neither blocks the other: content shows the instant either side returns it, and the
        // slower side reconciles in afterward. So the flags below are framed around per-side
        // RESOLUTION, not a global "is anything fetching".
        //
        // A side is "still resolving" = in play (a session / an artifact was given) but it hasn't
        // produced its answer yet — neither data nor an error. `isPending` covers first-load mount
        // discovery; the `data === undefined` term covers the frame between the mount landing and its
        // count query flipping to fetching. A background REVALIDATION (data present, refetching) is NOT
        // resolving — it reconciles in place and only feeds the subtle `isFetching` hint below.
        const cwdResolving =
            Boolean(sessionId) &&
            (mountsQuery.isPending ||
                (Boolean(mount) && cwdCount.data === undefined && !cwdCount.isError))
        const agentResolving =
            Boolean(artifactId) &&
            (agentMountQuery.isPending ||
                (Boolean(agentMount) && agentCount.data === undefined && !agentCount.isError))

        const cwdInPlay = Boolean(sessionId)
        const agentInPlay = Boolean(artifactId)
        // Has at least one in-play side produced its answer (files, empty, or error)?
        const anyResolved = (cwdInPlay && !cwdResolving) || (agentInPlay && !agentResolving)
        const anyResolving = cwdResolving || agentResolving
        const hasContent = recents.length > 0 || fileCount > 0

        // "A request is in flight over data that may already be shown" — the subtle "Loading more…"
        // hint. Keyed on fetchStatus so a session-switch revalidation (cached data, refetching) still
        // surfaces it. Disabled queries (empty id) are idle and never count.
        const isFetching =
            mountsQuery.isFetching ||
            cwdCount.isFetching ||
            (Boolean(artifactId) && (agentMountQuery.isFetching || agentCount.isFetching)) ||
            rootQuery.isFetching

        // BLOCKING skeleton ONLY at the very start — before ANY in-play side has answered and with
        // nothing to show. The moment one side answers (or the record log yields recents), we drop the
        // skeleton and render what we have; the fast drive is never held hostage to the slow one.
        const isLoading = (cwdInPlay || agentInPlay) && !anyResolved && !hasContent
        // RECONCILING: past that initial blank, a sibling is still catching up. Surfaces keep the list
        // (whatever content is in + a "Loading more…" hint) instead of flashing the terminal "No files"
        // while data is still arriving. Distinct from `isFetching` (which also covers in-place
        // revalidation and the idle mount→count handoff frame).
        const reconciling = anyResolving && (anyResolved || hasContent)

        // Per-mount failure: the session cwd and the artifact-scoped agent mount fail independently.
        const sessionErrored =
            Boolean(sessionId) &&
            ((!mountsQuery.isPending && (mountsQuery.data === null || mountsQuery.isError)) ||
                (Boolean(mount) &&
                    !cwdCount.isPending &&
                    (cwdCount.data === null || cwdCount.isError)))
        const agentErrored =
            Boolean(artifactId) &&
            ((!agentMountQuery.isPending &&
                (agentMountQuery.data === null || agentMountQuery.isError)) ||
                (Boolean(agentMount) &&
                    !agentCount.isPending &&
                    (agentCount.data === null || agentCount.isError)))
        // TERMINAL error (the inline error + Retry card) means the SESSION (cwd) side failed with
        // nothing to show. An agent-only failure — or any failure with content still visible — is NOT
        // terminal: it falls through to the files/empty state so a working session is never masked.
        const errored = sessionErrored && fileCount === 0 && recents.length === 0
        // PARTIAL failure: a mount failed but we're NOT in the terminal card (there's content, or only
        // the agent side broke). The inline list stays clean; instead the drawer-trigger shows a quiet
        // warning indicator and the drawer itself offers the retry (see the drawer's partial banner).
        const partialErrored = (sessionErrored || agentErrored) && !errored

        const summary = isLoading
            ? "…"
            : errored
              ? "Unavailable"
              : fileCount === 0 && recents.length === 0
                ? "No files yet"
                : lastTouchedAt
                  ? `Updated ${relativeTime(lastTouchedAt)} · ${countLabel} file${fileCount === 1 && !fileCountCapped ? "" : "s"}`
                  : `${countLabel} file${fileCount === 1 && !fileCountCapped ? "" : "s"}`

        return {
            mount,
            files: recents,
            fileCount,
            fileCountCapped,
            totalSize: 0,
            recents,
            lastTouchedAt,
            summary,
            isLoading,
            reconciling,
            isFetching,
            errored,
            partialErrored,
            resolveMount,
        }
    }, [
        sessionId,
        artifactId,
        mount,
        agentMount,
        recordRecency,
        hasVisibleRecords,
        rootQuery.data,
        rootQuery.isPending,
        rootQuery.isFetching,
        cwdCount.data,
        cwdCount.isPending,
        cwdCount.isFetching,
        cwdCount.isError,
        agentCount.data,
        agentCount.isPending,
        agentCount.isFetching,
        agentCount.isError,
        agentMountQuery.data,
        agentMountQuery.isPending,
        agentMountQuery.isFetching,
        agentMountQuery.isError,
        mountsQuery.data,
        mountsQuery.isPending,
        mountsQuery.isFetching,
        mountsQuery.isError,
    ])

    return {...data, retry}
}
