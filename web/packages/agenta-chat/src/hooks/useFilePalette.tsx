/**
 * The composer's `@` file palette — the session drive as a trigger menu.
 *
 * Lives here, not in `@agenta/ui`, because it needs drive data the UI package may not import. The
 * palette contract carries every visual as a ReactNode, so the renderer stays drive-free while this
 * hook supplies the icons, origin pills and breadcrumb.
 *
 * `subscribers` must be rendered by the caller: it holds the per-directory queries.
 */
import {useCallback, useDeferredValue, useMemo, useState, type ReactNode} from "react"

import {
    driveHasMixedOrigins,
    driveRootLabel,
    fileOrigin,
    humanSize,
    relativeTime,
    useDelayedTrue,
    useSessionDriveSummary,
} from "@agenta/entities/drive"
import {
    DriveBreadcrumb,
    driveFileIcon,
    OriginTag,
    useDriveArtifactId,
    useDriveSessionId,
    useLazyDriveTree,
} from "@agenta/entity-ui/drive"
import {
    HintKey,
    type PaletteItem,
    type PaletteSection,
    type PaletteSpec,
} from "@agenta/ui/rich-chat-input"
import {CircleNotch, FolderOpen, FolderSimple, House, MagnifyingGlass} from "@phosphor-icons/react"

import {
    browseRows,
    parentPath,
    recentRows,
    searchRows,
    type PaletteFileRow,
} from "../assets/filePaletteRows"

/** Long enough that `@r` on the way to `@report.md` never fires the whole-tree fetch. */
const SEARCH_DELAY_MS = 180

export interface FilePalette {
    /** Undefined when disabled or outside a conversation — the composer then mounts no `@` menu. */
    spec?: PaletteSpec
    /** Render this (it renders null); it drives the per-directory listings. */
    subscribers: ReactNode
}

export function useFilePalette({enabled = true}: {enabled?: boolean} = {}): FilePalette {
    const sessionId = useDriveSessionId() ?? ""
    const artifactId = useDriveArtifactId() ?? undefined
    const active = enabled && Boolean(sessionId)

    const [query, setQuery] = useState<string | null>(null)
    const [cwd, setCwd] = useState("")

    // The summary drive: record-log recents plus a count, no whole-tree listing to open a menu.
    const drive = useSessionDriveSummary(active ? sessionId : "", active ? artifactId : undefined)

    const deferredQuery = useDeferredValue(query ?? "")
    const searchActive = useDelayedTrue(deferredQuery.trim() !== "", SEARCH_DELAY_MS)
    // Empty while closed, so no directory subscriber exists until the user types `@`.
    const activePaths = useMemo(() => (query === null ? [] : [...new Set(["", cwd])]), [query, cwd])
    const lazy = useLazyDriveTree(drive, activePaths, searchActive, false)

    const onQueryChange = useCallback((next: string | null) => {
        setQuery(next)
        // A reopened `@` always starts at the root.
        if (next === null) setCwd("")
    }, [])

    // Consume Escape only while there is a level to step out of; at the root the plugin closes.
    const onEscape = useCallback(() => {
        if (!cwd) return false
        setCwd(parentPath(cwd))
        return true
    }, [cwd])

    const searching = deferredQuery.trim() !== ""
    const showOrigin = useMemo(() => driveHasMixedOrigins(lazy.files), [lazy.files])

    const toItem = useCallback(
        (row: PaletteFileRow, keyPrefix: string): PaletteItem => ({
            key: `${keyPrefix}:${row.path}`,
            // The full path while searching, so the highlight lands where the match is.
            label: searching ? row.path : row.name + (row.isFolder ? "/" : ""),
            icon: row.isFolder ? (
                <FolderSimple size={14} weight="regular" />
            ) : (
                driveFileIcon(row.path, 14)
            ),
            badge: showOrigin ? <OriginTag origin={fileOrigin(row.path)} /> : undefined,
            secondary:
                !searching && keyPrefix === "recent" && parentPath(row.path)
                    ? `${parentPath(row.path)}/`
                    : undefined,
            tail: row.isFolder
                ? row.itemCount
                    ? `${row.itemCount} items`
                    : "open"
                : [humanSize(row.size), row.touchedAt ? relativeTime(row.touchedAt) : ""]
                      .filter(Boolean)
                      .join(" · "),
            kind: "insert",
            // The reference the agent receives: the presented drive path, `agent-files/` fold
            // included, which is the name the runner symlinks into the session's working folder.
            insertText: row.isFolder ? `${row.path}/` : row.path,
            insertAs: "code",
            onDrillIn: row.isFolder ? () => setCwd(row.path) : undefined,
        }),
        [searching, showOrigin],
    )

    const sections = useMemo<PaletteSection[]>(() => {
        if (!active) return []
        if (searching) {
            const rows = searchRows(lazy.files, cwd, deferredQuery)
            return rows.length
                ? [{key: "matches", title: "", items: rows.map((r) => toItem(r, "hit"))}]
                : []
        }
        const level = browseRows(lazy.files, cwd)
        if (cwd) {
            return level.length
                ? [{key: "level", title: "", items: level.map((r) => toItem(r, "level"))}]
                : []
        }
        const recents = recentRows(drive.recents)
        const recentPaths = new Set(recents.map((r) => r.path))
        return [
            recents.length
                ? {
                      key: "recent",
                      title: "Recently touched",
                      items: recents.map((r) => toItem(r, "recent")),
                  }
                : null,
            level.length
                ? {
                      key: "root",
                      title: recents.length ? "Root" : "",
                      // A file already listed above would read as a duplicate row.
                      items: level
                          .filter((r) => !recentPaths.has(r.path))
                          .map((r) => toItem(r, "root")),
                  }
                : null,
        ].filter(
            (section): section is PaletteSection => section !== null && section.items.length > 0,
        )
    }, [active, searching, lazy.files, cwd, deferredQuery, drive.recents, toItem])

    // While the search is still held back, say so rather than reporting the loaded dirs as the
    // whole answer — an empty state here would claim the drive holds no match.
    const loading = searching ? !searchActive || lazy.searchLoading : !lazy.loadedDirs.has(cwd)

    const header = useMemo<ReactNode>(() => {
        const status = loading ? (
            <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[var(--ag-colorTextTertiary)]">
                <CircleNotch size={11} className="animate-spin" />
                listing…
            </span>
        ) : null
        if (cwd) {
            return (
                <>
                    <House size={12} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
                    <DriveBreadcrumb
                        shown={cwd}
                        rootLabel={driveRootLabel(drive.mount)}
                        onNavigate={setCwd}
                    />
                    {status}
                </>
            )
        }
        return (
            <>
                {searching ? (
                    <MagnifyingGlass size={14} className="text-[var(--ag-colorTextTertiary)]" />
                ) : (
                    <FolderOpen size={14} className="text-[var(--ag-colorTextTertiary)]" />
                )}
                <span className="font-medium">Files</span>
                <span className="text-[11.5px] text-[var(--ag-colorTextTertiary)]">
                    {searching ? "across the drive" : "this session's drive"}
                </span>
                {status}
            </>
        )
    }, [cwd, drive.mount, loading, searching])

    const footer = useCallback(
        (activeItem: PaletteItem | undefined): ReactNode => (
            <>
                <HintKey keys="↑↓" label="navigate" />
                <HintKey
                    keys="↵"
                    label={
                        !activeItem
                            ? "send"
                            : activeItem.onDrillIn
                              ? "reference folder"
                              : "reference"
                    }
                />
                {activeItem?.onDrillIn ? <HintKey keys="tab" label="open folder" /> : null}
                <HintKey keys="esc" label={cwd ? "back" : "dismiss"} />
                {cwd ? (
                    <span className="ml-auto">
                        searching inside <span className="font-mono">{cwd}/</span>
                    </span>
                ) : null}
            </>
        ),
        [cwd],
    )

    const spec = useMemo<PaletteSpec | undefined>(() => {
        if (!active) return undefined
        return {
            key: "files",
            trigger: "@",
            // Paths hold slashes, so the query must too — `@docs/gui` stays one run.
            allowSlashInQuery: true,
            label: "Files",
            sections,
            // Rows arrive already filtered and capped; re-ranking them here would fight the order.
            filterMode: "none",
            onQueryChange,
            onEscape,
            header,
            footer,
            loading,
            emptyText: (q) =>
                q ? (
                    <>
                        No file or folder matches “{q}”
                        <div className="mt-[5px] text-[11px] text-[var(--ag-colorTextTertiary)]">
                            Enter sends the message as written.
                        </div>
                    </>
                ) : (
                    "No files in this drive yet"
                ),
        }
    }, [active, sections, onQueryChange, onEscape, header, footer, loading])

    return {spec, subscribers: lazy.subscribers}
}
