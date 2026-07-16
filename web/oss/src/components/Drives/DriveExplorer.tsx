/**
 * DriveExplorer — the heavy browsing body of the drive surfaces: search + file tree + breadcrumb +
 * metadata + Download + the kind-matched content viewer. Split into its OWN module so the drawer
 * shells can `next/dynamic`-import it: the tree/renderer/pdfjs/markdown graph then loads only when a
 * drawer actually opens, never with the always-mounted config panel or chat pane.
 *
 * Used by the Build DriveDrawer (two-pane inspector) and the chat Files window's list view — same
 * explorer, "build once, skin twice". Phase 1 is read-only.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

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
import {Alert, Button, Input, Skeleton, Splitter, Tooltip, Typography} from "antd"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {AnimatePresence, motion} from "motion/react"

import {projectIdAtom} from "@/oss/state/project"

import {DriveFileRow} from "./DriveFileRow"
import {driveFileIcon} from "./driveIcons"
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
import {driveHasMixedOrigins, fileOrigin, type SessionDriveData} from "./useSessionDrive"

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
const DriveBreadcrumb = ({
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

/** One tree row (folder or file), indented by depth; selection = fill + primary ring. */
const TreeRow = ({
    node,
    depth,
    expanded,
    selectedPath,
    showOrigin,
    onToggle,
    onSelect,
}: {
    node: DriveTreeNode
    depth: number
    expanded: Set<string>
    selectedPath: string | null
    /** Tag top-level nodes with their origin (agent-files vs session) — only when mixed. */
    showOrigin?: boolean
    onToggle: (path: string) => void
    onSelect: (path: string) => void
}) => {
    const isOpen = expanded.has(node.path)
    const selected = node.path === selectedPath
    // Dot-prefixed (hidden) entries surface but dimmed, like a file browser greys .git/.claude.
    const hidden = isHiddenPath(node.path)
    return (
        <>
            <button
                type="button"
                // A folder both opens its contents on the right (folder view) AND toggles in the tree.
                onClick={() => {
                    onSelect(node.path)
                    if (node.isFolder) onToggle(node.path)
                }}
                className={`flex w-full cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1.5 py-1 text-left text-xs transition-colors ${
                    selected
                        ? "bg-colorFillSecondary shadow-[inset_0_0_0_1px_var(--ag-colorPrimary)]"
                        : "hover:bg-colorFillTertiary"
                } ${hidden ? "opacity-60" : ""}`}
                style={{paddingLeft: 6 + depth * 14}}
            >
                {node.isFolder ? (
                    <>
                        {isOpen ? (
                            <CaretDown size={10} className="shrink-0 text-colorTextQuaternary" />
                        ) : (
                            <CaretRight size={10} className="shrink-0 text-colorTextQuaternary" />
                        )}
                        <FolderSimple size={14} className="shrink-0 text-colorWarning" />
                    </>
                ) : (
                    <span className="shrink-0 pl-[14px]">{driveFileIcon(node.path)}</span>
                )}
                {/* whitespace-nowrap (not truncate): the tree scrolls horizontally, so long names
                    stay readable by scrolling rather than being clipped with an ellipsis. */}
                <span className="whitespace-nowrap font-mono">{node.name}</span>
                {/* Only the top-level items carry the tag; nested rows inherit it from their
                    (already-tagged) agent-files folder, so the tree stays quiet. */}
                {showOrigin && depth === 0 ? <OriginTag origin={fileOrigin(node.path)} /> : null}
                {!node.isFolder && node.size != null ? (
                    <span className="ml-auto shrink-0 text-[11px] text-colorTextQuaternary">
                        {humanSize(node.size)}
                    </span>
                ) : null}
            </button>
            {node.isFolder && isOpen
                ? node.children.map((child) => (
                      <TreeRow
                          key={child.path}
                          node={child}
                          depth={depth + 1}
                          expanded={expanded}
                          selectedPath={selectedPath}
                          showOrigin={showOrigin}
                          onToggle={onToggle}
                          onSelect={onSelect}
                      />
                  ))
                : null}
        </>
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
}: {
    mount: Mount | null
    path: string
    size?: number | null
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
                <DriveFileBody mount={mount} path={path} size={size} />
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
                <DriveFileContentViewer mount={mount} path={path} size={size} />
            </div>
        </div>
    )
}

/** A subfolder card in the folder view — click to drill in. */
const FolderTile = ({node, onOpen}: {node: DriveTreeNode; onOpen: () => void}) => {
    const hidden = isHiddenPath(node.path)
    const count = node.children.length
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`flex w-full min-w-0 cursor-pointer flex-col items-start gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-3 transition-colors hover:border-colorBorder hover:bg-colorFillTertiary ${hidden ? "opacity-60" : ""}`}
        >
            <FolderSimple size={22} weight="fill" className="text-colorWarning" />
            <span className="w-full truncate text-left font-mono text-xs" title={node.path}>
                {node.name}
            </span>
            <span className="text-[11px] text-colorTextTertiary">
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
    const folders = nodes.filter((n) => n.isFolder)
    const files = nodes.filter((n) => !n.isFolder)

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

            <div className="min-h-0 flex-1 overflow-auto p-4">
                {nodes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-1 p-8 text-center">
                        <Tray size={26} className="text-colorTextQuaternary" />
                        <div className="text-xs font-medium">Empty folder</div>
                    </div>
                ) : (
                    <div className="grid auto-rows-min grid-cols-3 gap-2">
                        {folders.map((n) => (
                            <FolderTile key={n.path} node={n} onOpen={() => onSelect(n.path)} />
                        ))}
                        {files.map((n) => {
                            const file = recentsByPath.get(n.path)
                            const resolved = drive.resolveMount(n.path)
                            return (
                                <DriveFileRow
                                    key={n.path}
                                    variant="tile"
                                    path={n.path}
                                    file={resolved && file ? {...file, path: resolved.path} : file}
                                    mount={resolved?.mount ?? drive.mount}
                                    showOrigin={showOrigin}
                                    trailing={humanSize(n.size)}
                                    recent={file ? isRecentlyChanged(file.touchedAt, now) : false}
                                    onOpen={() => onSelect(n.path)}
                                />
                            )
                        })}
                    </div>
                )}
            </div>
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
}: {
    drive: SessionDriveData
    scope?: DriveScope
    initialPath?: string | null
}) {
    const rootLabel = driveRootLabel(drive.mount)
    // Restore the last-viewed file on (re)mount: explicit initialPath wins, else the persisted
    // per-drive selection, else null (the effect below picks the most-recent).
    const [persistedSelection, setPersistedSelection] = useAtom(
        driveSelectionAtomFamily(drive.mount?.id ?? ""),
    )
    const [search, setSearch] = useState("")
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

    const tree = useMemo(() => buildDriveTree(drive.files), [drive.files])
    const shownTree = useMemo(() => filterDriveTree(tree, search), [tree, search])
    // While searching, show every surviving branch expanded so matches are visible.
    const shownExpanded = useMemo(
        () => (search.trim() ? new Set(collectFolderPaths(shownTree)) : expanded),
        [search, shownTree, expanded],
    )
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
                <div className="w-[240px] shrink-0 border-0 border-r border-solid border-colorBorderSecondary p-3">
                    <Input disabled placeholder="Search" />
                </div>
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
        // Splitter → the tree pane is draggable (widen to read long names); the tree body also
        // scrolls horizontally (nowrap rows in a w-max wrapper) so long names are reachable without
        // resizing. Two ways to see the full name, per the feedback.
        <Splitter className="min-h-0 w-full flex-1">
            <Splitter.Panel defaultSize={260} min={180} max="65%">
                <div className="flex h-full min-h-0 flex-col gap-2 p-3">
                    <Input
                        allowClear
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search files"
                        prefix={<MagnifyingGlass size={12} className="text-colorTextQuaternary" />}
                    />
                    <div className="min-h-0 flex-1 overflow-auto">
                        {shownTree.length === 0 ? (
                            <Text type="secondary" className="px-1 !text-[11px]">
                                No files match.
                            </Text>
                        ) : (
                            // w-max min-w-full: at least the pane width (rows fill it), but grows to
                            // the widest row so the container scrolls horizontally for long names.
                            <div className="flex w-max min-w-full flex-col">
                                {shownTree.map((node) => (
                                    <TreeRow
                                        key={node.path}
                                        node={node}
                                        depth={0}
                                        expanded={shownExpanded}
                                        selectedPath={selectedPath}
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
                                ))}
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
