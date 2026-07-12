/**
 * DriveDrawer — the two-pane drive inspector (build-spec direction 1a, view B).
 *
 * Right drawer on the existing shell (`EnhancedDrawer`), but an INSPECTOR, not a form: no
 * Form/JSON toggle, no Create/Cancel. The browsing body is the exported {@link DriveExplorer}
 * (search + file tree / breadcrumb + meta + Download + content viewer) — the chat Files
 * window's list view renders the SAME explorer ("build once, skin twice"). Phase 1 is
 * read-only; `scope="app"` is the same drawer for the app drive (phase 2).
 */
import {useEffect, useMemo, useState} from "react"

import {type Mount} from "@agenta/entities/session"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    BracketsCurly,
    CaretDown,
    CaretRight,
    ChatCircle,
    DownloadSimple,
    File,
    FilePdf,
    FileText,
    FolderSimple,
    HardDrives,
    House,
    ImageSquare,
    MagnifyingGlass,
    MusicNotes,
    Table,
    Tray,
    VideoCamera,
} from "@phosphor-icons/react"
import {Alert, Button, Input, Skeleton, Tag, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import useURL from "@/oss/hooks/useURL"
import {projectIdAtom} from "@/oss/state/project"

import {downloadMountFile} from "./driveMedia"
import {
    ancestorPaths,
    buildDriveTree,
    filterDriveTree,
    humanSize,
    isMarkdownPath,
    relativeTime,
    type DriveTreeNode,
} from "./driveTree"
import {DriveFileBody, resolveDriveFileKind} from "./renderers"
import {useSessionDrive, type SessionDriveData} from "./useSessionDrive"

const {Text} = Typography

// Scope accents from the spec: session = teal, app = blue (icon tint only; everything else
// rides the semantic tokens so light mode stays coherent).
const SCOPE_META = {
    session: {icon: ChatCircle, accent: "#4fd1b5", tag: "per conversation"},
    app: {icon: HardDrives, accent: "#7fb0ff", tag: "shared across conversations"},
} as const

export type DriveScope = keyof typeof SCOPE_META

export const driveFileIcon = (path: string, size = 14) => {
    switch (resolveDriveFileKind(path)) {
        case "markdown":
            return <FileText size={size} className="text-[#4fd1b5]" />
        case "json":
            return <BracketsCurly size={size} className="text-colorWarning" />
        case "csv":
            return <Table size={size} className="text-colorInfo" />
        case "image":
            return <ImageSquare size={size} className="text-[#7fb0ff]" />
        case "pdf":
            return <FilePdf size={size} className="text-colorError" />
        case "audio":
            return <MusicNotes size={size} className="text-[#4fd1b5]" />
        case "video":
            return <VideoCamera size={size} className="text-colorWarning" />
        default:
            return <File size={size} className="text-colorTextTertiary" />
    }
}

export const fileTypeLabel = (path: string): string => {
    if (isMarkdownPath(path)) return "Markdown"
    const ext = path.split(".").pop()
    return ext && ext !== path ? ext.toUpperCase() : "File"
}

/** Breadcrumb root label. Mount slugs are the RESERVED form (`__ag__<uuid5>__cwd`) — surface
 * only the human tail ("cwd"), never the uuid (spec: raw ids stay out of labels). */
const driveRootLabel = (mount: Mount | null): string =>
    mount?.slug?.split("__").filter(Boolean).pop() ?? "cwd"

/** One tree row (folder or file), indented by depth; selection = fill + primary ring. */
const TreeRow = ({
    node,
    depth,
    expanded,
    selectedPath,
    onToggle,
    onSelect,
}: {
    node: DriveTreeNode
    depth: number
    expanded: Set<string>
    selectedPath: string | null
    onToggle: (path: string) => void
    onSelect: (path: string) => void
}) => {
    const isOpen = expanded.has(node.path)
    const selected = !node.isFolder && node.path === selectedPath
    return (
        <>
            <button
                type="button"
                onClick={() => (node.isFolder ? onToggle(node.path) : onSelect(node.path))}
                className={`flex w-full cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1.5 py-1 text-left text-xs transition-colors ${
                    selected
                        ? "bg-colorFillSecondary shadow-[inset_0_0_0_1px_var(--ag-colorPrimary)]"
                        : "hover:bg-colorFillTertiary"
                }`}
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
                <span className="min-w-0 truncate font-mono">{node.name}</span>
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
                          onToggle={onToggle}
                          onSelect={onSelect}
                      />
                  ))
                : null}
        </>
    )
}

/** The content viewer — the renderer registry (build-spec 3): kind-matched body, size caps,
 * Download fallback. Shared by the drawer preview and the chat Quick Look. */
export const DriveFileContentViewer = ({
    mount,
    path,
    size,
}: {
    mount: Mount | null
    path: string
    size?: number | null
}) => <DriveFileBody mount={mount} path={path} size={size} />

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

/** Right pane: breadcrumb + name/meta + Download + content viewer. */
const DriveFilePreview = ({
    mount,
    path,
    rootLabel,
    touchedAt,
    size,
    onNavigateRoot,
}: {
    mount: Mount | null
    path: string
    rootLabel: string
    touchedAt?: number
    size?: number
    onNavigateRoot?: () => void
}) => {
    const name = path.split("/").pop() ?? path
    const folders = path.split("/").slice(0, -1)

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
            {/* One line, never wraps: the folder chain truncates, the filename always survives. */}
            <div className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[11px] text-colorTextTertiary">
                <button
                    type="button"
                    onClick={onNavigateRoot}
                    className="flex shrink-0 cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-colorTextTertiary hover:text-colorText"
                >
                    <House size={12} />
                    <span className="font-mono">{rootLabel}</span>
                </button>
                {folders.length ? (
                    <span className="min-w-0 truncate font-mono">
                        {folders.map((f) => `/ ${f} `).join("")}
                    </span>
                ) : null}
                <span className="shrink-0 font-mono">/ {name}</span>
            </div>

            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate font-mono text-[13px] font-semibold">{name}</div>
                    <div className="text-[11px] text-colorTextTertiary">
                        {fileTypeLabel(path)}
                        {size != null ? <> · {humanSize(size)}</> : null}
                        {touchedAt ? <> · modified {relativeTime(touchedAt)}</> : null}
                    </div>
                </div>
                <DriveFileDownloadButton mount={mount} path={path} />
            </div>

            <DriveFileContentViewer mount={mount} path={path} size={size} />
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
    const [search, setSearch] = useState("")
    const [selectedPath, setSelectedPath] = useState<string | null>(() => initialPath ?? null)
    const [expanded, setExpanded] = useState<Set<string>>(
        () => new Set(initialPath ? ancestorPaths(initialPath) : []),
    )

    // Auto-select the most-recently-touched file once the listing lands (spec behavior); never
    // steals an existing selection.
    useEffect(() => {
        if (drive.isLoading || selectedPath || !drive.recents.length) return
        const target = drive.recents[0].path
        setSelectedPath(target)
        setExpanded(new Set(ancestorPaths(target)))
    }, [drive.isLoading, drive.recents, selectedPath])

    const tree = useMemo(() => buildDriveTree(drive.files), [drive.files])
    const shownTree = useMemo(() => filterDriveTree(tree, search), [tree, search])
    // While searching, show every surviving branch expanded so matches are visible.
    const shownExpanded = useMemo(
        () => (search.trim() ? new Set(collectFolderPaths(shownTree)) : expanded),
        [search, shownTree, expanded],
    )
    const selected = drive.recents.find((f) => f.path === selectedPath) ?? null

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
        <div className="flex min-h-0 w-full flex-1">
            <div className="flex w-[240px] shrink-0 flex-col gap-2 overflow-y-auto border-0 border-r border-solid border-colorBorderSecondary p-3">
                <Input
                    allowClear
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search files"
                    prefix={<MagnifyingGlass size={12} className="text-colorTextQuaternary" />}
                />
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    {shownTree.length === 0 ? (
                        <Text type="secondary" className="px-1 !text-[11px]">
                            No files match.
                        </Text>
                    ) : (
                        shownTree.map((node) => (
                            <TreeRow
                                key={node.path}
                                node={node}
                                depth={0}
                                expanded={shownExpanded}
                                selectedPath={selectedPath}
                                onToggle={(path) =>
                                    setExpanded((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(path)) next.delete(path)
                                        else next.add(path)
                                        return next
                                    })
                                }
                                onSelect={setSelectedPath}
                            />
                        ))
                    )}
                </div>
            </div>
            {selectedPath ? (
                <DriveFilePreview
                    mount={drive.mount}
                    path={selectedPath}
                    rootLabel={rootLabel}
                    touchedAt={selected?.touchedAt}
                    size={selected?.size ?? undefined}
                    onNavigateRoot={() => setSelectedPath(drive.recents[0]?.path ?? null)}
                />
            ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-colorTextTertiary">
                    Select a file to preview it.
                </div>
            )}
        </div>
    )
}

export interface DriveDrawerProps {
    open: boolean
    onClose: () => void
    sessionId: string
    scope?: DriveScope
    /** Preselect this file on open (a recents row click); omit → most-recently-touched. */
    initialPath?: string | null
}

export function DriveDrawer({
    open,
    onClose,
    sessionId,
    scope = "session",
    initialPath,
}: DriveDrawerProps) {
    const {projectURL} = useURL()
    const drive = useSessionDrive(sessionId)
    const meta = SCOPE_META[scope]
    const ScopeIcon = meta.icon

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={720}
            destroyOnClose
            closeOnLayoutClick={false}
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <ScopeIcon size={16} style={{color: meta.accent}} className="shrink-0" />
                    <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">
                                {scope === "session" ? "Session drive" : "App drive"}
                            </span>
                            <Tag className="m-0 shrink-0 text-[11px] font-normal">{meta.tag}</Tag>
                        </div>
                        {/* The raw session UUID lives HERE only — never as a user-facing label. */}
                        <div className="truncate text-xs font-normal text-colorTextTertiary">
                            {drive.fileCount} file{drive.fileCount === 1 ? "" : "s"} ·{" "}
                            {humanSize(drive.totalSize) || "0 B"} ·{" "}
                            <span className="font-mono">{sessionId}</span>
                        </div>
                    </div>
                </div>
            }
            extra={
                <Tooltip title="Download the whole drive as a zip — coming soon">
                    <Button icon={<DownloadSimple size={13} />} disabled>
                        Download all
                    </Button>
                </Tooltip>
            }
            footer={
                <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-colorTextTertiary">
                        Read-only · editing &amp; uploads coming soon
                    </span>
                    <a
                        href={`${projectURL}/observability`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--ag-colorInfo)]"
                    >
                        Open in Observability ↗
                    </a>
                </div>
            }
            styles={{body: {padding: 0, display: "flex", minHeight: 0}}}
        >
            {/* destroyOnClose remounts the explorer per open — mount-time init IS the reset. */}
            <DriveExplorer drive={drive} scope={scope} initialPath={initialPath} />
        </EnhancedDrawer>
    )
}

const collectFolderPaths = (nodes: DriveTreeNode[]): string[] =>
    nodes.flatMap((n) => (n.isFolder ? [n.path, ...collectFolderPaths(n.children)] : []))
