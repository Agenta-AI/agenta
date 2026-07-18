/**
 * DriveExplorer — the heavy browsing body of the drive surfaces: search + file tree + breadcrumb +
 * metadata + Download + the kind-matched content viewer. Split into its OWN module so the drawer
 * shells can `next/dynamic`-import it: the tree/renderer/pdfjs/markdown graph then loads only when a
 * drawer actually opens, never with the always-mounted config panel or chat pane.
 *
 * Used by the Build DriveDrawer (two-pane inspector) and the chat Files window's list view — same
 * explorer, "build once, skin twice". Phase 1 is read-only.
 */
import {
    type KeyboardEvent,
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"

import {type Mount} from "@agenta/entities/session"
import {CopyButton} from "@agenta/ui/components/presentational"
import {
    CaretDown,
    CaretRight,
    DownloadSimple,
    FolderSimple,
    House,
    Info,
    MagnifyingGlass,
    Tray,
} from "@phosphor-icons/react"
import {useVirtualizer} from "@tanstack/react-virtual"
import {Alert, Button, Input, Skeleton, Splitter, Tooltip, Typography} from "antd"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {AnimatePresence, motion} from "motion/react"

import {projectIdAtom} from "@/oss/state/project"

import {DriveFileRow, FOCUS_RING} from "./DriveFileRow"
import {driveFileIcon} from "./driveIcons"
import {gridArrowKeyDown} from "./driveKeyboard"
import {resolveDriveFileKind} from "./driveKinds"
import {downloadMountFile} from "./driveMedia"
import {
    ancestorPaths,
    buildDriveTree,
    filterDriveTree,
    humanSize,
    isHiddenPath,
    type DriveTreeNode,
} from "./driveTree"
import {DriveFileMetaList} from "./fileMeta"
import {OriginTag} from "./OriginTag"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {DriveFileBody} from "./renderers"
import {
    driveHasMixedOrigins,
    fileOrigin,
    type FileOrigin,
    type SessionDriveData,
} from "./useSessionDrive"
import {VirtualTileGrid} from "./VirtualTileGrid"

const {Text} = Typography

/** The drive being inspected: the conversation drive (session) or the app/agent drive (app). */
export type DriveScope = "session" | "app"

/** Last-viewed file per drive (keyed by mount id), so closing + reopening the drawer restores the
 * selection instead of resetting to the most-recent file. Module-level → survives the drawer's
 * destroyOnClose remount. */
const driveSelectionAtomFamily = atomFamily((_mountId: string) => atom<string | null>(null))

/** Breadcrumb root label. Mount slugs are the RESERVED form (`__ag__<uuid5>__cwd`) — surface
 * only the human tail ("cwd"), never the uuid (spec: raw ids stay out of labels). */
export const driveRootLabel = (mount: Mount | null): string =>
    mount?.slug?.split("__").filter(Boolean).pop() ?? "cwd"

/** Clickable path breadcrumb: each folder segment (and the home root) navigates via `onNavigate`
 * (a folder path, "" = root). The last segment is the current file/folder (plain). Scrolls
 * horizontally rather than truncating, so every part stays reachable. */
export const DriveBreadcrumb = ({
    shown,
    rootLabel,
    onNavigate,
}: {
    shown: string
    rootLabel: string
    onNavigate: (folderPath: string) => void
}) => {
    const segs = shown.split("/").filter(Boolean)
    return (
        <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-[11px] text-colorTextTertiary"
            title={shown}
        >
            <button
                type="button"
                onClick={() => onNavigate("")}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-colorTextTertiary hover:text-colorText"
            >
                <House size={12} />
                <span className="font-mono">{rootLabel}</span>
            </button>
            {segs.map((seg, i) => {
                const path = segs.slice(0, i + 1).join("/")
                const isLast = i === segs.length - 1
                return (
                    <span key={path} className="flex shrink-0 items-center gap-1">
                        <span className="text-colorTextQuaternary">/</span>
                        {isLast ? (
                            <span className="font-mono">{seg}</span>
                        ) : (
                            <button
                                type="button"
                                onClick={() => onNavigate(path)}
                                className="cursor-pointer rounded border-0 bg-transparent p-0 font-mono text-colorTextTertiary hover:text-colorText hover:underline"
                            >
                                {seg}
                            </button>
                        )}
                    </span>
                )
            })}
        </div>
    )
}

/** A visible tree row after {@link flattenTree}: the node plus its indentation depth. */
interface FlatTreeRow {
    node: DriveTreeNode
    depth: number
}

/** Flatten the tree to only the rows currently VISIBLE (a folder's children appear only when it's
 * expanded), pre-tagged with depth. This is what the virtualizer windows — so the DOM never holds
 * more than a screenful of rows even when a 12k-entry folder is expanded (issue #5367). */
const flattenTree = (nodes: DriveTreeNode[], expanded: Set<string>): FlatTreeRow[] => {
    const out: FlatTreeRow[] = []
    const walk = (list: DriveTreeNode[], depth: number) => {
        for (const n of list) {
            out.push({node: n, depth})
            if (n.isFolder && expanded.has(n.path) && n.children.length) walk(n.children, depth + 1)
        }
    }
    walk(nodes, 0)
    return out
}

/** One tree row (folder or file), indented by depth; selection = fill + primary ring. Renders a
 * SINGLE row — the hierarchy is materialized by {@link flattenTree}, not recursion, so each row is
 * an independent virtualized item. */
const TreeRow = ({
    node,
    depth,
    isOpen,
    selected,
    showOrigin,
    onToggle,
    onSelect,
}: {
    node: DriveTreeNode
    depth: number
    isOpen: boolean
    selected: boolean
    /** Tag top-level nodes with their origin (agent-files vs session) — only when mixed. */
    showOrigin?: boolean
    onToggle: (path: string) => void
    onSelect: (path: string) => void
}) => {
    // Dot-prefixed (hidden) entries surface but dimmed, like a file browser greys .git/.claude.
    const hidden = isHiddenPath(node.path)
    return (
        // Caret and row are SEPARATE controls: the caret only expands/collapses the tree (never
        // touches the right-pane selection), so collapsing a folder while previewing a file inside it
        // keeps that preview. The row selects — a folder shows its folder view and reveals its
        // children, but selecting never collapses (that's the caret's job).
        <div
            className={`flex w-full items-center rounded transition-colors ${
                selected
                    ? "bg-colorFillSecondary shadow-[inset_0_0_0_1px_var(--ag-colorPrimary)]"
                    : "hover:bg-colorFillTertiary"
            } ${hidden ? "opacity-60" : ""}`}
            style={{paddingLeft: 6 + depth * 14}}
        >
            {node.isFolder ? (
                <button
                    type="button"
                    // Not a tab stop — the row's main button is the single stop; arrow keys drive
                    // the rest. The caret stays mouse-clickable for expand/collapse.
                    tabIndex={-1}
                    aria-label={isOpen ? "Collapse folder" : "Expand folder"}
                    onClick={(e) => {
                        e.stopPropagation()
                        onToggle(node.path)
                    }}
                    className={`flex w-4 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-colorTextQuaternary hover:text-colorText ${FOCUS_RING}`}
                >
                    {isOpen ? <CaretDown size={10} /> : <CaretRight size={10} />}
                </button>
            ) : null}
            <button
                type="button"
                data-tree-main=""
                data-path={node.path}
                onClick={() => {
                    onSelect(node.path)
                    // Reveal a folder's children on select; never collapse here.
                    if (node.isFolder && !isOpen) onToggle(node.path)
                }}
                className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent py-1 pr-1.5 text-left text-xs ${FOCUS_RING} ${
                    node.isFolder ? "" : "pl-4"
                }`}
            >
                {node.isFolder ? (
                    <FolderSimple size={14} className="shrink-0 text-colorWarning" />
                ) : (
                    <span className="shrink-0">{driveFileIcon(node.path)}</span>
                )}
                {/* Truncate within the pane-wide row; the full name is on the title tooltip and by
                    widening the Splitter pane. */}
                <span className="min-w-0 truncate font-mono" title={node.path}>
                    {node.name}
                </span>
                {/* Only the top-level items carry the tag; nested rows inherit it from their
                    (already-tagged) agent-files folder, so the tree stays quiet. */}
                {showOrigin && depth === 0 ? <OriginTag origin={fileOrigin(node.path)} /> : null}
                {!node.isFolder && node.size != null ? (
                    <span className="ml-auto shrink-0 text-[11px] text-colorTextQuaternary">
                        {humanSize(node.size)}
                    </span>
                ) : null}
            </button>
        </div>
    )
}

/** The content viewer — the renderer registry (build-spec 3): kind-matched body, size caps,
 * Download fallback. Shared by the drawer preview and the chat Quick Look.
 *
 * Crossfade keyed by KIND, not path: switching between files of the same type reconciles the same
 * body in place (unchanged, smooth); switching types swaps the body component entirely (image →
 * markdown), which without this reads as a hard cut. Fading the old kind out and the new one in
 * (`mode="wait"` avoids overlapping two variable-height bodies) turns that swap into a replace. */
export const DriveFileContentViewer = ({
    mount,
    path,
    size,
    displayPath,
    onNavigate,
}: {
    mount: Mount | null
    path: string
    size?: number | null
    /** Presented path + navigate callback — used by the HTML preview to route internal links. */
    displayPath?: string
    onNavigate?: (path: string) => void
}) => {
    const kind = resolveDriveFileKind(path)
    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={kind}
                initial={{opacity: 0}}
                animate={{opacity: 1}}
                exit={{opacity: 0}}
                transition={{duration: 0.15}}
                className="flex min-h-0 flex-1 flex-col"
            >
                <DriveFileBody
                    mount={mount}
                    path={path}
                    size={size}
                    displayPath={displayPath}
                    onNavigate={onNavigate}
                />
            </motion.div>
        </AnimatePresence>
    )
}

/** Download button for one file — raw bytes, so every type round-trips (not just text). */
export const DriveFileDownloadButton = ({mount, path}: {mount: Mount | null; path: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    return (
        <Button
            icon={<DownloadSimple size={13} />}
            disabled={!mount}
            onClick={() => void downloadMountFile({mount, path, projectId})}
        >
            Download
        </Button>
    )
}

/** Right pane: a FIXED header (breadcrumb + name + copy/details/download actions + expandable
 * metadata) over a scrollable content viewer — same shape and interactions as the chat single-file
 * view, so the file info never scrolls away with the content. */
const DriveFilePreview = ({
    mount,
    path,
    displayPath,
    rootLabel,
    showOrigin,
    touchedAt,
    size,
    onSelect,
}: {
    mount: Mount | null
    /** Path relative to `mount` — used for reading (content/meta/download). */
    path: string
    /** Path as shown to the user (with the `agent-files/` prefix) — used for the breadcrumb + name.
     * Defaults to `path` when the file is in the cwd mount. */
    displayPath?: string
    rootLabel: string
    /** Tag the file's origin next to its name — only when the drive holds both kinds. */
    showOrigin?: boolean
    touchedAt?: number
    size?: number
    /** Navigate to a folder (breadcrumb) or file — same selection callback the tree uses. */
    onSelect: (path: string) => void
}) => {
    const shown = displayPath ?? path
    const name = shown.split("/").pop() ?? shown
    const [metaExpanded, setMetaExpanded] = useState(false)

    return (
        // h-full (NOT flex-1): the Splitter.Panel isn't a flex parent, so flex-1 gives no bounded
        // height — the pane would grow to content and scroll the header away. h-full pins it to the
        // panel so the header stays and only the content viewer scrolls (mirrors the tree pane).
        <div className="flex h-full min-h-0 w-full flex-col">
            {/* Fixed header (breadcrumb + name + actions + metadata) — stays put while the content
                scrolls, and the action cluster [copy · details · download] matches the chat file view. */}
            <div className="flex shrink-0 flex-col gap-2 border-0 border-b border-solid border-colorBorderSecondary p-4 pb-3">
                <DriveBreadcrumb shown={shown} rootLabel={rootLabel} onNavigate={onSelect} />

                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-[13px] font-semibold">{name}</span>
                        {showOrigin ? <OriginTag origin={fileOrigin(shown)} /> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <Tooltip title="Copy path">
                            <CopyButton
                                text={shown}
                                buttonText={null}
                                icon
                                size="small"
                                aria-label="Copy file path"
                                successMessage=""
                                className="!h-7 !w-7 !p-0 !text-colorTextTertiary hover:!text-colorText"
                            />
                        </Tooltip>
                        <Tooltip title="File details">
                            <Button
                                type="text"
                                size="small"
                                aria-label="File details"
                                aria-pressed={metaExpanded}
                                onClick={() => setMetaExpanded((v) => !v)}
                                icon={<Info size={16} weight={metaExpanded ? "fill" : "regular"} />}
                                className={`!h-7 !w-7 !p-0 ${metaExpanded ? "!text-colorPrimary" : "!text-colorTextTertiary hover:!text-colorText"}`}
                            />
                        </Tooltip>
                        <DriveFileDownloadButton mount={mount} path={path} />
                    </div>
                </div>

                <DriveFileMetaList
                    mount={mount}
                    path={path}
                    size={size}
                    touchedAt={touchedAt}
                    expanded={metaExpanded}
                />
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-4 pt-3">
                <DriveFileContentViewer
                    mount={mount}
                    path={path}
                    size={size}
                    displayPath={shown}
                    onNavigate={onSelect}
                />
            </div>
        </div>
    )
}

/** A subfolder tile — same shape as the file tile (4:3 icon "thumbnail" + name + meta) so folders
 * and files form ONE uniform grid instead of short folder cards stretching to the file-tile height. */
export const FolderTile = ({node, onOpen}: {node: DriveTreeNode; onOpen: () => void}) => {
    const hidden = isHiddenPath(node.path)
    const count = node.children.length
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 transition-colors hover:border-colorBorder hover:bg-colorFillTertiary ${FOCUS_RING} ${hidden ? "opacity-60" : ""}`}
        >
            <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded bg-colorFillTertiary">
                <FolderSimple size={40} weight="fill" className="text-colorWarning" />
            </div>
            <span className="w-full truncate text-center font-mono text-xs" title={node.path}>
                {node.name}
            </span>
            <span className="w-full truncate text-center text-[11px] text-colorTextTertiary">
                {count} item{count === 1 ? "" : "s"}
            </span>
        </button>
    )
}

/** Right pane when a FOLDER is selected: fixed header (clickable breadcrumb + folder name) over a
 * grid of the folder's immediate children — subfolders drill in, files open the preview. Reuses the
 * chat grid's file tile (DriveFileRow). */
const FolderView = ({
    folderPath,
    nodes,
    rootLabel,
    drive,
    showOrigin,
    onSelect,
}: {
    folderPath: string
    nodes: DriveTreeNode[]
    rootLabel: string
    drive: SessionDriveData
    showOrigin: boolean
    onSelect: (path: string) => void
}) => {
    const now = useRecentChangeClock(drive.lastTouchedAt)
    const recentsByPath = useMemo(
        () => new Map(drive.recents.map((f) => [f.path, f])),
        [drive.recents],
    )
    const folderName = folderPath === "" ? rootLabel : (folderPath.split("/").pop() ?? folderPath)
    // Folders first (matching the tree's sort), then files — one combined list so the grid windows
    // uniformly even when a folder holds thousands of immediate children.
    const entries = useMemo(
        () => [...nodes].sort((a, b) => (a.isFolder === b.isFolder ? 0 : a.isFolder ? -1 : 1)),
        [nodes],
    )

    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            <div className="flex shrink-0 flex-col gap-2 border-0 border-b border-solid border-colorBorderSecondary p-4 pb-3">
                <DriveBreadcrumb shown={folderPath} rootLabel={rootLabel} onNavigate={onSelect} />
                <div className="flex items-center gap-2">
                    <FolderSimple size={16} weight="fill" className="shrink-0 text-colorWarning" />
                    <span className="truncate font-mono text-[13px] font-semibold">
                        {folderName}
                    </span>
                    <span className="shrink-0 text-[11px] text-colorTextTertiary">
                        {nodes.length} item{nodes.length === 1 ? "" : "s"}
                    </span>
                </div>
            </div>

            {nodes.length === 0 ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
                    <Tray size={26} className="text-colorTextQuaternary" />
                    <div className="text-xs font-medium">Empty folder</div>
                </div>
            ) : (
                <VirtualTileGrid
                    // Remount per folder so drilling in starts scrolled at the top, not wherever the
                    // previous (possibly much longer) folder was scrolled to.
                    key={folderPath}
                    items={entries}
                    minColumnWidth={200}
                    className="p-4"
                    onKeyDown={gridArrowKeyDown}
                    getKey={(n) => n.path}
                    renderTile={(n) => {
                        if (n.isFolder) {
                            return <FolderTile node={n} onOpen={() => onSelect(n.path)} />
                        }
                        const file = recentsByPath.get(n.path)
                        const resolved = drive.resolveMount(n.path)
                        return (
                            <DriveFileRow
                                variant="tile"
                                path={n.path}
                                file={resolved && file ? {...file, path: resolved.path} : file}
                                mount={resolved?.mount ?? drive.mount}
                                showOrigin={showOrigin}
                                hideFolder
                                trailing={humanSize(n.size)}
                                recent={file ? isRecentlyChanged(file.touchedAt, now) : false}
                                onOpen={() => onSelect(n.path)}
                            />
                        )
                    }}
                />
            )}
        </div>
    )
}

/**
 * The browsing body — loading/empty/error states + the two-pane search/tree/preview. Owns its
 * selection state; initialize with `initialPath` (callers remount per open, so mount-time init
 * is the reset).
 */
export function DriveExplorer({
    drive,
    scope = "session",
    initialPath,
    search: searchProp,
    originFilter = "all",
    showHidden = true,
}: {
    drive: SessionDriveData
    scope?: DriveScope
    initialPath?: string | null
    /** Controlled search term — when provided (embedded in FilesWindow), the parent toolbar's search
     * drives the tree and DriveExplorer hides its own search box. Uncontrolled (own box) otherwise. */
    search?: string
    /** Restrict the tree to one origin (agent vs session). "all" = no filter. */
    originFilter?: "all" | FileOrigin
    /** Include dot-prefixed (hidden) entries. False drops them from the tree. */
    showHidden?: boolean
}) {
    const rootLabel = driveRootLabel(drive.mount)
    // Restore the last-viewed file on (re)mount: explicit initialPath wins, else the persisted
    // per-drive selection, else null (the effect below picks the most-recent).
    const [persistedSelection, setPersistedSelection] = useAtom(
        driveSelectionAtomFamily(drive.mount?.id ?? ""),
    )
    const controlledSearch = searchProp !== undefined
    const [internalSearch, setSearch] = useState("")
    const search = controlledSearch ? searchProp : internalSearch
    const [selectedPath, setSelectedPath] = useState<string | null>(
        () => initialPath ?? persistedSelection ?? null,
    )
    const [expanded, setExpanded] = useState<Set<string>>(() => {
        const init = initialPath ?? persistedSelection ?? null
        return new Set(init ? ancestorPaths(init) : [])
    })

    // Select a file: update local state AND persist it per drive so reopening restores it.
    const select = useCallback(
        (nextPath: string | null) => {
            setSelectedPath(nextPath)
            setPersistedSelection(nextPath)
        },
        [setPersistedSelection],
    )

    // Auto-select the most-recently-touched file once the listing lands (spec behavior); never
    // steals an existing (or restored) selection.
    useEffect(() => {
        if (drive.isLoading || selectedPath || !drive.recents.length) return
        const target = drive.recents[0].path
        select(target)
        setExpanded(new Set(ancestorPaths(target)))
    }, [drive.isLoading, drive.recents, selectedPath, select])

    // Defer the search term so typing stays responsive on a 12k-entry tree — the input updates now,
    // the filter/flatten trails a frame (React interrupts it if you keep typing).
    const deferredSearch = useDeferredValue(search)
    const originFiltered = useMemo(() => {
        let files = drive.files
        if (originFilter !== "all") files = files.filter((f) => fileOrigin(f.path) === originFilter)
        if (!showHidden) files = files.filter((f) => !isHiddenPath(f.path))
        return files
    }, [drive.files, originFilter, showHidden])
    const tree = useMemo(() => buildDriveTree(originFiltered), [originFiltered])
    const shownTree = useMemo(() => filterDriveTree(tree, deferredSearch), [tree, deferredSearch])
    // While searching, show every surviving branch expanded so matches are visible.
    const shownExpanded = useMemo(
        () => (deferredSearch.trim() ? new Set(collectFolderPaths(shownTree)) : expanded),
        [deferredSearch, shownTree, expanded],
    )
    // The visible rows, flattened for virtualization (see flattenTree), plus a path→row-index map for
    // O(1) keyboard navigation.
    const flatRows = useMemo(
        () => flattenTree(shownTree, shownExpanded),
        [shownTree, shownExpanded],
    )
    const indexByPath = useMemo(() => {
        const map = new Map<string, number>()
        flatRows.forEach((r, i) => map.set(r.node.path, i))
        return map
    }, [flatRows])
    // Flat lookup of every tree node by path, so a selected FOLDER can render its children (folder
    // view) and a selected FILE the preview. Root ("") maps to the top-level nodes.
    const nodeByPath = useMemo(() => {
        const map = new Map<string, DriveTreeNode>()
        const walk = (nodes: DriveTreeNode[]) => {
            for (const n of nodes) {
                map.set(n.path, n)
                if (n.children.length) walk(n.children)
            }
        }
        walk(tree)
        return map
    }, [tree])
    const selectedNode = selectedPath != null ? nodeByPath.get(selectedPath) : undefined
    const selectedIsFolder = selectedPath === "" || selectedNode?.isFolder === true
    const selected = drive.recents.find((f) => f.path === selectedPath) ?? null
    const showOrigin = driveHasMixedOrigins(drive.recents)

    // The tree scroll container is the virtualizer's scroll element — only the visible rows (+
    // overscan) mount, so expanding a folder with thousands of children never floods the DOM.
    const treeRef = useRef<HTMLDivElement>(null)
    const treeVirtualizer = useVirtualizer({
        count: flatRows.length,
        getScrollElement: () => treeRef.current,
        estimateSize: () => 28,
        overscan: 12,
        getItemKey: (i) => flatRows[i]?.node.path ?? i,
    })

    // Focus a row by its flat index, scrolling it into view first (it may not be rendered yet when
    // virtualized). Retries across a few frames until the row exists in the DOM.
    const focusTreeRow = useCallback(
        (index: number) => {
            if (!flatRows.length) return
            const clamped = Math.min(Math.max(index, 0), flatRows.length - 1)
            treeVirtualizer.scrollToIndex(clamped, {align: "auto"})
            let tries = 0
            const tryFocus = () => {
                const el = treeRef.current?.querySelector<HTMLButtonElement>(
                    `[data-index="${clamped}"] button[data-tree-main]`,
                )
                if (el) el.focus()
                else if (tries++ < 3) requestAnimationFrame(tryFocus)
            }
            requestAnimationFrame(tryFocus)
        },
        [flatRows.length, treeVirtualizer],
    )

    // Tree keyboard nav (WAI-ARIA tree pattern) over the FLAT index: ↑/↓ move focus one visible row;
    // → expands a collapsed folder then steps into it; ← collapses an open folder else steps to the
    // parent; Home/End jump to the ends. Enter/Space stay the button's own onClick (select).
    const onTreeKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>) => {
            const keys = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]
            if (!keys.includes(e.key)) return
            if (!flatRows.length) return
            e.preventDefault()
            const activePath = (document.activeElement as HTMLElement | null)?.getAttribute(
                "data-path",
            )
            const idx = activePath != null ? (indexByPath.get(activePath) ?? -1) : -1

            if (e.key === "Home") return focusTreeRow(0)
            if (e.key === "End") return focusTreeRow(flatRows.length - 1)
            if (e.key === "ArrowDown") return focusTreeRow(idx < 0 ? 0 : idx + 1)
            if (e.key === "ArrowUp") return focusTreeRow(idx < 0 ? 0 : idx - 1)

            if (activePath == null) return focusTreeRow(idx < 0 ? 0 : idx)
            const node = nodeByPath.get(activePath)
            const isFolder = node?.isFolder === true
            const isOpen = expanded.has(activePath)

            if (e.key === "ArrowRight") {
                if (isFolder && !isOpen) setExpanded((prev) => new Set(prev).add(activePath))
                else if (isFolder && isOpen) focusTreeRow(idx + 1)
                return
            }
            // ArrowLeft: collapse an open folder, else move focus to the parent row.
            if (isFolder && isOpen) {
                setExpanded((prev) => {
                    const next = new Set(prev)
                    next.delete(activePath)
                    return next
                })
                return
            }
            const parent = activePath.includes("/")
                ? activePath.split("/").slice(0, -1).join("/")
                : null
            if (parent != null) {
                const pIdx = indexByPath.get(parent)
                if (pIdx != null) focusTreeRow(pIdx)
            }
        },
        [flatRows.length, indexByPath, nodeByPath, expanded, focusTreeRow],
    )

    // Initial focus: a <div>'s onKeyDown only fires when something inside is focused, so arrow keys
    // do nothing until a row is clicked. Once the listing is ready, focus the selected (else first)
    // row so keyboard nav works immediately on open. Runs once; won't steal focus from a field the
    // user is typing in (e.g. search) or if focus is already in the tree.
    const didInitialFocus = useRef(false)
    useEffect(() => {
        if (didInitialFocus.current || drive.isLoading || !flatRows.length) return
        const container = treeRef.current
        const active = document.activeElement as HTMLElement | null
        if (
            active &&
            (/^(input|textarea|select)$/i.test(active.tagName) ||
                Boolean(container?.contains(active)))
        ) {
            didInitialFocus.current = true
            return
        }
        const idx = selectedPath != null ? (indexByPath.get(selectedPath) ?? 0) : 0
        focusTreeRow(idx)
        didInitialFocus.current = true
    }, [drive.isLoading, selectedPath, flatRows.length, indexByPath, focusTreeRow])

    if (drive.errored) {
        return (
            <div className="w-full p-4">
                <Alert
                    type="warning"
                    showIcon
                    message="Couldn't load this drive"
                    description={
                        <span className="text-xs">
                            The file store may not be configured on this deployment.
                        </span>
                    }
                />
            </div>
        )
    }
    if (drive.isLoading) {
        return (
            <div className="flex min-h-0 w-full flex-1">
                <div className="w-[240px] shrink-0 border-0 border-r border-solid border-colorBorderSecondary p-3">
                    <Skeleton.Input active size="small" block />
                    <div className="mt-3">
                        <Skeleton active paragraph={{rows: 4}} title={false} />
                    </div>
                </div>
                <div className="flex-1 p-4">
                    <Skeleton active paragraph={{rows: 8}} />
                </div>
            </div>
        )
    }
    if (drive.fileCount === 0) {
        return (
            <div className="flex min-h-0 w-full flex-1">
                {!controlledSearch ? (
                    <div className="w-[240px] shrink-0 border-0 border-r border-solid border-colorBorderSecondary p-3">
                        <Input disabled placeholder="Search" />
                    </div>
                ) : null}
                <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
                    <Tray size={28} className="text-colorTextQuaternary" />
                    <div className="text-xs font-medium">This drive is empty</div>
                    <div className="text-[11px] text-colorTextTertiary">
                        {scope === "session"
                            ? "Created on the conversation's first run."
                            : "Files the agent keeps across conversations land here."}
                    </div>
                </div>
            </div>
        )
    }
    return (
        // Splitter → the tree pane is draggable; widen it to read truncated long names.
        <Splitter className="min-h-0 w-full flex-1">
            <Splitter.Panel defaultSize={260} min={180} max="65%">
                {/* No own search box when controlled → drop the top padding so the tree isn't pushed
                    down by empty space (the embedding toolbar already spaces it). */}
                <div
                    className={`flex h-full min-h-0 flex-col gap-2 px-3 pb-3 ${
                        controlledSearch ? "pt-0" : "pt-3"
                    }`}
                >
                    {/* Own search box only when uncontrolled (build DriveDrawer). Embedded in
                        FilesWindow the shared toolbar search drives it instead. */}
                    {!controlledSearch ? (
                        <Input
                            allowClear
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search files"
                            prefix={
                                <MagnifyingGlass size={12} className="text-colorTextQuaternary" />
                            }
                        />
                    ) : null}
                    <div
                        ref={treeRef}
                        className="min-h-0 flex-1 overflow-auto"
                        onKeyDown={onTreeKeyDown}
                    >
                        {flatRows.length === 0 ? (
                            <Text type="secondary" className="px-1 !text-[11px]">
                                No files match.
                            </Text>
                        ) : (
                            // Only the visible rows mount. Rows fill the pane width (uniform hover /
                            // selection); long names truncate — widen the pane (Splitter) to read them.
                            <div
                                style={{
                                    height: treeVirtualizer.getTotalSize(),
                                    position: "relative",
                                    width: "100%",
                                }}
                            >
                                {treeVirtualizer.getVirtualItems().map((vRow) => {
                                    const {node, depth} = flatRows[vRow.index]
                                    return (
                                        <div
                                            key={vRow.key}
                                            data-index={vRow.index}
                                            ref={treeVirtualizer.measureElement}
                                            style={{
                                                position: "absolute",
                                                top: 0,
                                                left: 0,
                                                width: "100%",
                                                transform: `translateY(${vRow.start}px)`,
                                            }}
                                        >
                                            <TreeRow
                                                node={node}
                                                depth={depth}
                                                isOpen={shownExpanded.has(node.path)}
                                                selected={node.path === selectedPath}
                                                showOrigin={showOrigin}
                                                onToggle={(path) =>
                                                    setExpanded((prev) => {
                                                        const next = new Set(prev)
                                                        if (next.has(path)) next.delete(path)
                                                        else next.add(path)
                                                        return next
                                                    })
                                                }
                                                onSelect={select}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </Splitter.Panel>
            <Splitter.Panel>
                {selectedPath == null ? (
                    <div className="flex h-full flex-1 items-center justify-center text-xs text-colorTextTertiary">
                        Select a file to preview it.
                    </div>
                ) : selectedIsFolder ? (
                    <FolderView
                        folderPath={selectedPath}
                        nodes={selectedPath === "" ? tree : (selectedNode?.children ?? [])}
                        rootLabel={rootLabel}
                        drive={drive}
                        showOrigin={showOrigin}
                        onSelect={select}
                    />
                ) : (
                    <DriveFilePreview
                        // Preview reads from the file's own mount (cwd or the nested agent-files
                        // mount), but the breadcrumb/name show the presented path (agent-files/ prefix).
                        mount={drive.resolveMount(selectedPath)?.mount ?? drive.mount}
                        path={drive.resolveMount(selectedPath)?.path ?? selectedPath}
                        displayPath={selectedPath}
                        showOrigin={showOrigin}
                        rootLabel={rootLabel}
                        touchedAt={selected?.touchedAt}
                        size={selected?.size ?? undefined}
                        onSelect={select}
                    />
                )}
            </Splitter.Panel>
        </Splitter>
    )
}

const collectFolderPaths = (nodes: DriveTreeNode[]): string[] =>
    nodes.flatMap((n) => (n.isFolder ? [n.path, ...collectFolderPaths(n.children)] : []))
