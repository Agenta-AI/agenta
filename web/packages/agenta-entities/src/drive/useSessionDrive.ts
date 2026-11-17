import {useCallback, useMemo} from "react"

import {atom, useAtomValue} from "jotai"

import {
    drivePathFromToolPath,
    latestMountFilesQueryFamily,
    mountDirQueryFamily,
    mountFilesQueryFamily,
    mountRootQueryFamily,
    pickCwdMount,
    sessionFileActivityAtomFamily,
    sessionMountsQueryFamily,
    sessionRecordFileRecencyAtomFamily,
    type DriveToolPath,
    type Mount,
    type MountFile,
} from "@agenta/entities/session"

import {
    agentDrivesStateAtom,
    DRIVES_DIR,
    driveDir,
    resolveDrivePath,
    type AgentDrivesState,
    type Drive,
    type DriveEntry,
} from "./drives"
import {
    cleanPath,
    driveFileStats,
    isHiddenPath,
    isInternalDrivePath,
    relativeTime,
} from "./driveTree"

/** The home drive is linked into the session cwd under this name (runner: `HOME_DRIVE_LINK_NAME`).
 * Its files live in a SEPARATE mount/prefix, so the drive folds them in under this path — matching
 * how the agent sees them on disk. */
export const AGENT_FILES_DIR = "agent-files"

/** Where a presented drive path comes from: the home drive (`agent-files/…`, kept across the
 * agent's sessions), another drive (`drives/<slug>/…`) or the session cwd. Drives it visually +
 * the grid filter. */
export type FileOrigin = "session" | "home" | "drive"

/** Strip leading slashes only (linear scan, ReDoS-safe). Mirrors the package's `mountPathMatchesToolPath`
 * normalization of the mount side — it keeps any trailing slash, so folder-marker paths stay distinct. */
const stripLeadingSlashes = (s: string): string => {
    let i = 0
    while (i < s.length && s.charCodeAt(i) === 47) i++
    return i === 0 ? s : s.slice(i)
}

/** Drop an `agent-files/` fold prefix when a path still carries one — a home-only drive presents
 * the home mount at its root, but a record-log or chat path may still name the fold. Skipped when
 * the mount owns a real top-level `agent-files` entry: there the prefix is the file's own name, and
 * unfolding it would resolve the directory to the mount root and its children to the wrong paths. */
const unfoldAgentPath = (rel: string, agentOwnsFold = false): string => {
    if (agentOwnsFold) return rel
    if (rel === AGENT_FILES_DIR) return ""
    return rel.startsWith(`${AGENT_FILES_DIR}/`) ? rel.slice(AGENT_FILES_DIR.length + 1) : rel
}

/** Does this mount hold a real top-level `agent-files` entry (which the fold prefix would shadow)? */
const ownsAgentFilesEntry = (paths: readonly string[]): boolean =>
    paths.some((p) => {
        const rel = cleanPath(p)
        return rel === AGENT_FILES_DIR || rel.startsWith(`${AGENT_FILES_DIR}/`)
    })

/** The session's drives, by slug: only `drives/<configured slug>` is a drive path. */
type DriveSlugs = readonly {slug: string}[]

export const fileOrigin = (path: string, drives: DriveSlugs = []): FileOrigin => {
    const rel = cleanPath(path)
    if (rel === AGENT_FILES_DIR || rel.startsWith(`${AGENT_FILES_DIR}/`)) return "home"
    return resolveDrivePath(rel, drives) ? "drive" : "session"
}

/**
 * The presented path of a tool path's file: a home drive file under `agent-files/` (or `homePrefix`),
 * another drive's under `drives/<slug>/`, a session file as it is.
 */
export const presentToolPath = (
    tool: DriveToolPath,
    homeSlug: string | null = null,
    homePrefix = `${AGENT_FILES_DIR}/`,
): string => {
    if (tool.origin === "home" || (tool.origin === "drive" && tool.slug === homeSlug))
        return `${homePrefix}${tool.path}`
    if (tool.origin === "drive" && tool.slug) return `${driveDir(tool.slug)}/${tool.path}`
    return tool.path
}

/**
 * A presented path inside one of the session's drives, mapped to that drive's mount. A read drive
 * answers `readOnly`, so no surface offers a write there. A path under a configured drive whose
 * mount is not resolved (lookup pending, failed, or a drive the viewer may not use) answers null:
 * no target at all, never the session folder. `undefined`: the path is not a drive path.
 */
export const resolveDriveMount = (
    path: string,
    drives: readonly Drive[],
    configured: DriveSlugs = drives,
): ResolvedMountPath | null | undefined => {
    const hit = resolveDrivePath(path, drives)
    if (hit) return {mount: hit.drive.mount, path: hit.path, readOnly: hit.drive.access === "read"}
    return resolveDrivePath(path, configured) ? null : undefined
}

/** Present a drive's mount-relative entries under its `drives/<slug>/` folder. */
export const foldDriveFiles = (drive: Drive, files: readonly MountFile[]): MountFile[] =>
    files.map((f) => ({...f, path: `${driveDir(drive.slug)}/${cleanPath(f.path)}`}))

/**
 * Does this path belong in a user-facing drive list? ONE question, asked by every list a drive
 * surface builds AND by the gate that decides whether a list is empty — so a gate can never keep a
 * row a list then drops (the bug class behind #5480).
 *
 * Excluded: runner plumbing ({@link isInternalDrivePath}), the bare `agent-files` entry and each
 * bare `drives/<slug>` entry — those are the fold-point SYMLINKS into the drives, not files. Their
 * CONTENTS are listed, folded in from the mounts themselves; the markers never are.
 *
 * That exclusion is about PROVENANCE, not the name: the markers only exist in the SESSION mount.
 * Inside a drive's mount, the same paths are ordinary entries a user is free to create, so a
 * caller listing such a mount's entries passes `fromDriveMount` and keeps them — otherwise the
 * folder vanishes from the root listing while the file count still counts what is inside it.
 */
export interface DrivePathOptions {
    fromDriveMount?: boolean
    /** The session's configured drives: their `drives/<slug>` links are markers, not files. */
    drives?: DriveSlugs
}

export const isListableDrivePath = (path: string, opts?: DrivePathOptions): boolean => {
    const rel = cleanPath(path)
    if (!rel || isInternalDrivePath(rel)) return false
    if (opts?.fromDriveMount === true) return true
    return rel !== AGENT_FILES_DIR && !isDriveLink(rel, opts?.drives)
}

/** A `drives/<slug>` entry itself, for a configured slug: the session folder's link to that drive. */
export const isDriveLink = (path: string, drives: DriveSlugs = []): boolean =>
    resolveDrivePath(path, drives)?.path === ""

/** {@link isListableDrivePath} minus hidden paths; the explorer asks the wider one (#6027). */
export const isSummaryDrivePath = (path: string, opts?: DrivePathOptions): boolean =>
    isListableDrivePath(path, opts) && !isHiddenPath(path)

/** True when a listing holds BOTH session files and durable (drive) files — the only time the
 * origin tags/filter carry information (a single-origin drive doesn't need them). */
export const driveHasMixedOrigins = (files: {path: string}[], drives: DriveSlugs = []): boolean => {
    let durable = false
    let session = false
    for (const f of files) {
        if (fileOrigin(f.path, drives) === "session") session = true
        else durable = true
        if (durable && session) return true
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
    /** The path is on a drive attached read-only. */
    readOnly?: boolean
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
     * that backs it — the cwd mount, the home drive under `agent-files/`, or a drive under
     * `drives/<slug>/` — for read/download. */
    resolveMount: (path: string) => ResolvedMountPath | null
    /** The session's drives with an active mount, folded in under `drives/<slug>/` (not the home). */
    drives?: Drive[]
    /** Every drive the configuration names, the home included: the session's `drives/<slug>`
     * links, which are markers and never session files. */
    configuredDrives?: DriveEntry[]
    /** The configured home drive's slug: a tool path under it presents under `agent-files/`. */
    homeSlug?: string | null
}

const NO_DRIVES: Drive[] = []
const NO_ENTRIES: DriveEntry[] = []

/**
 * One data source for every session-drive surface (config row, drawer, chat rail/grid): the
 * primary (cwd) mount + its listing, PLUS the drives of the agent's configuration — the home drive
 * folded in under `agent-files/`, every other drive under `drives/<slug>/`. A configuration without
 * a `drives` list folds the agent's drive found by `artifactId` as its home. Enriched with recency
 * from the per-session file-activity signals.
 */
export function useSessionDrive(
    sessionId: string,
    artifactId?: string,
    /** Surface `.gitignore`d files too (the "show git-ignored files" toggle). Default false = the
     * curated view. Fetches the WHOLE ignored tree (node_modules, …) when on, so it's opt-in. */
    includeGitignored = false,
    /** The revision the session runs: its `drives` list names the drives to fold in. */
    revisionId?: string,
): SessionDriveData {
    const mountsQuery = useAtomValue(sessionMountsQueryFamily(sessionId))
    const mounts = mountsQuery.data ?? []
    const mount = pickCwdMount(mounts)

    const filesQuery = useAtomValue(
        mountFilesQueryFamily({mountId: mount?.id ?? "", includeGitignored}),
    )

    // The configuration's drives. The home drive's files are surfaced under `agent-files/`; queries
    // stay disabled (empty key) when there's no home drive.
    const drivesState = useAtomValue(agentDrivesStateAtom(revisionId, artifactId))
    const agentMount = drivesState.home
    const agentFilesQuery = useAtomValue(
        mountFilesQueryFamily({mountId: agentMount?.id ?? "", includeGitignored}),
    )
    const drives = drivesState.drives
    const configured = drivesState.configured
    const driveListingsAtom = useMemo(
        () =>
            atom((get) =>
                drives.map((d) =>
                    get(mountFilesQueryFamily({mountId: d.mount.id, includeGitignored})),
                ),
            ),
        [drives, includeGitignored],
    )
    const driveListings = useAtomValue(driveListingsAtom)

    // Agent-only drive: the agent mount IS the drive, at its own root. That covers an overview
    // surface (no conversation) AND a session that resolved without a cwd mount — nothing has run in
    // it yet. The `agent-files/` fold needs a cwd to fold INTO; without one the root resolves to no
    // mount, so the lazy explorer subscribes to nothing and browses an empty tree. Gated on the mounts
    // query having ANSWERED so the presentation doesn't flip once a cwd mount appears mid-load.
    // Kept identical to `useSessionDriveSummary`'s predicate — the two must agree.
    const agentOnly = Boolean(agentMount) && !mount && (!sessionId || !mountsQuery.isPending)

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
        // The cwd holds only the link to each drive; its files come from the drive below.
        const cwdFiles = cwdStats.files.filter(
            (f) => isListableDrivePath(f.path) && !resolveDrivePath(f.path, configured),
        )

        // Agent-mount files, presented under `agent-files/` so they read as a subfolder of cwd — or at
        // the root when the agent mount is the whole drive.
        const agentListing = agentFilesQuery.data ?? null
        const agentStats = driveFileStats(agentListing)
        const agentPrefix = agentOnly ? "" : `${AGENT_FILES_DIR}/`
        const agentOwnsFold = agentOnly && ownsAgentFilesEntry(agentStats.files.map((f) => f.path))
        const agentFiles = agentStats.files.map((f) => ({
            ...f,
            path: `${agentPrefix}${cleanPath(f.path)}`,
        }))
        const driveStats = drives.map((d, i) => ({
            drive: d,
            stats: driveFileStats(driveListings[i]?.data ?? null),
        }))
        const driveFiles = driveStats.flatMap(({drive, stats}) =>
            foldDriveFiles(drive, stats.files),
        )
        const files: MountFile[] = [...cwdFiles, ...agentFiles, ...driveFiles]

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
            const linked = resolveDriveMount(rel, drivesState.linked, configured)
            if (linked !== undefined) return linked
            if (agentOnly)
                return agentMount
                    ? {mount: agentMount, path: unfoldAgentPath(rel, agentOwnsFold)}
                    : null
            if (agentMount && (rel === AGENT_FILES_DIR || rel.startsWith(`${AGENT_FILES_DIR}/`))) {
                return {mount: agentMount, path: rel.slice(AGENT_FILES_DIR.length + 1)}
            }
            return mount ? {mount, path: rel} : null
        }

        // Disabled queries (no session) stay isPending forever — an empty id means "no drive",
        // not "loading". The drives are agent-scoped, so they load (and show files) with no
        // session at all.
        const agentPending = Boolean(agentMount && agentFilesQuery.isPending)
        const drivesPending = drivesState.isPending || driveListings.some((q) => q.isPending)
        const isLoading =
            (Boolean(sessionId) &&
                (mountsQuery.isPending || Boolean(mount && filesQuery.isPending))) ||
            agentPending ||
            drivesPending
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
            Boolean(agentMount) &&
            !agentFilesQuery.isPending &&
            (agentListing === null || agentFilesQuery.isError)
        // A failed drive lookup or listing reads as a failure, not as an empty drive.
        const drivesErrored =
            drivesState.isError ||
            driveListings.some((q) => q.isError || (!q.isPending && q.data === null))
        const errored = sessionErrored || agentErrored || drivesErrored

        const totalSize =
            cwdStats.totalSize +
            agentStats.totalSize +
            driveStats.reduce((sum, {stats}) => sum + stats.totalSize, 0)

        return {
            mount: agentOnly ? agentMount : mount,
            files,
            filesByPath,
            resolveMount,
            totalSize,
            isLoading,
            errored,
        }
    }, [
        sessionId,
        agentOnly,
        mount,
        agentMount,
        drives,
        configured,
        drivesState,
        driveListings,
        filesQuery.data,
        filesQuery.isPending,
        filesQuery.isError,
        agentFilesQuery.data,
        agentFilesQuery.isPending,
        agentFilesQuery.isError,
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
            drives: drives.length ? drives : NO_DRIVES,
            configuredDrives: configured.length ? configured : NO_ENTRIES,
            homeSlug: drivesState.homeSlug,
        }
    }, [structural, recents, lastTouchedAt, drives, configured, drivesState.homeSlug])
}

interface CountQuery {
    data?: {total: number; totalCapped: boolean} | null
    isPending: boolean
    isFetching: boolean
    isError: boolean
}

/**
 * The drives' share of a drive summary (the home drive aside): their file count, and whether the
 * lookup or any count is still resolving or failed. A failed request answers null, which is a
 * failure, not an empty drive, so the summary flags it as a partial error and its retry reruns it.
 */
export const summarizeDrives = (
    lookup: Pick<AgentDrivesState, "isPending" | "isFetching" | "isError">,
    counts: readonly CountQuery[],
) => ({
    fileCount: counts.reduce((sum, q) => sum + (q.data?.total ?? 0), 0),
    fileCountCapped: counts.some((q) => Boolean(q.data?.totalCapped)),
    resolving: lookup.isPending || counts.some((q) => q.data === undefined && !q.isError),
    isFetching: lookup.isFetching || counts.some((q) => q.isFetching),
    errored: lookup.isError || counts.some((q) => !q.isPending && (q.data === null || q.isError)),
})

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
 * Counts and lists exclude hidden paths (see {@link isSummaryDrivePath}).
 *
 * Returns the same {@link SessionDriveData} shape so consumers are unchanged.
 */
export function useSessionDriveSummary(
    sessionId: string,
    artifactId?: string,
    /** The revision the session runs: its `drives` list names the drives to fold in. */
    revisionId?: string,
): SessionDriveData {
    const mountsQuery = useAtomValue(sessionMountsQueryFamily(sessionId))
    const mounts = mountsQuery.data ?? []
    const mount = pickCwdMount(mounts)

    const drivesState = useAtomValue(agentDrivesStateAtom(revisionId, artifactId))
    const agentMount = drivesState.home
    const drives = drivesState.drives
    const configured = drivesState.configured

    // The agent mount is the WHOLE drive: no session, or a session that resolved without a cwd mount
    // (nothing has run in it yet). Folding under `agent-files/` needs a cwd to fold into — without one
    // the root resolves to no mount and the explorer browses an empty tree. Gated on the mounts query
    // having ANSWERED so the presentation doesn't flip once a cwd mount appears mid-load.
    const agentOnly = Boolean(agentMount) && !mount && (!sessionId || !mountsQuery.isPending)

    // Recents: the agent's own write/edit events from the durable record log (0 object-store scan).
    const recordRecency = useAtomValue(sessionRecordFileRecencyAtomFamily(sessionId))

    // The record log's tool paths AS DRIVE PATHS: sandbox workspace root stripped, mount origin
    // tagged, anything naming no drive file dropped (see `drivePathFromToolPath`). Filtered on the
    // mount-relative path, before the fold prefix, exactly as the root listing filters its own.
    // ONE derivation, shared with the gate below, so the gate can't withhold the root-listing
    // fallback over a row the list then drops.
    const recordFiles = useMemo(
        () =>
            [...recordRecency.entries()]
                .map(([toolPath, at]) => ({resolved: drivePathFromToolPath(toolPath), at}))
                .filter(
                    (entry): entry is {resolved: DriveToolPath; at: number} =>
                        entry.resolved !== null &&
                        isSummaryDrivePath(entry.resolved.path, {
                            fromDriveMount: entry.resolved.origin !== "session",
                            drives: configured,
                        }),
                ),
        [recordRecency, configured],
    )
    // Does the record log hold ANY change this surface would actually LIST? When it doesn't, the
    // "recent changes" list would be empty even though the drive has files — so fall back to the
    // top-level listing below. Computed here (cheap — records are few) to GATE the queries off when
    // records already carry the list, so an active conversation pays nothing extra.
    const hasVisibleRecords = recordFiles.length > 0

    // Count only (limit=0): a bounded scan → `total` (+ `total_capped` when it hit the cap).
    const cwdCount = useAtomValue(latestMountFilesQueryFamily({mountId: mount?.id ?? "", limit: 0}))
    const agentCount = useAtomValue(
        latestMountFilesQueryFamily({mountId: agentMount?.id ?? "", limit: 0}),
    )
    // Fallback list (depth=1, one delimiter call per mount): the drive's TOP-LEVEL entries, so a
    // conversation that changed nothing still shows what's in the drive instead of an empty list.
    // BOTH mounts, mirroring the full drive: the cwd root alone would show the `agent-files` symlink
    // and nothing behind it, so dropping that marker (see {@link isListableDrivePath}) has to come
    // with listing the agent mount it stands for — otherwise the fold's files vanish from the summary
    // entirely (#5480). Disabled (empty id) whenever the record log already has listable changes —
    // no wasted request in the common case.
    const rootQuery = useAtomValue(mountRootQueryFamily(hasVisibleRecords ? "" : (mount?.id ?? "")))
    const agentRootQuery = useAtomValue(
        mountRootQueryFamily(hasVisibleRecords ? "" : (agentMount?.id ?? "")),
    )
    // Each other drive: its bounded count, and its top-level entries for the same fallback list.
    const driveSummaryAtom = useMemo(
        () =>
            atom((get) =>
                drives.map((d) => ({
                    drive: d,
                    count: get(latestMountFilesQueryFamily({mountId: d.mount.id, limit: 0})),
                    root: get(mountRootQueryFamily(hasVisibleRecords ? "" : d.mount.id)),
                })),
            ),
        [drives, hasVisibleRecords],
    )
    const driveSummary = useAtomValue(driveSummaryAtom)
    // The cwd count is the store's, so it counts the `drives/<slug>` links; list that one folder to
    // take them out. Only when the revision names drives, so a session without any pays nothing.
    const cwdLinksQuery = useAtomValue(
        mountDirQueryFamily({
            mountId: configured.length ? (mount?.id ?? "") : "",
            path: DRIVES_DIR,
        }),
    )

    // Re-run the underlying queries (retry from the errored state). `refetch()` bypasses `enabled`
    // and DOES invoke the queryFn on the empty-id (disabled) queries, but each queryFn guards its id
    // (`if (!mountId) return null`, etc.) and returns without a request — so this only ever re-hits
    // what could actually load. `isFetching` reflects it in flight, driving the retry button's spinner.
    const retry = useCallback(() => {
        void mountsQuery.refetch?.()
        void cwdCount.refetch?.()
        void rootQuery.refetch?.()
        drivesState.refetch()
        if (agentMount) {
            void agentCount.refetch?.()
            void agentRootQuery.refetch?.()
        }
        for (const {count, root} of driveSummary) {
            void count.refetch?.()
            void root.refetch?.()
        }
    }, [
        mountsQuery,
        cwdCount,
        rootQuery,
        agentMount,
        agentCount,
        agentRootQuery,
        drivesState,
        driveSummary,
    ])

    const data = useMemo(() => {
        // Both lists below present an agent-mount path the way the full drive does — folded under
        // `agent-files/`, or at the root when the agent mount IS the drive; `resolveMount` maps
        // either back to the mount it came from.
        const agentPrefix = agentOnly ? "" : `${AGENT_FILES_DIR}/`
        const agentOwnsFold =
            agentOnly && ownsAgentFilesEntry((agentRootQuery.data ?? []).map((f) => f.path))
        // Newest write/edit per path. The record map dedups by TOOL path, and one file can be named
        // by more than one of those (`notes.md` from a cwd-relative call, `/tmp/agenta/…/notes.md`
        // from an absolute one) — so re-dedup on the resolved drive path, newest touch winning.
        const touchedAt = new Map<string, number>()
        for (const {resolved, at} of recordFiles) {
            const path = presentToolPath(resolved, drivesState.homeSlug, agentPrefix)
            touchedAt.set(path, Math.max(touchedAt.get(path) ?? 0, at))
        }
        const recordRecents: DriveRecentFile[] = [...touchedAt.entries()]
            .map(([path, at]) => ({path, touchedAt: at}))
            .sort((a, b) =>
                b.touchedAt !== a.touchedAt
                    ? b.touchedAt - a.touchedAt
                    : a.path.localeCompare(b.path),
            )
            .slice(0, SUMMARY_LATEST_LIMIT)
        // No in-conversation changes → present the top-level entries (files carry the store mtime;
        // folders sort after, alphabetically) so the surface reflects the drive's real contents.
        // Filtered per SOURCE, before the fold prefix, so provenance is still known: a bare
        // `agent-files` from the session mount is the fold marker and goes, the same name from the
        // agent mount is a real directory and stays.
        const rootEntries: MountFile[] = [
            ...(rootQuery.data ?? []).filter(
                (f) => isSummaryDrivePath(f.path) && !resolveDrivePath(f.path, configured),
            ),
            ...driveSummary.flatMap(({drive, root}) =>
                foldDriveFiles(
                    drive,
                    (root.data ?? []).filter((f) =>
                        isSummaryDrivePath(f.path, {fromDriveMount: true}),
                    ),
                ),
            ),
            ...(agentRootQuery.data ?? [])
                .filter((f) => isSummaryDrivePath(f.path, {fromDriveMount: true}))
                .map((f) => ({
                    ...f,
                    path: `${agentPrefix}${cleanPath(f.path)}`,
                })),
        ]
        const rootRecents: DriveRecentFile[] = rootEntries
            .map((f) => ({...f, touchedAt: typeof f.mtime === "number" ? f.mtime : undefined}))
            .sort((a, b) =>
                (b.touchedAt ?? 0) !== (a.touchedAt ?? 0)
                    ? (b.touchedAt ?? 0) - (a.touchedAt ?? 0)
                    : a.path.localeCompare(b.path),
            )
            .slice(0, SUMMARY_LATEST_LIMIT)
        const recents = recordRecents.length ? recordRecents : rootRecents
        const lastTouchedAt = recents.length ? (recents[0].touchedAt ?? null) : null

        const cwdLinks = (cwdLinksQuery.data ?? []).filter(
            (f) => !f.is_folder && isDriveLink(f.path, configured),
        ).length
        const others = summarizeDrives(
            drivesState,
            driveSummary.map(({count}) => count),
        )
        const fileCount =
            Math.max(0, (cwdCount.data?.total ?? 0) - cwdLinks) +
            (agentMount ? (agentCount.data?.total ?? 0) : 0) +
            others.fileCount
        const fileCountCapped =
            Boolean(cwdCount.data?.totalCapped) ||
            (Boolean(agentMount) && Boolean(agentCount.data?.totalCapped)) ||
            others.fileCountCapped
        const countLabel = `${fileCount}${fileCountCapped ? "+" : ""}`

        const resolveMount = (path: string): ResolvedMountPath | null => {
            const rel = cleanPath(path)
            const linked = resolveDriveMount(rel, drivesState.linked, configured)
            if (linked !== undefined) return linked
            if (agentOnly)
                return agentMount
                    ? {mount: agentMount, path: unfoldAgentPath(rel, agentOwnsFold)}
                    : null
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
            drivesState.isPending ||
            (Boolean(agentMount) && agentCount.data === undefined && !agentCount.isError)

        const cwdInPlay = Boolean(sessionId)
        const agentInPlay = Boolean(artifactId || revisionId)
        // Has at least one in-play side produced its answer (files, empty, or error)?
        const anyResolved = (cwdInPlay && !cwdResolving) || (agentInPlay && !agentResolving)
        const anyResolving = cwdResolving || agentResolving || others.resolving
        const hasContent = recents.length > 0 || fileCount > 0

        // "A request is in flight over data that may already be shown" — the subtle "Loading more…"
        // hint. Keyed on fetchStatus so a session-switch revalidation (cached data, refetching) still
        // surfaces it. Disabled queries (empty id) are idle and never count.
        const isFetching =
            mountsQuery.isFetching ||
            cwdCount.isFetching ||
            (Boolean(agentMount) && (agentCount.isFetching || agentRootQuery.isFetching)) ||
            rootQuery.isFetching ||
            others.isFetching ||
            driveSummary.some(({root}) => root.isFetching)

        // BLOCKING skeleton ONLY at the very start — before ANY in-play side has answered and with
        // nothing to show. The moment one side answers (or the record log yields recents), we drop the
        // skeleton and render what we have; the fast drive is never held hostage to the slow one.
        const isLoading = (cwdInPlay || agentInPlay) && !anyResolved && !hasContent
        // RECONCILING: past that initial blank, a sibling is still catching up. Surfaces keep the list
        // (whatever content is in + a "Loading more…" hint) instead of flashing the terminal "No files"
        // while data is still arriving. Distinct from `isFetching` (which also covers in-place
        // revalidation and the idle mount→count handoff frame).
        const reconciling = anyResolving && (anyResolved || hasContent)

        // Per-mount failure: the session cwd and the agent's drives fail independently.
        const sessionErrored =
            Boolean(sessionId) &&
            ((!mountsQuery.isPending && (mountsQuery.data === null || mountsQuery.isError)) ||
                (Boolean(mount) &&
                    !cwdCount.isPending &&
                    (cwdCount.data === null || cwdCount.isError)))
        const agentErrored =
            Boolean(agentMount) &&
            !agentCount.isPending &&
            (agentCount.data === null || agentCount.isError)
        // TERMINAL error (the inline error + Retry card) means the SESSION (cwd) side failed with
        // nothing to show. An agent-only failure — or any failure with content still visible — is NOT
        // terminal: it falls through to the files/empty state so a working session is never masked.
        const errored = sessionErrored && fileCount === 0 && recents.length === 0
        // PARTIAL failure: a mount failed but we're NOT in the terminal card (there's content, or only
        // the agent side broke). The inline list stays clean; instead the drawer-trigger shows a quiet
        // warning indicator and the drawer itself offers the retry (see the drawer's partial banner).
        const partialErrored = (sessionErrored || agentErrored || others.errored) && !errored

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
            mount: agentOnly ? agentMount : mount,
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
            drives: drives.length ? drives : NO_DRIVES,
            configuredDrives: configured.length ? configured : NO_ENTRIES,
            homeSlug: drivesState.homeSlug,
        }
    }, [
        sessionId,
        artifactId,
        revisionId,
        agentOnly,
        mount,
        agentMount,
        drives,
        configured,
        drivesState,
        driveSummary,
        cwdLinksQuery.data,
        recordFiles,
        hasVisibleRecords,
        rootQuery.data,
        rootQuery.isPending,
        rootQuery.isFetching,
        agentRootQuery.data,
        agentRootQuery.isFetching,
        cwdCount.data,
        cwdCount.isPending,
        cwdCount.isFetching,
        cwdCount.isError,
        agentCount.data,
        agentCount.isPending,
        agentCount.isFetching,
        agentCount.isError,
        mountsQuery.data,
        mountsQuery.isPending,
        mountsQuery.isFetching,
        mountsQuery.isError,
    ])

    return {...data, retry}
}
